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

module.exports = { workoutRouter: router };
