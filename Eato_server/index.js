// EATO server: Express + MySQL. The Expo app (EATO-CLIENT) talks to it over HTTP.
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
const { requireUser, getAccount, grantTrainerRole } = require("./auth");
const { ValidationError, validateProfileSubmission, persistProfile, loadProfile } = require("./profile");
const { logRequestError } = require("./logging");
const { limitPerUser, createRateLimiter, rateLimits } = require("./rateLimit");
const { jsonBodyWithLimit } = require("./requestBody");
const { checkUpload, uploadLimits } = require("./bodyComposition/upload");
const { ExtractionError, extractReport } = require("./bodyComposition/extract");

const app = express();
app.disable("x-powered-by"); // no need to advertise the framework
app.use(cors()); // the app runs on a different origin (phone / simulator), so allow it

// Bodies are parsed per route, after the caller is verified, with the limit each route
// needs: a profile with a report is well under 200 kB; a report upload is a whole file.
const profileBody = express.json({ limit: "200kb" });
// The largest body a legitimate upload needs: the biggest allowed file as base64 (4/3 of
// its bytes) plus the JSON around it. Anything bigger is refused while it is still arriving.
const MAX_UPLOAD_BODY_BYTES = Math.ceil(uploadLimits.maxPdfBytes * (4 / 3)) + 1024;

// One budget per signed-in user per group of routes (per process, reset on restart; see
// rateLimit.js). Always placed after requireUser, so the key is the verified Clerk user id.
// Every authenticated attempt counts, valid or not.
const profileLimiter = createRateLimiter(rateLimits.standard);
const accountLimiter = createRateLimiter(rateLimits.standard);
const uploadLimiter = createRateLimiter(rateLimits.upload); // each upload is an OpenAI vision call

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
// a second save updates the same rows. Email and role come from Clerk, never from the app.
app.post("/api/profile", requireUser, limitPerUser(profileLimiter), profileBody, async (req, res, next) => {
  try {
    const data = validateProfileSubmission(req.body, req.userId);
    let account;
    try {
      account = await getAccount(req.userId);
    } catch {
      // Fail closed: without a trusted email and role nothing is written
      console.error("Clerk account lookup failed");
      return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
    }
    await persistProfile(pool, req.userId, account, data);
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
    const report = await extractReport({
      base64: req.body.data.replace(/\s/g, ""),
      mediaType: upload.mediaType,
      layout: "inbody",
      reportId: randomUUID(),
    });
    res.json({ report });
  } catch (error) {
    if (error instanceof ExtractionError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Turns the account type picked at sign-up into the real role (see grantTrainerRole in
// auth.js): POST → { role }. No body; the caller is the verified token's user.
app.post("/api/account-type", requireUser, limitPerUser(accountLimiter), async (req, res) => {
  try {
    res.json({ role: await grantTrainerRole(req.userId) });
  } catch {
    console.error("Setting the account type failed");
    res.status(500).json({ error: "We couldn't set up your trainer account. Please try again." });
  }
});

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
  if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
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
  console.log(`EATO server listening on http://localhost:${port}`);
});
