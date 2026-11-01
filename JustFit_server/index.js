// justFit server: Express + MySQL. The Expo app (justFit-CLIENT) talks to it over HTTP.
//
//   yarn dev     restart on every file change (nodemon)
//   yarn start   run once
//
// Startup prints two Node warnings ("Type Stripping is an experimental feature" and
// "Module type ... is not specified"). They come from loading the app's nutrition
// calculator straight from the client's TypeScript source (see profile.js) and are harmless.
const fs = require("node:fs");
const path = require("node:path");

// Load .env before anything reads process.env (Node 20.12+ built-in, no dotenv needed)
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const express = require("express");
const cors = require("cors");
const { pool } = require("./database");
const { randomUUID } = require("node:crypto");
const { requireUser, requireAdmin } = require("./auth");
const { authRouter } = require("./auth/routes");
const { analyticsRouter } = require("./analytics/routes");
const { deriveOtpKey, otpConfig } = require("./auth/otp");
const { createSmsProvider } = require("./auth/sms");
const { devLoginConfig } = require("./auth/devLogin");
const { ValidationError, validateProfileSubmission, persistProfile, loadProfile } = require("./profile");
const { logRequestError } = require("./logging");
const { securityHeaders, corsOptions } = require("./httpSecurity");
const { limitPerUser, createRateLimiter, rateLimits } = require("./rateLimit");
const { jsonBodyWithLimit } = require("./requestBody");
const { checkUpload, uploadLimits } = require("./bodyComposition/upload");
const { ExtractionError, extractReport } = require("./bodyComposition/extract");
const { ScanError, checkScanRequest, requestScan, MAX_SCAN_BODY_BYTES } = require("./bodyComposition/scan");
const home = require("./home");
const { macroRouter } = require("./macro/routes");
const { coachRouter } = require("./coach/routes");
const aiUsage = require("./ai/usage");
const aiModels = require("./ai/models");
const aiLimits = require("./ai/limits");
const aiDedupe = require("./ai/dedupe");
const { FoodScanError, checkFoodPhoto, scanFood, scanLimits: foodScanLimits, checkEstimateRequest, estimateFood } = require("./macro/foodScan");
const { workoutRouter } = require("./workout/routes");
const { fitnessRouter } = require("./fitness/routes");
const { adminPortalRouter } = require("./admin/routes");
const { recordAdminAction } = require("./admin/overview");

// Phone sign-in settings, checked before the server listens: a missing or short AUTH_SECRET,
// an unknown SMS_PROVIDER or a bad OTP_* limit stops startup with one clear line (never a value).
// AUTH_SECRET signs the code hashes and member passes; it is not the SMS provider's key.
const otpKey = deriveOtpKey(process.env.AUTH_SECRET);
const sms = createSmsProvider(process.env);
const otpLimits = otpConfig(process.env);
// Development only: a fixed code for a few numbers (auth/devLogin.js). Refused outside
// NODE_ENV=development on justfit (or tests), so this line stops a production start that has it.
const devLogin = devLoginConfig(process.env);
// The AI features (reports, food scan, coach) need OpenAI; without the key each call fails with
// a 500. Said once at startup rather than discovered from the app.
if (!process.env.OPENAI_API_KEY && process.env.AI_PROVIDER !== "fake") console.warn("OPENAI_API_KEY is not set: report reading, food scan and the AI Coach will fail until it is.");
// Which model each AI feature uses (ai/models.js; AI_MODEL_* to change), said once so a costly override is visible
if (process.env.NODE_ENV !== "test") console.log(`AI models: ${aiModels.routingSummary()}`);
if (devLogin) console.warn(`Development sign-in code is ON for ${devLogin.phones.length} number${devLogin.phones.length === 1 ? "" : "s"}. Never set DEV_LOGIN_* outside development.`);

