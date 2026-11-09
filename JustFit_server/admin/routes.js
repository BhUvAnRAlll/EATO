// HTTP routes for the Super Admin portal, mounted at /api/admin/portal in index.js behind
// requireUser, the per-user rate limit and requireAdmin (users.role, checked every time).
// Handlers read the admin from req.userId, never from the request, and send errors to the
// shared handler.
const express = require("express");

const { overview } = require("./overview");
const users = require("./users");
const gyms = require("./gyms");
const smsRules = require("../gym/smsRules");
const gymRules = require("../gym/rules");
const registration = require("../gym/registration");
const registrationRules = require("../gym/registrationRules");
const notices = require("../notifications/events");
const platform = require("./platform");
const platformRules = require("./platformRules");
const gymProfile = require("../gym/gymProfile");
const aiUsage = require("./aiUsage");
const usage = require("./usage");
const retention = require("./retention");
const usageExport = require("./export");
const exercises = require("./exercises");
const exerciseRules = require("./exerciseRules");
const fitnessPrograms = require("../fitness/programs");
const fitnessCovers = require("../fitness/covers");
const fitnessSections = require("../fitness/sections");
const fitnessRules = require("../fitness/rules");
const { CoachPlanError } = require("../coach/planRules");
const aiRules = require("../ai/rules");
const { NotFoundError } = require("../errors");
const { createRateLimiter, limitPerUser } = require("../rateLimit");

const router = express.Router();
const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;

// Overview: platform counts, the to-do list and recent admin activity
router.get("/overview", route(async (req, res) => {
  const summary = await overview(pool(req));
  res.json({ ...summary, gyms: await gyms.overviewCounts(pool(req), gymRules.todayInIndia()) });
}));

// An account id from the path: ids are letters, digits and underscores. Anything else
// can't be an account, so it reads as missing.
const userId = (req) => {
  const id = req.params.userId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(id)) throw new NotFoundError("That account doesn't exist.");
  return id;
};
const smallBody = express.json({ limit: "2kb" });

// Users: search by name or email, filtered by kind (all, members, admins)
router.get("/users", route(async (req, res) => {
  res.json({ users: await users.listUsers(pool(req), users.listQuery(req.query)) });
}));

// One account: name, kind and when they joined
router.get("/users/:userId", route(async (req, res) => {
  res.json({ user: await users.userDetail(pool(req), userId(req)) });
}));

// Gyms (admin/gyms.js): every gym with today's numbers, one gym in detail, creating and editing a
// gym, and linking its gym_admin accounts. Before migrations/2026-11-19-gym-portal.sql, a 503.
const gymRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: "Gyms need the 2026-11-19-gym-portal migration on this server." });
    next(error);
  });
