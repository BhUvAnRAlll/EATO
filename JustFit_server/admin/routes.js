// HTTP routes for the Super Admin portal, mounted at /api/admin/portal in index.js behind
// requireUser, the per-user rate limit and requireAdmin (users.role, checked every time).
// Handlers read the admin from req.userId, never from the request, and send errors to the
// shared handler.
const express = require("express");

const { overview } = require("./overview");
const users = require("./users");
const gyms = require("./gyms");
const reports = require("./reports");
const aiUsage = require("./aiUsage");
const usage = require("./usage");
const retention = require("./retention");
const usageExport = require("./export");
const aiRules = require("../ai/rules");
const { NotFoundError } = require("../community/posts");

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

// Users: search by name or email, filtered by kind (all, members, owners, suspended)
router.get("/users", route(async (req, res) => {
  res.json({ users: await users.listUsers(pool(req), users.listQuery(req.query)) });
}));

// One account: posts, reports against them, gyms
router.get("/users/:userId", route(async (req, res) => {
  res.json({ user: await users.userDetail(pool(req), userId(req)) });
}));

// Gyms: every gym with plan, owner and status (search by name or area)
router.get("/gyms", route(async (req, res) => {
  res.json({ gyms: await gyms.listGyms(pool(req), gyms.searchQuery(req.query)) });
}));

// Create a gym: a 14-day trial, owned by the chosen account
router.post("/gyms", smallBody, route(async (req, res) => {
  const id = await gyms.createGym(pool(req), req.userId, gyms.createBody(req.body));
  res.status(201).json({ gym: await gyms.gymDetail(pool(req), id) });
}));

// One gym: counts, owner, plan and status
router.get("/gyms/:gymId", route(async (req, res) => {
  res.json({ gym: await gyms.gymDetail(pool(req), gyms.gymId(req.params.gymId)) });
}));

// Change the plan (a label: nothing is charged)
router.put("/gyms/:gymId/plan", smallBody, route(async (req, res) => {
  res.json(await gyms.setPlan(pool(req), req.userId, gyms.gymId(req.params.gymId), gyms.planBody(req.body)));
}));

// Suspend or reinstate the gym
router.post("/gyms/:gymId/suspend", route(async (req, res) => {
  res.json(await gyms.setSuspended(pool(req), req.userId, gyms.gymId(req.params.gymId), true));
}));
router.delete("/gyms/:gymId/suspend", route(async (req, res) => {
  res.json(await gyms.setSuspended(pool(req), req.userId, gyms.gymId(req.params.gymId), false));
}));

// Reports grouped by the content they're about: ?status=open (default) or resolved
router.get("/reports", route(async (req, res) => {
  const status = reports.listQuery(req.query);
  const [groups, other] = await Promise.all([
    reports.listGroups(pool(req), status),
    reports.listGroups(pool(req), status === "open" ? "resolved" : "open"),
  ]);
  res.json({ groups, counts: { [status]: groups.length, [status === "open" ? "resolved" : "open"]: other.length } });
}));

// Remove or dismiss every open report on one post, comment or story
router.post("/reports/resolve", smallBody, route(async (req, res) => {
  res.json(await reports.resolveGroup(pool(req), req.userId, reports.resolveBody(req.body)));
}));

// AI usage and cost (admin/aiUsage.js): the summary for a period, the call history, the budget.
// Before migrations/2026-11-03-ai-usage.sql has run on this database, say so instead of a 500.
const aiRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: "AI usage tracking isn't set up on this server yet." });
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