const app = express();
app.disable("x-powered-by"); // no need to advertise the framework
// Behind a reverse proxy, TRUST_PROXY says which hops to believe for the client's IP (the
// sign-in rate limits key on it): a hop count ("1") or proxy addresses ("loopback",
// "10.0.0.0/8"). Unset: X-Forwarded-For is ignored and the socket address is used. "true"
// (trust anything) is refused, because then anyone could pick their own IP.
if (process.env.TRUST_PROXY) {
  const value = process.env.TRUST_PROXY.trim();
  if (/^(true|\*)$/i.test(value)) throw new Error("TRUST_PROXY must be a hop count or proxy addresses, not true");
  app.set("trust proxy", /^[0-9]+$/.test(value) ? Number(value) : value.split(",").map((part) => part.trim()));
}
app.locals.pool = pool; // routers read the pool from here
app.use(securityHeaders); // httpSecurity.js: nosniff, no framing, no caching, HSTS over HTTPS
// Browser origins (httpSecurity.js): CORS_ORIGINS, or none in production, or any in development
// and tests (Expo web). The native app sends no Origin header and is never affected.
app.use(cors(corsOptions(process.env)));

// Bodies are parsed per route, after the caller is verified, with the limit each route
// needs: a profile with a report is well under 200 kB; a report upload is a whole file.
const profileBody = express.json({ limit: "200kb" });
// The largest body a legitimate upload needs: the biggest allowed file as base64 (4/3 of
// its bytes) plus the JSON around it. Anything bigger is refused while it is still arriving.
const MAX_UPLOAD_BODY_BYTES = Math.ceil(uploadLimits.maxPdfBytes * (4 / 3)) + 1024;

// One budget per signed-in user per group of routes (per process, reset on restart; see
// rateLimit.js). Always placed after requireUser, so the key is the verified user id.
// Every authenticated attempt counts, valid or not.
const profileLimiter = createRateLimiter(rateLimits.standard);
const uploadLimiter = createRateLimiter(rateLimits.upload); // each upload is an OpenAI vision call
const scanLimiter = createRateLimiter(rateLimits.upload); // each photo scan runs the Forma model for a few seconds
const homeLimiter = createRateLimiter(rateLimits.standard); // members reading the home screen content
const adminLimiter = createRateLimiter(rateLimits.standard); // admins editing it (also caps the role lookups)
const macroLimiter = createRateLimiter(rateLimits.frequent); // the Macro diary: day, week strip, meals, favourites
const foodScanLimiter = createRateLimiter(rateLimits.upload); // each food photo is an OpenAI vision call
const foodEstimateLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 }); // each typed food estimate is a small OpenAI call
const coachLimiter = createRateLimiter(rateLimits.standard); // the AI Coach: the intake answers and the plan
const workoutLimiter = createRateLimiter(rateLimits.frequent); // the Fitness tab: plan, training day, history
const analyticsLimiter = createRateLimiter(rateLimits.frequent); // the app's usage events, in small batches

// Phone sign-in (auth/routes.js): request and check a code, who am I, logout. The two sign-in
// routes and the health check are the only ones without a session;
// they are budgeted per IP address and per phone number instead.
app.use("/api/auth", authRouter({ pool, sms, otpKey, config: otpLimits, devLogin }));

// The app's usage events (analytics/routes.js): the signed-in member's own, in small batches
app.use("/api/analytics", requireUser, limitPerUser(analyticsLimiter), analyticsRouter({ pool }));

// Quick check that the server is up and can reach MySQL (public: no token needed)
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    res.status(503).json({ ok: false, database: error.code ?? "unreachable" });
  }
});

// The caller's own profile and nutrition targets (null until setup is finished).
// Who "the caller" is comes from the verified token only, so nobody can read anyone else's.
app.get("/api/profile", requireUser, limitPerUser(profileLimiter), async (req, res, next) => {
  try {
    res.json(await loadProfile(pool, req.userId));
  } catch (error) {
    next(error);
  }
});

// Saves the setup answers and the calculated targets for the caller. Safe to repeat:
// a second save updates the same rows. Email and role are never taken from the app.
app.post("/api/profile", requireUser, limitPerUser(profileLimiter), profileBody, async (req, res, next) => {
  try {
    const data = validateProfileSubmission(req.body, req.userId);
    await persistProfile(pool, req.userId, data);
    res.json({ saved: true });
  } catch (error) {
    next(error);
  }
});

