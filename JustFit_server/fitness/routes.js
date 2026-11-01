// HTTP routes for the Fitness tab's programs, mounted at /api/fitness in index.js behind
// requireUser and the per-user rate limit. Every handler reads the member from req.userId, never
// the request, validates its input (fitness/rules.js) and hands errors to the shared handler.
const express = require("express");

const programs = require("./programs");
const rules = require("./rules");
const place = require("../workout/place");
const v = require("../workout/validate");
const { CoachPlanError } = require("../coach/planRules");

const router = express.Router();
const smallBody = express.json({ limit: "2kb" });
const pool = (req) => req.app.locals.pool;

// Before migrations/2026-11-09-fitness-programs.sql has run, say so instead of a 500
const MIGRATION = "Fitness programs need the 2026-11-09-fitness-programs migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    if (error instanceof CoachPlanError) return res.status(error.status).json({ error: error.message });
    next(error);
  });

// The six sections for home or the center, with an optional search
router.get("/programs", route(async (req, res) => {
  res.json(await programs.list(pool(req), rules.listQuery(req.query)));
}));

// One program: its description and every session with its exercises
router.get("/programs/:programId", route(async (req, res) => {
  res.json({ program: await programs.detail(pool(req), rules.id(req.params.programId)) });
}));

// Do this session today: it becomes today's workout (the day screen and player run it)
router.post("/programs/:programId/sessions/:sessionId/today", smallBody, route(async (req, res) => {
  const { today } = v.ensureBody(req.body, Date.now());
  res.json(await programs.startToday(pool(req), req.userId, { programId: rules.id(req.params.programId), sessionId: rules.id(req.params.sessionId, "session"), today }));
}));

// The location sheet: what the member has at home and at their center
router.get("/equipment", route(async (req, res) => {
  res.json(await place.equipment(pool(req), req.userId));
}));
router.put("/equipment", smallBody, route(async (req, res) => {
  res.json(await place.saveEquipment(pool(req), req.userId, rules.equipmentBody(req.body)));
}));

module.exports = { fitnessRouter: router };
