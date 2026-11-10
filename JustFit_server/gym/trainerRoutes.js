// A gym trainer's own routes (mounted at /api/trainer after requireUser and the per-user rate
// limit): My Clients, a client's page and their photo. requireTrainer reads the caller's role from
// the database on every request; what a trainer may see is scoped in gym/trainer.js.
const express = require("express");

const { getAccount } = require("../auth");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const dietPlans = require("./dietPlans");
const dietRules = require("./dietPlanRules");
const { logSecurityEvent } = require("../logging");
const photos = require("./photos");
const rules = require("./rules");
const trainer = require("./trainer");

const router = express.Router();
const pool = (req) => req.app.locals.pool;
const today = () => rules.todayInIndia();

const MIGRATION = "My Clients needs the 2026-11-29-gym-staff-logins migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

// 403 unless the caller is a gym's trainer
async function requireTrainer(req, res, next) {
  let account;
  try {
    account = await getAccount(req.userId, pool(req));
  } catch {
    return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
  }
  if (account.role !== "trainer") {
    logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
    return res.status(403).json({ error: "Only a gym's trainers have clients here." });
  }
  next();
}

// AI Coach, Workout and Fitness aren't part of a trainer's account (the user's choice, 2026-11-05):
// placed in front of those routes, it answers a trainer with 403 and lets everyone else through
async function refuseTrainers(req, res, next) {
  let account;
  try {
    account = await getAccount(req.userId, pool(req));
  } catch {
    return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
  }
  if (account.role === "trainer") return res.status(403).json({ error: "AI Coach and Fitness aren't part of a trainer's account." });
  next();
}

router.use(requireTrainer);

router.get("/clients", route(async (req, res) => {
  res.json(await trainer.clients(pool(req), req.userId, today()));
}));
router.get("/clients/:memberId", route(async (req, res) => {
  res.json(await trainer.client(pool(req), req.userId, rules.id(req.params.memberId, "client"), today()));
}));
router.get("/clients/:memberId/photo", route(async (req, res) => {
  const memberId = rules.id(req.params.memberId, "client");
  const gymId = await trainer.clientGymId(pool(req), req.userId, memberId, today());
  photos.send(res, await photos.photoFile(pool(req), gymId, memberId));
}));

// A client's diet plan (2026-11-10, migration 2027-01-27): read, save, remove. Saves are 60 an hour
// per trainer (TRAINER_DIET_SAVES_PER_HOUR); a plan's JSON is small, so the body is capped at 16 kb
const DIET_MIGRATION = "Diet plans need the 2027-01-27-trainer-diet-plans migration on this server.";
const dietRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: DIET_MIGRATION });
    next(error);
  });
const dietSaves = limitPerUser(createRateLimiter({ limit: Number(process.env.TRAINER_DIET_SAVES_PER_HOUR) || 60, windowMs: 60 * 60 * 1000 }));
const dietBody = express.json({ limit: "16kb" });
router.get("/clients/:memberId/diet-plan", dietRoute(async (req, res) => {
  res.json(await dietPlans.forTrainer(pool(req), req.userId, rules.id(req.params.memberId, "client"), today()));
}));
router.put("/clients/:memberId/diet-plan", dietSaves, dietBody, dietRoute(async (req, res) => {
  const memberId = rules.id(req.params.memberId, "client");
  res.json(await dietPlans.save(pool(req), req.userId, memberId, dietRules.planBody(req.body), today()));
}));
router.delete("/clients/:memberId/diet-plan", dietSaves, dietRoute(async (req, res) => {
  res.json(await dietPlans.remove(pool(req), req.userId, rules.id(req.params.memberId, "client"), today()));
}));

module.exports = { trainerRouter: router, requireTrainer, refuseTrainers };
