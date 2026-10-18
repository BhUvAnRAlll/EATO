// HTTP routes for the gym owner portal, mounted at /api/owner in index.js behind requireUser
// and the per-user rate limit. The caller is always req.userId; owner.js checks, for the gym in
// the path, that they are its active owner or admin (or an EATO platform admin).
const express = require("express");

const cv = require("../community/validate");
const owner = require("./owner");

const router = express.Router();
const smallBody = express.json({ limit: "4kb" });

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;
const gymId = (req) => cv.id(req.params.gymId, "The gym");
const memberId = (req) => cv.clerkUserId(req.params.userId, "The member");

// The gyms the caller runs (the entry button and the portal's gym switcher)
router.get("/gyms", route(async (req, res) => {
  res.json(await owner.managedGyms(pool(req), req.userId));
}));

// Home: today at a glance
router.get("/gyms/:gymId/summary", route(async (req, res) => {
  res.json(await owner.summary(pool(req), req.userId, gymId(req)));
}));

// Renewals: every member's package, soonest to end first
router.get("/gyms/:gymId/renewals", route(async (req, res) => {
  res.json(await owner.renewals(pool(req), req.userId, gymId(req)));
}));

// Renew one member's package by 1 or 3 months (recorded only, no payment)
router.post("/gyms/:gymId/renewals/:userId", smallBody, route(async (req, res) => {
  res.json(await owner.renew(pool(req), req.userId, gymId(req), memberId(req), owner.validateRenewal(req.body)));
}));

// A member's own package in a gym (the member's side of renewals)
router.get("/my-plan/:gymId", route(async (req, res) => {
  res.json(await owner.myPlan(pool(req), req.userId, gymId(req)));
}));

module.exports = { ownerRouter: router };
