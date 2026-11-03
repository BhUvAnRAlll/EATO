// HTTP routes for the Fitness tab's programs, mounted at /api/fitness in index.js behind
// requireUser and the per-user rate limit. Every handler reads the member from req.userId, never
// the request, validates its input (fitness/rules.js) and hands errors to the shared handler.
const express = require("express");

const programs = require("./programs");
const covers = require("./covers");
const rules = require("./rules");
const place = require("../workout/place");
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

// A published program's cover photo (the program's coverUrl), read from the file its row names
router.get("/programs/:programId/cover", route(async (req, res) => {
  covers.send(res, await programs.coverFile(pool(req), rules.id(req.params.programId)));
}));
// A published program's page photo (its heroUrl), the same way
router.get("/programs/:programId/hero", route(async (req, res) => {
  covers.send(res, await programs.heroFile(pool(req), rules.id(req.params.programId)));
}));

// One program: its description and its sessions, each a YouTube video
router.get("/programs/:programId", route(async (req, res) => {
  res.json({ program: await programs.detail(pool(req), rules.id(req.params.programId)) });
}));

// The location sheet: what the member has at home and at their center
router.get("/equipment", route(async (req, res) => {
  res.json(await place.equipment(pool(req), req.userId));
}));
router.put("/equipment", smallBody, route(async (req, res) => {
  res.json(await place.saveEquipment(pool(req), req.userId, rules.equipmentBody(req.body)));
}));

module.exports = { fitnessRouter: router };