const gymId = (req) => gymRules.id(req.params.gymId, "gym");
router.get("/gyms", gymRoute(async (req, res) => {
  res.json(await gyms.list(pool(req), gymRules.todayInIndia(), registrationRules.listQuery(req.query)));
}));
router.post("/gyms", smallBody, gymRoute(async (req, res) => {
  const id = await gyms.create(pool(req), req.userId, gymRules.gymBody(req.body, { creating: true }));
  res.status(201).json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));
router.post("/gyms/:gymId/branches", smallBody, gymRoute(async (req, res) => {
  const id = await gyms.addBranch(pool(req), req.userId, gymId(req), gymRules.branchBody(req.body));
  res.status(201).json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));
router.get("/gyms/:gymId", gymRoute(async (req, res) => {
  res.json(await gyms.detail(pool(req), gymId(req), gymRules.todayInIndia()));
}));
router.patch("/gyms/:gymId", smallBody, gymRoute(async (req, res) => {
  const id = gymId(req);
  await gyms.update(pool(req), req.userId, id, gymRules.gymBody(req.body, { creating: false }));
  res.json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));
// Adds SMS credits to a branch (1 credit = 1 SMS to a member)
router.post("/gyms/:gymId/sms-credits", smallBody, gymRoute(async (req, res) => {
  const id = gymId(req);
  await gyms.addSmsCredits(pool(req), req.userId, id, smsRules.creditsBody(req.body).credits);
  res.json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));
router.post("/gyms/:gymId/staff", smallBody, gymRoute(async (req, res) => {
  const id = gymId(req);
  await gyms.linkStaff(pool(req), req.userId, id, gymRules.staffBody(req.body).phone);
  res.status(201).json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));
router.delete("/gyms/:gymId/staff/:userId", gymRoute(async (req, res) => {
  const id = gymId(req);
  await gyms.unlinkStaff(pool(req), req.userId, id, userId(req));
  res.json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));

// The gym platform (admin/platform.js, the brief's section 7): numbers across every gym, every gym's
// team, an account's gyms, suspending an account (migration 2027-01-07) and moving a gym's owner
const SUSPENSION_MIGRATION = "Suspending accounts needs the 2027-01-07-account-suspensions migration on this server.";
const platformRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE" && String(error.sqlMessage ?? "").includes("account_suspensions")) return res.status(503).json({ error: SUSPENSION_MIGRATION });
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: "Gyms need the 2026-11-19-gym-portal migration on this server." });
    next(error);
  });
// 60 account and ownership changes an hour per admin
const platformLimit = limitPerUser(createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }));
router.get("/gym-analytics", platformRoute(async (req, res) => {
  res.json(await platform.analytics(pool(req), platformRules.analyticsQuery(req.query)));
}));
router.get("/gym-staff", platformRoute(async (req, res) => {
  res.json(await platform.staffDirectory(pool(req), platformRules.staffQuery(req.query)));
}));
router.get("/users/:userId/gyms", platformRoute(async (req, res) => {
  res.json(await platform.gymLinksOf(pool(req), userId(req)));
}));
router.post("/users/:userId/suspend", platformLimit, smallBody, platformRoute(async (req, res) => {
  const id = userId(req);
  res.json(await platform.suspend(pool(req), req.userId, id, platformRules.suspendBody(req.body)));
}));
router.post("/users/:userId/reactivate", platformLimit, platformRoute(async (req, res) => {
  res.json(await platform.reactivate(pool(req), req.userId, userId(req)));
}));
router.post("/gyms/:gymId/transfer", platformLimit, smallBody, platformRoute(async (req, res) => {
  const id = gymId(req);
  await platform.transferOwner(pool(req), req.userId, id, platformRules.transferBody(req.body));
  res.json(await gyms.detail(pool(req), id, gymRules.todayInIndia()));
}));

// Gym registration and approval (gym/registration.js, migration 2026-12-27): a branch's application
// with its documents and history, the review's decisions, and the application's private files
const REGISTRATION_MIGRATION = "Gym approval needs the 2026-12-27-gym-registration migration on this server.";
const reviewRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: REGISTRATION_MIGRATION });
    next(error);
  });
// 120 decisions an hour per admin, so a stuck button can't flood the history
const decisionLimit = limitPerUser(createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 }));
router.get("/gyms/:gymId/application", reviewRoute(async (req, res) => {
  res.json(await registration.forAdmin(pool(req), gymId(req)));
}));
router.post("/gyms/:gymId/decision", decisionLimit, smallBody, reviewRoute(async (req, res) => {
  const id = gymId(req);
  const decision = registrationRules.decisionBody(req.body);
  const answer = await registration.decide(pool(req), req.userId, id, decision);
  await notices.gymDecided(pool(req), id, decision.action, decision.note);
  res.json(answer);
}));
router.get("/gyms/:gymId/documents/:documentId", reviewRoute(async (req, res) => {
  registration.sendDocument(res, await registration.adminDocument(pool(req), gymId(req), gymRules.id(req.params.documentId, "document")));
}));
router.get("/gyms/:gymId/photos/:photoId", reviewRoute(async (req, res) => {
  fitnessCovers.send(res, await gymProfile.photoFile(pool(req), gymId(req), gymRules.id(req.params.photoId, "photo")));
}));
router.get("/gyms/:gymId/logo", reviewRoute(async (req, res) => {
  fitnessCovers.send(res, await registration.adminLogo(pool(req), gymId(req)));
}));

// AI usage and cost (admin/aiUsage.js): the summary for a period, the call history, the budget.
// Before migrations/2026-11-03-ai-usage.sql has run on this database, say so instead of a 500.
const aiRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: "AI usage tracking isn't set up on this server yet." });
    if (error?.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ error: "AI usage tracking needs the 2026-11-04-ai-cost-optimization migration on this server." });
    next(error);
  });
router.get("/ai-usage/summary", aiRoute(async (req, res) => {
  res.json(await aiUsage.summary(pool(req), aiRules.summaryQuery(req.query)));
}));
router.get("/ai-usage/history", aiRoute(async (req, res) => {
  res.json(await aiUsage.history(pool(req), aiRules.historyQuery(req.query)));
}));
router.get("/ai-usage/budget", aiRoute(async (req, res) => {
  res.json(await aiUsage.budget(pool(req)));
}));
router.put("/ai-usage/budget", smallBody, aiRoute(async (req, res) => {
  res.json(await aiUsage.saveBudget(pool(req), req.userId, aiRules.budgetBody(req.body)));
}));
router.post("/ai-usage/alerts/:alertId/acknowledge", aiRoute(async (req, res) => {
  res.json(await aiUsage.acknowledgeAlert(pool(req), aiRules.alertId(req.params.alertId)));
}));

