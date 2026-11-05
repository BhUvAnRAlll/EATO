// QR attendance for members, mounted at /api/attendance in index.js behind requireUser and its own
// per-user rate limit. The member is found from the session's verified phone at the branch the
// scanned code names; nothing in the request names a gym or a member. The GPS reading is checked
// here (age, accuracy, mock flag, distance), never trusted as the app's verdict.
const express = require("express");

const attendance = require("./attendance");
const att = require("./attendanceRules");
const rules = require("./rules");

const router = express.Router();
const smallBody = express.json({ limit: "2kb" });
const pool = (req) => req.app.locals.pool;
const qrKey = (req) => req.app.locals.gymQrKey;
const today = () => rules.todayInIndia();

const MIGRATION = "QR attendance needs the 2026-11-27-gym-qr-attendance migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

// The member's recent visits
router.get("/", route(async (req, res) => {
  res.json(await attendance.myVisits(pool(req), req.userId));
}));
// After scanning: the gym, the membership, and whether this scan checks in or out
router.post("/scan", smallBody, route(async (req, res) => {
  res.json(await attendance.scanPreview(pool(req), req.userId, qrKey(req), att.scanBody(req.body, { withPosition: false }), today()));
}));
router.post("/check-in", smallBody, route(async (req, res) => {
  res.status(201).json(await attendance.memberCheckIn(pool(req), req.userId, qrKey(req), att.scanBody(req.body, { withPosition: true }), today()));
}));
router.post("/check-out", smallBody, route(async (req, res) => {
  res.json(await attendance.memberCheckOut(pool(req), req.userId, qrKey(req), att.scanBody(req.body, { withPosition: true }), today()));
}));

module.exports = { attendanceRouter: router };
