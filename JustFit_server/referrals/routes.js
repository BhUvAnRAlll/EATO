// Members, /api/referrals (requireUser and the meals budget in index.js): GET / (my code and
// friends), POST /claim { code } (10 an hour).
const express = require("express");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const rules = require("./rules");
const referrals = require("./service");

const router = express.Router();
const smallBody = express.json({ limit: "2kb" });
const claimLimit = limitPerUser(createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }));
const route = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};

router.get("/", route(async (req, res) => {
  res.json(await referrals.mine(req.app.locals.pool, req.userId));
}));
router.post("/claim", claimLimit, smallBody, route(async (req, res) => {
  const body = rules.claimBody(req.body);
  res.status(201).json(await referrals.claim(req.app.locals.pool, req.userId, body));
}));

module.exports = { referralsRouter: router };