// App Usage: how members use the app, from the rows the features write (admin/usage.js). Not the
// AI Usage module above, which is about tokens and cost.
router.get("/usage", route(async (req, res) => {
  res.json(await usage.summary(pool(req), req.query));
}));
// Phase 3: retention by join cohort, the member-level list, one feature's detail (admin/retention.js)
router.get("/usage/retention", route(async (req, res) => {
  res.json(await retention.retention(pool(req), req.query));
}));
router.get("/usage/members", route(async (req, res) => {
  res.json(await retention.members(pool(req), req.query));
}));
router.get("/usage/features/:featureId", route(async (req, res) => {
  res.json(await retention.featureDetail(pool(req), String(req.params.featureId), req.query));
}));
// Phase 4: the same numbers as CSV, with the screen's filters (admin/export.js)
router.get("/usage/export", route(async (req, res) => {
  const { fileName, csv } = await usageExport.exportCsv(pool(req), req.query);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${fileName}"`);
  res.set("Cache-Control", "no-store");
  res.send(csv);
}));

// Exercises (admin/exercises.js): every exercise a member can be given, with its video state;
// the AI adds new ones. Before migrations/2026-11-07-exercise-library-admin.sql has run on this
// database, say so instead of a 500; the AI's own failures carry their message and status.
const exerciseRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_BAD_FIELD_ERROR" || error?.code === "WARN_DATA_TRUNCATED" || error?.code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD") {
      return res.status(503).json({ error: "Exercises need the 2026-11-07-exercise-library-admin migration on this server." });
    }
    if (error instanceof CoachPlanError) return res.status(error.status).json({ error: error.message });
    next(error);
  });
router.get("/exercises", exerciseRoute(async (req, res) => {
  res.json(await exercises.list(pool(req), exerciseRules.listQuery(req.query)));
}));
router.post("/exercises/ai-draft", smallBody, exerciseRoute(async (req, res) => {
  res.status(201).json(await exercises.draftWithAi(pool(req), req.userId, exerciseRules.draftBody(req.body)));
}));
router.get("/exercises/:exerciseId", exerciseRoute(async (req, res) => {
  res.json({ exercise: await exercises.detail(pool(req), exerciseRules.exerciseId(req.params.exerciseId)) });
}));
router.post("/exercises/:exerciseId/archive", exerciseRoute(async (req, res) => {
  res.json({ exercise: await exercises.setArchived(pool(req), req.userId, exerciseRules.exerciseId(req.params.exerciseId), true) });
}));
router.post("/exercises/:exerciseId/restore", exerciseRoute(async (req, res) => {
  res.json({ exercise: await exercises.setArchived(pool(req), req.userId, exerciseRules.exerciseId(req.params.exerciseId), false) });
}));

// Programs (fitness/programs.js): the Fitness tab's programs, edited, published or hidden, created
// and rewritten with the AI. Before the 2026-11-09 migration, say so instead of a 500.
const programBody = express.json({ limit: "8kb" });
// A cover: at most 2 MB of photo as base64 (4/3 of its bytes) plus the JSON around it
const coverBody = express.json({ limit: Math.ceil(fitnessCovers.coverLimits.maxBytes * (4 / 3)) + 1024 });
const coverLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });
const programRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD"].includes(error?.code)) {
      return res.status(503).json({ error: "Programs need the latest fitness migrations (2026-11-09 to 2026-11-13) on this server." });
    }
    if (error instanceof CoachPlanError) return res.status(error.status).json({ error: error.message });
    next(error);
  });
