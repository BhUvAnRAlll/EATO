// HTTP routes for the gym admin portal (one branch at a time: the one the account last opened), mounted at /api/gym in index.js behind requireUser and
// the per-user rate limit. requireGymStaff reads the caller's role (users.role, every request) and
// their gym (gym_staff) from the database; every handler works on that gym only (req.gym), never
// on a gym or account named in the request. Bodies are small JSON, parsed per route.
const express = require("express");

const { getAccount } = require("../auth");
const { logSecurityEvent } = require("../logging");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const attendance = require("./attendance");
const attendanceRules = require("./attendanceRules");
const catalogImages = require("./catalogImages");
const photos = require("./photos");
const predictions = require("./predictions");
const predictionRules = require("./predictionRules");
const service = require("./service");
const rules = require("./rules");
const sms = require("./sms");
const staff = require("./staff");
const staffRules = require("./staffRules");
const trainer = require("./trainer");
const smsRules = require("./smsRules");

const router = express.Router();
const smallBody = express.json({ limit: "4kb" });
const pool = (req) => req.app.locals.pool;
const today = () => rules.todayInIndia();

// Before the gym migrations (2026-11-19-gym-portal.sql up to 2026-11-29-gym-staff-logins.sql)
// have run, say so instead of a 500
const MIGRATION = "The gym portal needs its migrations (up to 2026-12-04-catalog-images) on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

// 403 unless the caller is a gym admin or Staff linked to a gym (a trainer's link doesn't count)
async function requireGymStaff(req, res, next) {
  let account;
  try {
    account = await getAccount(req.userId, pool(req));
  } catch {
    return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
  }
  if (account.role !== "gym_admin") {
    logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
    return res.status(403).json({ error: "Only this gym's admins can do that." });
  }
  try {
    req.gym = await service.staffGym(pool(req), req.userId);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    return next(error);
  }
  if (!req.gym) return res.status(403).json({ error: "Your account isn't linked to a gym yet. Ask the justFit team to add you to your gym." });
  next();
}

router.use(requireGymStaff);

// Role & Permission (staffRules.areaOfPath): a Staff login reaches only the areas the gym admin
// gave them at this branch; the gym admin reaches everything, and routes without an area (the
// dashboard, branches) are open to every portal login. The areas come from the branch row read
// on this very request, so a change applies at once.
function requireArea(req, res, next) {
  const area = staffRules.areaOfPath(req.path);
  if (!area || staffRules.areasOf(req.gym).includes(area)) return next();
  logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
  return res.status(403).json({ error: `Your login doesn't include ${staffRules.AREA_LABEL[area]}. Ask your gym admin.` });
}
router.use(requireArea);

// Staff / Admin Login (gym/staff.js): only the branch's gym admin (kind 'owner', linked by the
// justFit Super Admin) sees and changes its team; Staff get a 403. Adding and removing have their
// own hourly allowance.
const ownerOnly = (message) => (req, res, next) => {
  if (req.gym.kind === "owner") return next();
  logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
  return res.status(403).json({ error: message });
};
const requireGymOwner = ownerOnly("Only the gym admin can manage the team.");
const staffLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));

router.get("/staff", requireGymOwner, route(async (req, res) => {
  res.json(await staff.team(pool(req), req.gym, req.userId));
}));
router.post("/staff", requireGymOwner, staffLimit, smallBody, route(async (req, res) => {
  const answer = await staff.add(pool(req), req.gym, req.userId, staffRules.addBody(req.body));
  res.status(answer.result === "added" ? 201 : 202).json(answer);
}));
// Role & Permission: which areas a Staff login may use at this branch (its own hourly allowance:
// switching areas on and off doesn't spend the add / remove budget)
const permissionLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));
router.put("/staff/:userId/permissions", requireGymOwner, permissionLimit, smallBody, route(async (req, res) => {
  res.json(await staff.setPermissions(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId), staffRules.permissionsBody(req.body)));
}));
router.delete("/staff/invites/:inviteId", requireGymOwner, staffLimit, route(async (req, res) => {
  res.json(await staff.cancelInvite(pool(req), req.gym, req.userId, rules.id(req.params.inviteId, "invite")));
}));
router.delete("/staff/:userId", requireGymOwner, staffLimit, route(async (req, res) => {
  res.json(await staff.remove(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId)));
}));

router.get("/dashboard", route(async (req, res) => {
  const dashboard = await service.dashboard(pool(req), req.gym, today());
  // Needs attention › Likely to leave: the members at high renewal risk (gym/predictions.js)
  dashboard.alerts.renewalRisk = await predictions.highRiskCount(pool(req), req.gym.id, today());
  res.json(dashboard);
}));

