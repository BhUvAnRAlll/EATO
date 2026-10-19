// HTTP routes for the gym owner portal, mounted at /api/owner in index.js behind requireUser
// and the per-user rate limit. The caller is always req.userId; owner.js checks, for the gym in
// the path, that they are its active owner or admin (or an EATO platform admin).
const express = require("express");

const cv = require("../community/validate");
const owner = require("./owner");
const attendance = require("./attendance");
const notices = require("./notices");

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

// Renewal reminders: everyone expired or ending this week (before /:userId, which would match it)
router.post("/gyms/:gymId/renewals/remind-due", route(async (req, res) => {
  res.status(201).json(await notices.remindDue(pool(req), req.userId, gymId(req)));
}));
router.post("/gyms/:gymId/renewals/:userId/remind", route(async (req, res) => {
  res.status(201).json(await notices.remindOne(pool(req), req.userId, gymId(req), memberId(req)));
}));

// Renew one member's package by 1 or 3 months (recorded only, no payment)
router.post("/gyms/:gymId/renewals/:userId", smallBody, route(async (req, res) => {
  res.json(await owner.renew(pool(req), req.userId, gymId(req), memberId(req), owner.validateRenewal(req.body)));
}));

// A member's own package in a gym (the member's side of renewals)
router.get("/my-plan/:gymId", route(async (req, res) => {
  res.json(await owner.myPlan(pool(req), req.userId, gymId(req)));
}));

// ---- Community tab and Notify members (notices.js) ----

// The Community tab: a live count for each part of the gym, and the latest posts
router.get("/gyms/:gymId/community", route(async (req, res) => {
  res.json(await owner.community(pool(req), req.userId, gymId(req)));
}));

// Notify members: how many each audience reaches, the sent list, and sending (or a test to yourself)
router.get("/gyms/:gymId/notices/audiences", route(async (req, res) => {
  res.json(await notices.audiences(pool(req), req.userId, gymId(req)));
}));
router.get("/gyms/:gymId/notices", route(async (req, res) => {
  res.json(await notices.sent(pool(req), req.userId, gymId(req)));
}));
router.post("/gyms/:gymId/notices", express.json({ limit: "32kb" }), route(async (req, res) => {
  res.status(201).json(await notices.send(pool(req), req.userId, gymId(req), notices.validateNotice(req.body)));
}));

// ---- QR attendance (attendance.js) ----

const visitId = (req) => cv.id(req.params.visitId, "The visit");

// Front desk: who a scanned pass names and whether they may check in (a refusal is recorded)
router.post("/gyms/:gymId/attendance/verify", smallBody, route(async (req, res) => {
  res.json(await attendance.verify(pool(req), req.userId, gymId(req), attendance.validateScan(req.body)));
}));

// Front desk: check the member in (409 with the reason when they can't)
router.post("/gyms/:gymId/attendance/checkin", smallBody, route(async (req, res) => {
  res.status(201).json(await attendance.checkIn(pool(req), req.userId, gymId(req), attendance.validateScan(req.body)));
}));

// The Check-in tab: counts, in the gym now, completed today, recent activity
router.get("/gyms/:gymId/attendance/today", route(async (req, res) => {
  res.json(await attendance.today(pool(req), req.userId, gymId(req)));
}));

// Today's list (?filter=all|in|out&search=name)
router.get("/gyms/:gymId/attendance/visits", route(async (req, res) => {
  const filter = req.query.filter === undefined ? "all" : String(req.query.filter);
  res.json(await attendance.listVisits(pool(req), req.userId, gymId(req), { filter, search: cv.searchTerm(req.query.search) }));
}));

router.get("/gyms/:gymId/attendance/visits/:visitId", route(async (req, res) => {
  res.json(await attendance.getVisit(pool(req), req.userId, gymId(req), visitId(req)));
}));

// Staff end a visit
router.post("/gyms/:gymId/attendance/visits/:visitId/checkout", route(async (req, res) => {
  res.json(await attendance.staffCheckout(pool(req), req.userId, gymId(req), visitId(req)));
}));

// The gym's check-out QR: read (made on first use), switch on or off, regenerate
router.get("/gyms/:gymId/checkout-qr", route(async (req, res) => {
  res.json(await attendance.checkoutQr(pool(req), req.userId, gymId(req)));
}));
router.patch("/gyms/:gymId/checkout-qr", smallBody, route(async (req, res) => {
  res.json(await attendance.setCheckoutQr(pool(req), req.userId, gymId(req), attendance.validateCheckoutQr(req.body)));
}));
router.post("/gyms/:gymId/checkout-qr/rotate", route(async (req, res) => {
  res.json(await attendance.rotateCheckoutQr(pool(req), req.userId, gymId(req)));
}));

// The member's side: their own pass, their open visit, and checking out with the gym's QR
router.get("/me/pass", route(async (req, res) => {
  res.json(attendance.myPass(req.userId));
}));
router.get("/me/visit", route(async (req, res) => {
  res.json(await attendance.myVisit(pool(req), req.userId));
}));
router.post("/me/checkout", smallBody, route(async (req, res) => {
  res.json(await attendance.memberCheckout(pool(req), req.userId, attendance.validateCheckoutScan(req.body)));
}));

module.exports = { ownerRouter: router };
