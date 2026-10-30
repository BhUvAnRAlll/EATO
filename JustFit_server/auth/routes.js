// /api/auth: phone sign-in, who am I, logout.
//
//   POST /request-otp  { phone }          → { sent, retryAfterSeconds, expiresInSeconds }
//   POST /verify-otp   { phone, code }    → { token, expiresAt, user }
//   GET  /me                               → { user }
//   POST /logout                           → { signedOut }        (this device)
//   POST /logout-all                       → { signedOut, sessions } (every device)
//
// The first two run before anyone is signed in, so they are budgeted per IP address (and,
// inside the service, per phone number). The others need a session (requireUser).
const express = require("express");
const { ValidationError } = require("../profile");
const { requireUser } = require("../auth");
const { createRateLimiter, limitPerIp, limitPerUser, rateLimits } = require("../rateLimit");
const { normalizePhone } = require("./phone");
const otp = require("./otp");
const service = require("./service");
const sessions = require("./sessions");

const smallBody = express.json({ limit: "1kb" });

// Only the expected fields, as strings
function readBody(body, fields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("The request body must be a JSON object.");
  for (const key of Object.keys(body)) if (!fields.includes(key)) throw new ValidationError("The request has a field that isn't allowed.");
  return body;
}

// A refusal from the service: its status, message and (for 429) Retry-After
function sendRefusal(res, error) {
  if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
  res.status(error.status ?? 400).json({ error: error.message });
}

function authRouter({ pool, sms, otpKey, config, devLogin = null }) {
  const router = express.Router();
  const window = config.ipWindowSeconds * 1000;
  const requestLimiter = createRateLimiter({ limit: config.ipRequestLimit, windowMs: window });
  const verifyLimiter = createRateLimiter({ limit: config.ipVerifyLimit, windowMs: window });
  const accountLimiter = createRateLimiter(rateLimits.standard);

  router.post("/request-otp", limitPerIp(requestLimiter), smallBody, async (req, res, next) => {
    try {
      const body = readBody(req.body, ["phone"]);
      const phone = normalizePhone(body.phone);
      const sent = await service.requestOtp(pool, phone, { sms, otpKey, config, devLogin });
      res.json({ sent: true, ...sent });
    } catch (error) {
      if (error instanceof ValidationError) return sendRefusal(res, error);
      next(error);
    }
  });

  router.post("/verify-otp", limitPerIp(verifyLimiter), smallBody, async (req, res, next) => {
    try {
      const body = readBody(req.body, ["phone", "code"]);
      const phone = normalizePhone(body.phone);
      if (typeof body.code !== "string" || !otp.CODE.test(body.code)) throw new ValidationError("Enter the 6-digit code.");
      res.json(await service.verifyOtp(pool, phone, body.code, { otpKey, config }));
    } catch (error) {
      if (error instanceof ValidationError) return sendRefusal(res, error);
      next(error);
    }
  });

  router.get("/me", requireUser, limitPerUser(accountLimiter), async (req, res, next) => {
    try {
      const user = await service.accountFor(pool, req.userId);
      if (!user) return res.status(401).json({ error: "Please sign in again." });
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", requireUser, limitPerUser(accountLimiter), async (req, res, next) => {
    try {
      await sessions.revokeSession(pool, req.sessionId, req.userId);
      res.json({ signedOut: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout-all", requireUser, limitPerUser(accountLimiter), async (req, res, next) => {
    try {
      res.json({ signedOut: true, sessions: await sessions.revokeAllSessions(pool, req.userId) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { authRouter };
