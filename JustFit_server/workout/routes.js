// HTTP routes for the workout hub and day screen, mounted at /api/workout in index.js behind
// requireUser and the per-user rate limit. Each handler validates its input, calls plans.js
// with the verified member id (never one from the request), and hands any error to the
// shared handler, which answers 400 with the message and logs only safe fields.
const express = require("express");

const { ensureUser } = require("../community/members");
const plans = require("./plans");
const v = require("./validate");

const router = express.Router();
const smallBody = express.json({ limit: "4kb" });

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;

// The hub and the day screen: the active plan, one day in full and the week strip
router.get("/home", route(async (req, res) => {
  res.json(await plans.home(pool(req), req.userId, v.homeQuery(req.query, Date.now())));
}));

// Recent days that were scheduled or trained, newest first
router.get("/history", route(async (req, res) => {
  res.json({ days: await plans.history(pool(req), req.userId, v.historyQuery(req.query, Date.now())) });
}));

// The active plan, generated from the member's profile the first time (idempotent)
router.post("/plan/ensure", smallBody, route(async (req, res) => {
  const { today } = v.ensureBody(req.body, Date.now());
  await ensureUser(pool(req), req.userId);
  const result = await plans.ensurePlan(pool(req), req.userId, today);
  res.status(result.created ? 201 : 200).json(result);
}));

// "Do it today instead?": today runs a missed day's session (one per-date override)
router.post("/reschedule/move", smallBody, route(async (req, res) => {
  res.json(await plans.moveSessionToToday(pool(req), req.userId, v.moveBody(req.body, Date.now())));
}));

// "Swap with today?": two dates trade sessions (two per-date overrides)
router.post("/reschedule/swap", smallBody, route(async (req, res) => {
  res.json(await plans.swapDays(pool(req), req.userId, v.swapBody(req.body, Date.now())));
}));

// The session for a date: the completed log, else the running one, with its logged sets
router.get("/session", route(async (req, res) => {
  const { date } = v.progressQuery(req.query, Date.now());
  res.json(await plans.sessionProgress(pool(req), req.userId, { date }));
}));

// Start (or pick up) today's session
router.post("/session/start", smallBody, route(async (req, res) => {
  const result = await plans.startSession(pool(req), req.userId, v.startBody(req.body, Date.now()));
  res.status(result.created ? 201 : 200).json(result);
}));

// One finished set, written as soon as it's done
router.post("/session/sets", smallBody, route(async (req, res) => {
  res.json(await plans.logSet(pool(req), req.userId, v.setBody(req.body)));
}));

// Finish the session, or end it early (the logged sets are kept either way)
router.post("/session/complete", smallBody, route(async (req, res) => {
  res.json(await plans.completeSession(pool(req), req.userId, v.logBody(req.body)));
}));
router.post("/session/abandon", smallBody, route(async (req, res) => {
  res.json(await plans.abandonSession(pool(req), req.userId, v.logBody(req.body)));
}));

// The plan's goal, level, training days and split, and whether the member may change them
router.get("/preferences", route(async (req, res) => {
  res.json(await plans.preferences(pool(req), req.userId));
}));

// Save new preferences: a new plan replaces the old one (kept as superseded)
router.put("/preferences", smallBody, route(async (req, res) => {
  res.json(await plans.updatePreferences(pool(req), req.userId, v.preferencesBody(req.body, Date.now())));
}));

// "Rebuild my plan": the saved answers the flow starts from
router.get("/recreate", route(async (req, res) => {
  res.json(await plans.recreateInputs(pool(req), req.userId, v.recreateQuery(req.query, Date.now())));
}));

// Save all thirteen answers and build the plan from them
router.post("/recreate", smallBody, route(async (req, res) => {
  res.json(await plans.recreatePlan(pool(req), req.userId, v.recreateBody(req.body, Date.now())));
}));

// What the reveal shows: the saved plan's facts, its sessions and the first session's exercises
router.get("/plan/overview", route(async (req, res) => {
  res.json(await plans.planOverview(pool(req), req.userId));
}));

module.exports = { workoutRouter: router };