router.get("/programs", programRoute(async (req, res) => {
  res.json(await fitnessPrograms.adminList(pool(req)));
}));
router.post("/programs", programBody, programRoute(async (req, res) => {
  res.status(201).json({ program: await fitnessPrograms.create(pool(req), req.userId, fitnessRules.programBody(req.body, { creating: true })) });
}));
router.get("/programs/:programId", programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.detail(pool(req), fitnessRules.id(req.params.programId), { admin: true }) });
}));
router.patch("/programs/:programId", programBody, programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.update(pool(req), req.userId, fitnessRules.id(req.params.programId), fitnessRules.programBody(req.body, { creating: false })) });
}));
// A program's sessions: POST adds one { title, minutes, youtube } at the end (one YouTube video's
// link, embedded, never an uploaded file), PATCH edits one (any of the three; youtube "" takes the
// video off), DELETE removes one (never the last), POST …/move { direction } reorders. Each answers
// the program; `videoError` says why the video's creator couldn't be read from YouTube.
const sessionId = (req) => fitnessRules.id(req.params.sessionId, "session");
router.post("/programs/:programId/sessions", programBody, programRoute(async (req, res) => {
  res.status(201).json({ program: await fitnessPrograms.addSession(pool(req), req.userId, fitnessRules.id(req.params.programId), fitnessRules.sessionBody(req.body, { creating: true })) });
}));
router.patch("/programs/:programId/sessions/:sessionId", programBody, programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.editSession(pool(req), req.userId, fitnessRules.id(req.params.programId), sessionId(req), fitnessRules.sessionBody(req.body, { creating: false })) });
}));
router.delete("/programs/:programId/sessions/:sessionId", programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.removeSession(pool(req), req.userId, fitnessRules.id(req.params.programId), sessionId(req)) });
}));
router.post("/programs/:programId/sessions/:sessionId/move", programBody, programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.moveSession(pool(req), req.userId, fitnessRules.id(req.params.programId), sessionId(req), fitnessRules.moveBody(req.body)) });
}));
// Categories (fitness/sections.js): the Fitness tab's sections in order. GET lists them (with how
// many programs each has), POST creates one { title, note?, layout?, published? }, PATCH edits one,
// POST …/move { direction } reorders, DELETE removes one the admin made while it has no programs.
router.get("/sections", programRoute(async (req, res) => {
  await fitnessPrograms.ensureCatalog(pool(req));
  res.json({ sections: await fitnessSections.all(pool(req)) });
}));
router.post("/sections", programBody, programRoute(async (req, res) => {
  await fitnessPrograms.ensureCatalog(pool(req));
  res.status(201).json({ section: await fitnessSections.create(pool(req), req.userId, fitnessRules.sectionBody(req.body, { creating: true })) });
}));
router.patch("/sections/:slug", programBody, programRoute(async (req, res) => {
  res.json({ section: await fitnessSections.update(pool(req), req.userId, fitnessRules.sectionSlug(req.params.slug), fitnessRules.sectionBody(req.body, { creating: false })) });
}));
router.post("/sections/:slug/move", programBody, programRoute(async (req, res) => {
  res.json({ sections: await fitnessSections.move(pool(req), req.userId, fitnessRules.sectionSlug(req.params.slug), fitnessRules.moveBody(req.body)) });
}));
router.delete("/sections/:slug", programRoute(async (req, res) => {
  await fitnessSections.remove(pool(req), req.userId, fitnessRules.sectionSlug(req.params.slug));
  res.json({ sections: await fitnessSections.all(pool(req)) });
}));

// The cover photo: PUT { data: base64, mediaType } adds or replaces it (checked from its bytes:
// JPEG, PNG or WebP, at most 2 MB), DELETE takes it off, GET reads it (hidden programs too).
// Answers the program. Uploads have their own hourly allowance on top of the portal's.
router.put("/programs/:programId/cover", limitPerUser(coverLimiter), coverBody, programRoute(async (req, res) => {
  const programId = fitnessRules.id(req.params.programId);
  const checked = fitnessCovers.checkCover(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.json({ program: await fitnessPrograms.setCover(pool(req), req.userId, programId, checked) });
}));
router.delete("/programs/:programId/cover", programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.removeCover(pool(req), req.userId, fitnessRules.id(req.params.programId)) });
}));
router.get("/programs/:programId/cover", programRoute(async (req, res) => {
  fitnessCovers.send(res, await fitnessPrograms.coverFile(pool(req), fitnessRules.id(req.params.programId), { admin: true }));
}));
// The program page's photo (shown at the top of the program's screen, not on its card): the same
// checks, limits and answers as the cover
router.put("/programs/:programId/hero", limitPerUser(coverLimiter), coverBody, programRoute(async (req, res) => {
  const programId = fitnessRules.id(req.params.programId);
  const checked = fitnessCovers.checkCover(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.json({ program: await fitnessPrograms.setHero(pool(req), req.userId, programId, checked) });
}));
router.delete("/programs/:programId/hero", programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.removeHero(pool(req), req.userId, fitnessRules.id(req.params.programId)) });
}));
router.get("/programs/:programId/hero", programRoute(async (req, res) => {
  fitnessCovers.send(res, await fitnessPrograms.heroFile(pool(req), fitnessRules.id(req.params.programId), { admin: true }));
}));
module.exports = { adminPortalRouter: router };
