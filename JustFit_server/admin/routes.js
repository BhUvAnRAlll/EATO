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

module.exports = { adminPortalRouter: router };
