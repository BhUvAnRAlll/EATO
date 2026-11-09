// Reporting a gym (Gym Hub ecosystem, section 7), mounted at /api/complaints in index.js behind
// requireUser and a per-user rate limit: a member reports a branch and reads their own reports.
// justFit admins work the cases from admin/routes.js. Before migration 2027-01-20, a 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const service = require("./service");
const rules = require("./rules");

const router = express.Router({ caseSensitive: true, strict: true });
const pool = (req) => req.app.locals.pool;
const MIGRATION = "Reporting a gym needs the 2027-01-20-complaints-and-settings migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: MIGRATION });
    next(error);
  });
// 10 reports a day per member (GYM_REPORTS_PER_DAY; the test server raises it)
const reportLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_REPORTS_PER_DAY) || 10, windowMs: 24 * 60 * 60 * 1000 }));

router.get("/", route(async (req, res) => {
  res.json(await service.mine(pool(req), req.userId));
}));
router.post("/", reportLimit, express.json({ limit: "4kb" }), route(async (req, res) => {
  res.status(201).json(await service.report(pool(req), req.userId, rules.reportBody(req.body)));
}));

module.exports = { complaintsRouter: router };
