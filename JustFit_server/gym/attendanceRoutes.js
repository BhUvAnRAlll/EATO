// QR attendance for members (and, since 2026-11-09, the branch's Staff and Trainers), mounted at /api/attendance in index.js behind requireUser and its own
// per-user rate limit. The member is found from the session's verified phone at the branch the
// scanned code names; nothing in the request names a gym or a member. The GPS reading is checked
// here (age, accuracy, mock flag, distance), never trusted as the app's verdict.
const express = require("express");
const crowd = require("./crowd");
const crowdRules = require("./crowdRules");
const notices = require("../notifications/events");

const attendance = require("./attendance");
const att = require("./attendanceRules");
const rules = require("./rules");

const router = express.Router();
const smallBody = express.json({ limit: "2kb" });
const pool = (req) => req.app.locals.pool;
const qrKey = (req) => req.app.locals.gymQrKey;
const today = () => rules.todayInIndia();

const MIGRATION = "QR attendance needs the 2026-11-27-gym-qr-attendance migration on this server.";
// A Staff or Trainer's scan (gym/staffAttendance.js) needs its own table
const STAFF_MIGRATION = "Staff attendance needs the 2026-12-15-staff-attendance migration on this server. Ask your gym admin.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE" && String(error.sqlMessage ?? "").includes("gym_staff_attendance")) return res.status(503).json({ error: STAFF_MIGRATION });
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
  const body = att.scanBody(req.body, { withPosition: true });
  const answer = await attendance.memberCheckIn(pool(req), req.userId, qrKey(req), body, today());
  // Crowd alerts for the gym's team (notifications/events.js); never fails the check-in
  try {
    const { live } = await crowd.crowdFor(pool(req), body.qr.gymId, today());
    await notices.capacityCheck(pool(req), body.qr.gymId, live, today(), crowdRules.hourInIndia(Date.now()));
  } catch {
    // nothing to tell
  }
  res.status(201).json(answer);
}));
router.post("/check-out", smallBody, route(async (req, res) => {
  res.json(await attendance.memberCheckOut(pool(req), req.userId, qrKey(req), att.scanBody(req.body, { withPosition: true }), today()));
}));

module.exports = { attendanceRouter: router };