// Predictions (rules on the branch's own records, no AI): who may not renew, highest risk first
router.get("/predictions/renewals", route(async (req, res) => {
  res.json(await predictions.renewalRisks(pool(req), req.gym, predictionRules.renewalsQuery(req.query), today()));
}));
// Tomorrow's expected check-ins per hour, from the last four same weekdays (Attendance)
router.get("/predictions/busy-hours", route(async (req, res) => {
  res.json(await predictions.busyHours(pool(req), req.gym, today()));
}));
// Expected takings by month end: collected so far, likely renewals and dues (Wallet)
router.get("/predictions/revenue", route(async (req, res) => {
  res.json(await predictions.revenue(pool(req), req.gym, today()));
}));

// Home › Due Members: everyone with a due, each with how likely they are to pay it late
// (gym/predictionRules.js paymentRisk; rules only, nothing stored)
router.get("/predictions/payments", route(async (req, res) => {
  res.json(await predictions.paymentRisks(pool(req), req.gym, predictionRules.paymentsQuery(req.query), today()));
}));

// The account's branches, and switching to another one
router.get("/branches", route(async (req, res) => {
  res.json(await service.branches(pool(req), req.gym, req.userId));
}));
// The gym admin adds a branch (its name and location) and is linked to it; Staff get a 403.
// Branches are never deleted, so adding has a small allowance of its own.
const branchLimit = limitPerUser(createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }));
router.post("/branches", ownerOnly("Only the gym admin can add a branch."), branchLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await service.addBranch(pool(req), req.gym, req.userId, rules.branchBody(req.body)));
}));
router.post("/branch", smallBody, route(async (req, res) => {
  res.json(await service.switchBranch(pool(req), req.userId, rules.switchBody(req.body).branchId));
}));

// The branch's name and place, and the gym admin's own name
router.patch("/details", smallBody, route(async (req, res) => {
  res.json(await service.updateDetails(pool(req), req.gym, req.userId, rules.gymDetailsBody(req.body)));
}));

router.get("/members", route(async (req, res) => {
  res.json({ ...(await service.members(pool(req), req.gym.id, rules.membersQuery(req.query), today())), gym: service.gymInfo(req.gym) });
}));
router.post("/members", smallBody, route(async (req, res) => {
  res.status(201).json(await service.admit(pool(req), req.gym, req.userId, rules.admissionBody(req.body), today()));
}));
// The ID the next new member will get, shown on Add New Member before saving
router.get("/members/next-code", route(async (req, res) => {
  res.json(await service.nextMemberCode(pool(req), req.gym));
}));
router.get("/members/:memberId", route(async (req, res) => {
  res.json(await service.member(pool(req), req.gym.id, rules.id(req.params.memberId), today()));
}));
router.patch("/members/:memberId", smallBody, route(async (req, res) => {
  res.json(await service.editMember(pool(req), req.gym.id, rules.id(req.params.memberId), rules.memberEditBody(req.body), today()));
}));
router.post("/members/:memberId/renew", smallBody, route(async (req, res) => {
  res.json(await service.renew(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), rules.renewalBody(req.body), today()));
}));
router.post("/members/:memberId/due", smallBody, route(async (req, res) => {
  res.json(await service.collectDue(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), rules.duePaymentBody(req.body), today()));
}));
// The branch's trainers (Staff / Admin Login), for the PT form's picker; and Change trainer
router.get("/trainers", route(async (req, res) => {
  res.json(await trainer.branchTrainers(pool(req), req.gym.id));
}));
router.post("/members/:memberId/trainer", smallBody, route(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  await trainer.setTrainer(pool(req), req.gym.id, memberId, rules.trainerBody(req.body).trainerId);
  res.json(await service.member(pool(req), req.gym.id, memberId, today()));
}));
router.post("/members/:memberId/pt", smallBody, route(async (req, res) => {
  res.json(await service.personalTraining(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), rules.ptBody(req.body), today()));
}));
// From a member's ⋯: Sell Product (taken out of stock) and Add Service, priced from the catalogue
router.post("/members/:memberId/sales", smallBody, route(async (req, res) => {
  res.status(201).json(await service.sellToMember(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), "product", rules.memberSaleBody(req.body, { product: true }), today()));
}));
router.post("/members/:memberId/services", smallBody, route(async (req, res) => {
  res.status(201).json(await service.sellToMember(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), "service", rules.memberSaleBody(req.body, { product: false }), today()));
}));
// Staff check a member in or out by hand (members without the app); QR scans are in
// gym/attendanceRoutes.js
router.post("/members/:memberId/check-in", route(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  const { alreadyIn } = await attendance.staffCheckIn(pool(req), req.gym.id, req.userId, memberId, today());
  res.json({ ...(await service.member(pool(req), req.gym.id, memberId, today())), alreadyIn });
}));
router.post("/members/:memberId/check-out", route(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  const { durationMin } = await attendance.staffCheckOut(pool(req), req.gym.id, req.userId, memberId);
  res.json({ ...(await service.member(pool(req), req.gym.id, memberId, today())), durationMin });
}));

