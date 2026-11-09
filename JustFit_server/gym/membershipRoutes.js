// A member's gym memberships in the justFit app (Profile › Gym membership), mounted at
// /api/membership in index.js behind requireUser and a per-user rate limit. The memberships are
// the gym_members rows whose phone is the account's verified phone; nothing in the request names a
// gym or a member the caller doesn't hold. Pause Membership (Option A, 2026-11-07): the member
// asks with dates and a reason, the gym's staff approve or reject in the portal.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const pauses = require("./pauses");
const memberHub = require("./memberHub");
const crowd = require("./crowd");
const notices = require("../notifications/events");
const pauseRules = require("./pauseRules");
const rules = require("./rules");

const router = express.Router();
const smallBody = express.json({ limit: "2kb" });
const pool = (req) => req.app.locals.pool;
const today = () => rules.todayInIndia();

const MIGRATION = "Pause Membership needs the 2026-12-05-membership-pauses migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });
// 10 pause requests or cancellations an hour per account (GYM_PAUSE_REQUESTS_PER_HOUR; the test
// server raises it, as one suite sends the same member's refused requests many times)
const requestLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_PAUSE_REQUESTS_PER_HOUR) || 10, windowMs: 60 * 60 * 1000 }));

router.get("/", route(async (req, res) => {
  res.json(await pauses.myMemberships(pool(req), req.userId, today()));
}));
// Gym Hub's membership page (2026-11-09): one membership with its payments, pauses and a month of
// attendance (?month=YYYY-MM). Read only.
router.get("/:memberId", route(async (req, res) => {
  res.json(await memberHub.detail(pool(req), req.userId, rules.id(req.params.memberId, "membership"), req.query, today()));
}));
// Live crowd and best time to visit at the member's own gym (gym/crowd.js): read only
router.get("/:memberId/crowd", route(async (req, res) => {
  res.json(await crowd.forMember(pool(req), req.userId, rules.id(req.params.memberId, "membership"), today()));
}));
router.post("/:memberId/pause", requestLimit, smallBody, route(async (req, res) => {
  const memberId = rules.id(req.params.memberId, "membership");
  const answer = await pauses.requestPause(pool(req), req.userId, memberId, pauseRules.pauseBody(req.body, today()), today());
  if (answer.pause?.id) await notices.pauseRequested(pool(req), memberId, answer.pause.id);
  res.status(201).json(answer);
}));
router.delete("/:memberId/pause/:pauseId", requestLimit, route(async (req, res) => {
  res.json(await pauses.cancelPause(pool(req), req.userId, rules.id(req.params.memberId, "membership"), pauseRules.pauseId(req.params.pauseId), today()));
}));

module.exports = { membershipRouter: router };
