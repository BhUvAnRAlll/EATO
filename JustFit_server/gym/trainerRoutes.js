// A gym trainer's own routes (mounted at /api/trainer after requireUser and the per-user rate
// limit): My Clients, a client's page and their photo. requireTrainer reads the caller's role from
// the database on every request; what a trainer may see is scoped in gym/trainer.js.
const express = require("express");

const { getAccount } = require("../auth");
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

module.exports = { trainerRouter: router, requireTrainer, refuseTrainers };