// A member's photo (gym/photos.js): PUT { data: base64, mediaType } adds or replaces it (checked
// from its bytes: JPEG, PNG or WebP, at most 3 MB) and answers the member, DELETE takes it off,
// GET reads it. Only this branch's members; uploads have their own hourly allowance.
const PHOTO_MIGRATION = "Member photos need the 2026-11-26-member-photos migration on this server.";
const photoRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: PHOTO_MIGRATION });
    next(error);
  });
const photoBody = express.json({ limit: Math.ceil(photos.photoLimits.maxBytes * (4 / 3)) + 1024 });
const photoLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));

router.put("/members/:memberId/photo", photoLimit, photoBody, photoRoute(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  const checked = photos.checkMemberPhoto(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  await photos.setPhoto(pool(req), req.gym.id, memberId, checked);
  res.json(await service.member(pool(req), req.gym.id, memberId, today()));
}));
router.delete("/members/:memberId/photo", photoRoute(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  await photos.removePhoto(pool(req), req.gym.id, memberId);
  res.json(await service.member(pool(req), req.gym.id, memberId, today()));
}));
router.get("/members/:memberId/photo", photoRoute(async (req, res) => {
  photos.send(res, await photos.photoFile(pool(req), req.gym.id, rules.id(req.params.memberId)));
}));

router.get("/payments", route(async (req, res) => {
  res.json(await service.payments(pool(req), req.gym.id, rules.paymentsQuery(req.query), today()));
}));
router.post("/services", smallBody, route(async (req, res) => {
  res.status(201).json(await service.service(pool(req), req.gym.id, req.userId, rules.serviceBody(req.body), today()));
}));
router.post("/sales", smallBody, route(async (req, res) => {
  res.status(201).json(await service.sale(pool(req), req.gym.id, req.userId, rules.saleBody(req.body), today()));
}));

router.get("/enquiries", route(async (req, res) => {
  res.json({ ...(await service.enquiries(pool(req), req.gym.id, rules.enquiriesQuery(req.query), today())), gym: service.gymInfo(req.gym) });
}));
router.post("/enquiries", smallBody, route(async (req, res) => {
  res.status(201).json(await service.addEnquiry(pool(req), req.gym.id, req.userId, rules.enquiryBody(req.body, today()), today()));
}));
// Follow-up: the details, the call-back day, the status, and the member they became
// A contact attempt with an enquiry (a call, WhatsApp or a visit, and how it went): feeds the
// conversion score. 60 an hour per account.
const contactLimit = limitPerUser(createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }));
router.post("/enquiries/:enquiryId/contacts", contactLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await service.addContact(pool(req), req.gym.id, req.userId, rules.id(req.params.enquiryId, "enquiry"), rules.contactBody(req.body), today()));
}));
router.patch("/enquiries/:enquiryId", smallBody, route(async (req, res) => {
  res.json(await service.editEnquiry(pool(req), req.gym.id, rules.id(req.params.enquiryId, "enquiry"), rules.enquiryEditBody(req.body, today())));
}));

// Plans / Catalogue: the branch's membership plans, PT packages and products with their prices
router.get("/catalog", route(async (req, res) => {
  res.json(await service.catalog(pool(req), req.gym.id));
}));
router.post("/catalog", smallBody, route(async (req, res) => {
  res.status(201).json(await service.addItem(pool(req), req.gym.id, req.userId, rules.catalogBody(req.body, { creating: true })));
}));
router.patch("/catalog/:itemId", smallBody, route(async (req, res) => {
  res.json(await service.editItem(pool(req), req.gym.id, rules.id(req.params.itemId, "item"), rules.catalogBody(req.body, { creating: false })));
}));
router.delete("/catalog/:itemId", route(async (req, res) => {
  const { removedImage, ...answer } = await service.deleteItem(pool(req), req.gym.id, rules.id(req.params.itemId, "item"));
  if (removedImage) await catalogImages.discard(removedImage);
  res.json(answer);
}));