// Reads an uploaded body composition report: { data: base64, mediaType } → { report } with
// UNCONFIRMED values for the user to check. The file is never stored or logged. Order
// matters: verified caller, upload budget, capped body, byte-level checks, and only then
// the OpenAI call.
app.post("/api/body-composition", requireUser, limitPerUser(uploadLimiter), jsonBodyWithLimit(MAX_UPLOAD_BODY_BYTES), async (req, res, next) => {
  const upload = checkUpload(req.body);
  if (!upload.ok) return res.status(upload.status).json({ error: upload.error });
  try {
    await aiLimits.check(pool, { feature: "body_report", userId: req.userId });
    const report = await extractReport(
      { base64: req.body.data.replace(/\s/g, ""), mediaType: upload.mediaType, layout: "inbody", reportId: randomUUID() },
      aiUsage.tracker(pool, { feature: "body_report", userId: req.userId }),
    );
    res.json({ report });
  } catch (error) {
    if (error instanceof ExtractionError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Estimates body fat % from a front and a side photo: { front, side, heightCm, weightKg, age,
// sex, flipSide? } → { estimate } for the user to accept or ignore. The photos go to the Forma
// scan server (bodyComposition/scan.js) and are never stored or logged. Same order as the
// upload route: verified caller, scan budget, capped body, byte-level checks, then the model.
app.post("/api/body-composition/scan", requireUser, limitPerUser(scanLimiter), jsonBodyWithLimit(MAX_SCAN_BODY_BYTES), async (req, res, next) => {
  const checked = checkScanRequest(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  try {
    res.json({ estimate: await requestScan(checked, { usage: aiUsage.tracker(pool, { feature: "body_scan", userId: req.userId }) }) });
  } catch (error) {
    if (error instanceof ScanError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// There is no self-service role change: every new account is a member ('user'), and only an
// admin (scripts/set-role.js) makes an account an admin.

// ---------------------------------------------------------------------------
// Home screen content (see home.js)
// ---------------------------------------------------------------------------

// Members: the promotions to show right now (published and inside their window, in order)
app.get("/api/promotions/active", requireUser, limitPerUser(homeLimiter), async (req, res, next) => {
  try {
    res.json({ promotions: await home.activePromotions(pool) });
  } catch (error) {
    next(error);
  }
});

// Members: the section labels, quick-action cards and popular meals
app.get("/api/home-content", requireUser, limitPerUser(homeLimiter), async (req, res, next) => {
  try {
    res.json({ content: await home.loadHomeContent(pool) });
  } catch (error) {
    next(error);
  }
});

// Admins only. Order matters: verified caller, budget, then the role check (so one
// account can't make the server look up roles without limit), then a small JSON body.
const adminOnly = [requireUser, limitPerUser(adminLimiter), requireAdmin];
const adminBody = express.json({ limit: "50kb" });

// The Super Admin portal (see admin/routes.js): Overview, users, AI and app usage, for justFit
// admins only (adminOnly checks the role on every request)
app.use("/api/admin/portal", ...adminOnly, adminPortalRouter);

app.get("/api/admin/promotions", ...adminOnly, async (req, res, next) => {
  try {
    res.json({ promotions: await home.listPromotions(pool) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/promotions", ...adminOnly, adminBody, async (req, res, next) => {
  try {
    const values = home.validatePromotion(req.body);
    const promotion = await home.createPromotion(pool, values, req.userId);
    await recordAdminAction(pool, req, values.status === "published" ? "promotion.publish" : "promotion.create", "promotion", promotion?.id, `${values.status === "published" ? "Published" : "Created"} promotion “${values.title}”`);
    res.status(201).json({ promotion });
  } catch (error) {
    next(error);
  }
});

// The complete new order: { ids: [3, 1, 2] }. Declared before the :id routes so "reorder"
// is never read as an id.
app.post("/api/admin/promotions/reorder", ...adminOnly, adminBody, async (req, res, next) => {
  try {
    res.json({ promotions: await home.reorderPromotions(pool, req.body?.ids, req.userId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/promotions/:id", ...adminOnly, async (req, res, next) => {
  try {
    const promotion = await home.getPromotion(pool, home.promotionId(req.params.id));
    if (!promotion) return res.status(404).json({ error: "That promotion no longer exists." });
    res.json({ promotion });
  } catch (error) {
    next(error);
  }
});

// Partial update: the fields sent replace the saved ones, then the whole promotion is
// re-checked, so a change can never leave it half-valid
app.patch("/api/admin/promotions/:id", ...adminOnly, adminBody, async (req, res, next) => {
  try {
    const id = home.promotionId(req.params.id);
    const existing = await home.getPromotion(pool, id);
    if (!existing) return res.status(404).json({ error: "That promotion no longer exists." });
    if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Send the changes as an object." });
    }
    const editable = {};
    for (const key of ["title", "eyebrow", "headline", "description", "imageUrl", "imageAlt", "ctaLabel", "ctaAction", "ctaDestination",
      "secondaryCtaLabel", "secondaryCtaAction", "secondaryCtaDestination", "textAlign", "imagePosition", "backgroundColor", "textColor",
      "status", "rotationIntervalSeconds", "startsAt", "endsAt"]) editable[key] = existing[key];
    const values = home.validatePromotion({ ...editable, ...req.body });
    const promotion = await home.updatePromotion(pool, id, values, req.userId);
    if (!promotion) return res.status(404).json({ error: "That promotion no longer exists." });
    const published = values.status === "published" && existing.status !== "published";
    await recordAdminAction(pool, req, published ? "promotion.publish" : "promotion.update", "promotion", id, `${published ? "Published" : "Updated"} promotion “${values.title}”`);
    res.json({ promotion });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/promotions/:id", ...adminOnly, async (req, res, next) => {
  try {
    const id = home.promotionId(req.params.id);
    const existing = await home.getPromotion(pool, id);
    const deleted = await home.deletePromotion(pool, id);
    if (!deleted) return res.status(404).json({ error: "That promotion no longer exists." });
    await recordAdminAction(pool, req, "promotion.delete", "promotion", id, `Deleted promotion “${existing?.title ?? "untitled"}”`);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

for (const [action, status] of [["publish", "published"], ["disable", "disabled"]]) {
  app.post(`/api/admin/promotions/:id/${action}`, ...adminOnly, async (req, res, next) => {
    try {
      const promotion = await home.setPromotionStatus(pool, home.promotionId(req.params.id), status, req.userId);
      if (!promotion) return res.status(404).json({ error: "That promotion no longer exists." });
      res.json({ promotion });
    } catch (error) {
      next(error);
    }
  });
}

app.get("/api/admin/home-content", ...adminOnly, async (req, res, next) => {
  try {
    res.json({ content: await home.loadHomeContent(pool) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/home-content", ...adminOnly, adminBody, async (req, res, next) => {
  try {
    const values = home.validateHomeContent(req.body);
    res.json({ content: await home.saveHomeContent(pool, values, req.userId) });
  } catch (error) {
    next(error);
  }
});

// The menu, for picking popular meals
app.get("/api/admin/meals", ...adminOnly, async (req, res, next) => {
  try {
    res.json({ meals: await home.listMeals(pool) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Macro diary (see macro/routes.js): logged meals, the day view, favourites
// ---------------------------------------------------------------------------

// Estimates a meal from one photo: { data: base64, mediaType, hint? } → { scan: { title, items } }
// for the member to check, then log through POST /api/macro/meals. Nothing is stored and the
// photo is never logged. Before the router so it gets its own budget and body cap: verified
// caller, scan budget, capped body, byte-level checks, and only then the OpenAI call.
app.post("/api/macro/scan", requireUser, limitPerUser(foodScanLimiter), jsonBodyWithLimit(foodScanLimits.maxBodyBytes), async (req, res, next) => {
  const photo = checkFoodPhoto(req.body);
  if (!photo.ok) return res.status(photo.status).json({ error: photo.error });
  try {
    await aiLimits.check(pool, { feature: "food_scan", userId: req.userId });
    // The same photo sent twice at once (a double tap, a retried upload) is scanned once
    const scan = await aiDedupe.shared.run(aiDedupe.requestKey("food_scan", req.userId, photo.base64, photo.hint), () =>
      scanFood(photo, process.env, aiUsage.tracker(pool, { feature: "food_scan", userId: req.userId })),
    );
    res.json({ scan });
  } catch (error) {
    if (error instanceof FoodScanError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Estimates one typed food: { name, quantity, unit } → { estimate: { kcal, proteinG, carbsG, fatG } } for
// Manual Entry to fill in (the member checks it and logs the meal as usual). Nothing is stored and the
// name is never logged. Verified caller, its own budget, a small body, checks, the AI limits, then the model.
app.post("/api/macro/estimate", requireUser, limitPerUser(foodEstimateLimiter), jsonBodyWithLimit(2048), async (req, res, next) => {
  const food = checkEstimateRequest(req.body);
  if (!food.ok) return res.status(food.status).json({ error: food.error });
  try {
    await aiLimits.check(pool, { feature: "food_scan", userId: req.userId });
    const estimate = await aiDedupe.shared.run(aiDedupe.requestKey("food_estimate", req.userId, food.name, food.quantity, food.unit), () =>
      estimateFood(food, process.env, aiUsage.tracker(pool, { feature: "food_scan", userId: req.userId })),
    );
    res.json({ estimate });
  } catch (error) {
    if (error instanceof FoodScanError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

app.use("/api/macro", requireUser, limitPerUser(macroLimiter), macroRouter);

// ---------------------------------------------------------------------------
// AI Coach (see coach/routes.js): the intake answers, the plan and the chat (making a plan and each chat message have their own hourly budgets)
// ---------------------------------------------------------------------------

app.use("/api/coach", requireUser, limitPerUser(coachLimiter), coachRouter);

// ---------------------------------------------------------------------------
// Workout (see workout/routes.js): the active plan, one training day, history
// ---------------------------------------------------------------------------

app.use("/api/workout", requireUser, limitPerUser(workoutLimiter), workoutRouter);
// The Fitness tab's programs and location sheet (fitness/routes.js), on the same budget as the workout routes
app.use("/api/fitness", requireUser, limitPerUser(workoutLimiter), fitnessRouter);

// No route matched: answer in JSON like every other response, not Express's HTML page
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Anything a route didn't handle itself. Client mistakes (a malformed JSON body, a
// body that's too large, a validation failure) carry their own 4xx status and get a
// short message. A MySQL CHECK constraint rejecting a value is also the client's data.
// Everything else (database errors included) is logged here through logging.js, which
// keeps only safe fields (never the SQL, its values or a token), and the app gets one
// friendly line, never the internal error.
const clientErrorMessages = {
  "entity.parse.failed": "The request body isn't valid JSON.",
  "entity.too.large": "The request body is too large.",
};

app.use((error, req, res, next) => {
  // Our own errors carry a safe message and their status (400 validation, 403, 404, 413, 415, 401 or 503 account checks)
  if (error instanceof ValidationError || ["NotFoundError", "ForbiddenError", "AccountUnavailableError"].includes(error?.name)) {
    return res.status(Number.isInteger(error.status) ? error.status : 400).json({ error: error.message });
  }
  if (error?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
    return res.status(400).json({ error: "One of the values is out of range." });
  }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) {
    logRequestError(req, error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
  res.status(status).json({ error: clientErrorMessages[error.type] ?? "The request couldn't be processed." });
});

const port = Number(process.env.PORT ?? 4000);
// 0.0.0.0 so a phone on the same Wi-Fi can reach it, not just this computer
app.listen(port, "0.0.0.0", () => {
  console.log(`justFit server listening on http://localhost:${port}`);
});
