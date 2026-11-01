// HTTP routes for the Super Admin portal, mounted at /api/admin/portal in index.js behind
// requireUser, the per-user rate limit and requireAdmin (users.role, checked every time).
// Handlers read the admin from req.userId, never from the request, and send errors to the
// shared handler.
const express = require("express");

const { overview } = require("./overview");
const users = require("./users");
const aiUsage = require("./aiUsage");
const usage = require("./usage");
const retention = require("./retention");
const usageExport = require("./export");
const exercises = require("./exercises");
const exerciseRules = require("./exerciseRules");
const fitnessPrograms = require("../fitness/programs");
const fitnessRules = require("../fitness/rules");
const { CoachPlanError } = require("../coach/planRules");
const aiRules = require("../ai/rules");
const { NotFoundError } = require("../errors");

const router = express.Router();
const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;

// Overview: platform counts, the to-do list and recent admin activity
router.get("/overview", route(async (req, res) => {
  res.json(await overview(pool(req)));
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
const programRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD"].includes(error?.code)) {
      return res.status(503).json({ error: "Programs need the 2026-11-09-fitness-programs migration on this server." });
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
router.post("/programs/:programId/redraft", programBody, programRoute(async (req, res) => {
  res.json({ program: await fitnessPrograms.redraft(pool(req), req.userId, fitnessRules.id(req.params.programId), fitnessRules.redraftBody(req.body)) });
}));

module.exports = { adminPortalRouter: router };