// An item's optional image (gym/catalogImages.js): PUT { data: base64, mediaType } adds or replaces
// it (checked from its bytes: JPEG, PNG or WebP, at most 3 MB) and answers the catalogue, DELETE
// takes it off, GET reads it. Only this branch's items; uploads share the photos' hourly allowance.
const IMAGE_MIGRATION = "Catalogue images need the 2026-12-04-catalog-images migration on this server.";
const imageRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: IMAGE_MIGRATION });
    next(error);
  });
const imageBody = express.json({ limit: Math.ceil(catalogImages.imageLimits.maxBytes * (4 / 3)) + 1024 });

router.put("/catalog/:itemId/image", photoLimit, imageBody, imageRoute(async (req, res) => {
  const itemId = rules.id(req.params.itemId, "item");
  const checked = catalogImages.checkItemImage(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  await catalogImages.setImage(pool(req), req.gym.id, itemId, checked);
  res.json(await service.catalog(pool(req), req.gym.id));
}));
router.delete("/catalog/:itemId/image", imageRoute(async (req, res) => {
  await catalogImages.removeImage(pool(req), req.gym.id, rules.id(req.params.itemId, "item"));
  res.json(await service.catalog(pool(req), req.gym.id));
}));
router.get("/catalog/:itemId/image", imageRoute(async (req, res) => {
  catalogImages.send(res, await catalogImages.imageFile(pool(req), req.gym.id, rules.id(req.params.itemId, "item")));
}));

// Send Bulk SMS (gym/sms.js): credits, Auto Reminders, Manual Send, a member's reminder, Message
// Logs. Sending costs the branch's credits, so sends have their own small budget per account.
const SMS_MIGRATION = "SMS needs the 2026-11-25-gym-sms migration on this server.";
const smsRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: SMS_MIGRATION });
    next(error);
  });
const smsSendLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));
const sender = (req) => req.app.locals.gymSms;

router.get("/sms", smsRoute(async (req, res) => {
  res.json(await sms.overview(pool(req), req.gym, sender(req), today()));
}));
router.patch("/sms/settings", smallBody, smsRoute(async (req, res) => {
  res.json(await sms.updateSettings(pool(req), req.gym, req.userId, smsRules.settingsBody(req.body), sender(req), today()));
}));
router.post("/sms/send", smsSendLimit, smallBody, smsRoute(async (req, res) => {
  res.json(await sms.sendToGroup(pool(req), req.gym, req.userId, sender(req), smsRules.sendBody(req.body).group, today()));
}));
router.post("/members/:memberId/sms", smsSendLimit, smallBody, smsRoute(async (req, res) => {
  const memberId = rules.id(req.params.memberId);
  res.json(await sms.sendToMember(pool(req), req.gym, req.userId, sender(req), memberId, smsRules.memberSmsBody(req.body).kind));
}));
router.get("/sms/logs", smsRoute(async (req, res) => {
  res.json(await sms.logs(pool(req), req.gym.id, smsRules.logsQuery(req.query)));
}));

// QR attendance (gym/attendance.js): the branch's location, radius and QR code, the dashboard,
// the history and its CSV export. The QR code is signed with a key from AUTH_SECRET.
const qrKey = (req) => req.app.locals.gymQrKey;
router.get("/attendance/settings", route(async (req, res) => {
  res.json(await attendance.settings(pool(req), req.gym, qrKey(req)));
}));
router.put("/attendance/location", smallBody, route(async (req, res) => {
  res.json(await attendance.saveLocation(pool(req), req.gym, req.userId, attendanceRules.locationBody(req.body), qrKey(req)));
}));
router.post("/attendance/qr", route(async (req, res) => {
  res.json(await attendance.regenerateQr(pool(req), req.gym, req.userId, qrKey(req)));
}));
router.get("/attendance", route(async (req, res) => {
  res.json(await attendance.summary(pool(req), req.gym, today()));
}));
router.get("/attendance/visits", route(async (req, res) => {
  res.json(await attendance.history(pool(req), req.gym.id, attendanceRules.historyQuery(req.query, today())));
}));
router.get("/attendance/export", route(async (req, res) => {
  const query = attendanceRules.historyQuery(req.query, today());
  const csv = await attendance.exportCsv(pool(req), req.gym.id, query);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="attendance-${query.from}-to-${query.to}.csv"`);
  res.send(`\uFEFF${csv}`);
}));

router.get("/wallet", route(async (req, res) => {
  res.json(await service.wallet(pool(req), req.gym.id, today()));
}));

module.exports = { gymRouter: router };
