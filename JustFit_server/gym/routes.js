// HTTP routes for the gym admin portal (one branch at a time: the one the account last opened), mounted at /api/gym in index.js behind requireUser and
// the per-user rate limit. requireGymStaff reads the caller's role (users.role, every request) and
// their gym (gym_staff) from the database; every handler works on that gym only (req.gym), never
// on a gym or account named in the request. Bodies are small JSON, parsed per route.
const express = require("express");

const { getAccount } = require("../auth");
const { logSecurityEvent } = require("../logging");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const activity = require("./activity");
const activityRules = require("./activityRules");
const attendance = require("./attendance");
const attendanceRules = require("./attendanceRules");
const catalogImages = require("./catalogImages");
const expenseBills = require("./expenseBills");
const expenseRules = require("./expenseRules");
const expenses = require("./expenses");
const logos = require("./logos");
const gymProfile = require("./gymProfile");
const profileRules = require("./profileRules");
const paymentReceipts = require("./paymentReceipts");
const invoices = require("./invoices");
const invoiceRules = require("./invoiceRules");
const photos = require("./photos");
const pauses = require("./pauses");
const pauseRules = require("./pauseRules");
const predictions = require("./predictions");
const predictionRules = require("./predictionRules");
const service = require("./service");
const rules = require("./rules");
const sms = require("./sms");
const templates = require("./templates");
const templateRules = require("./templateRules");
const staff = require("./staff");
const staffRules = require("./staffRules");
const trainer = require("./trainer");
const smsRules = require("./smsRules");
const staffAttendance = require("./staffAttendance");

// Exact paths only: Express would otherwise match /Payments or /payments/ to the /payments route,
// while the Role & Permission map (staffRules.areaOfPath) read them as no area at all, so a Staff
// login could reach an area it wasn't given by changing a letter's case or adding a slash (QA, 2026-11-07)
const router = express.Router({ caseSensitive: true, strict: true });
const smallBody = express.json({ limit: "4kb" });
const pool = (req) => req.app.locals.pool;
const today = () => rules.todayInIndia();

// Before the gym migrations (2026-11-19-gym-portal.sql up to 2026-11-29-gym-staff-logins.sql)
// have run, say so instead of a 500
const MIGRATION = "The gym portal needs its migrations (up to 2026-12-05-membership-pauses) on this server.";
// Saving a referral before its migration names that migration (enquiries are read without it)
const REFERRER_MIGRATION = "Referrals need the 2026-12-09-enquiry-referrer migration on this server.";
// Saving a plan's details (Gym Hub) before its migration names it (the catalogue is read without them)
const DETAILS_MIGRATION = "Plan details need the 2026-12-17-gym-public-profile migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_BAD_FIELD_ERROR" && String(error.sqlMessage ?? "").includes("referred_by_phone")) return res.status(503).json({ error: REFERRER_MIGRATION });
    if (error?.code === "ER_BAD_FIELD_ERROR" && String(error.sqlMessage ?? "").includes("'details'")) return res.status(503).json({ error: DETAILS_MIGRATION });
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

// Role & Permission (staffRules.areaOfPath, optionsOfRequest): a Staff login reaches only the
// options the gym admin ticked for them at this branch; the gym admin reaches everything, and
// routes without an area (the dashboard, branches) are open to every portal login. A route in an
// area that no option covers is refused (fail closed). The options come from the branch row read
// on this very request, so a change applies at once.
function requireArea(req, res, next) {
  const area = staffRules.areaOfPath(req.path);
  if (!area) return next();
  const options = staffRules.optionsOf(req.gym);
  const needed = staffRules.optionsOfRequest(req.method, req.path);
  if (needed && needed.some((id) => options.includes(id))) return next();
  logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
  const missing = !needed || !staffRules.areasOf(req.gym).includes(area) ? staffRules.AREA_LABEL[area] : staffRules.optionLabel(needed[0]);
  return res.status(403).json({ error: `Your login doesn't include ${missing}. Ask your gym admin.` });
}
router.use(requireArea);

// Activity log (gym/activity.js, 2026-11-09): every add, edit and delete that succeeds below is
// written down with who made it, for the gym admin's ☰ › Activity
router.use(activity.recorder(pool));

// Staff / Admin Login (gym/staff.js): only the branch's gym admin (kind 'owner', linked by the
// justFit Super Admin) sees and changes its team; Staff get a 403. Adding and removing have their
// own hourly allowance.
const ownerOnly = (message) => (req, res, next) => {
  if (req.gym.kind === "owner") return next();
  logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
  return res.status(403).json({ error: message });
};
const requireGymOwner = ownerOnly("Only the gym admin can manage the team.");
// 30 team changes an hour per account (GYM_STAFF_CHANGES_PER_HOUR; the test server raises it, as it
// does the OTP limits, because one suite adds and removes the same people many times)
const staffLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_STAFF_CHANGES_PER_HOUR) || 30, windowMs: 60 * 60 * 1000 }));

// ☰ › Activity: who added, edited or deleted what at this branch, one day at a time (gym admin only)
const ACTIVITY_MIGRATION = "Activity needs the 2026-12-14-gym-activity-log migration on this server.";
router.get("/activity", ownerOnly("Only the gym admin can see the activity log."), (req, res, next) => {
  activity.list(pool(req), req.gym, req.userId, activityRules.activityQuery(req.query, today())).then((answer) => res.json(answer), (error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: ACTIVITY_MIGRATION });
    next(error);
  });
});
router.get("/staff", requireGymOwner, route(async (req, res) => {
  res.json(await staff.team(pool(req), req.gym, req.userId));
}));
router.post("/staff", requireGymOwner, staffLimit, smallBody, route(async (req, res) => {
  const answer = await staff.add(pool(req), req.gym, req.userId, staffRules.addBody(req.body));
  res.status(answer.result === "added" ? 201 : 202).json(answer);
}));
// Role & Permission: which options a Staff login may use at this branch (its own hourly allowance:
// switching areas on and off doesn't spend the add / remove budget)
const permissionLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));
router.put("/staff/:userId/permissions", requireGymOwner, permissionLimit, smallBody, route(async (req, res) => {
  res.json(await staff.setPermissions(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId), staffRules.permissionsBody(req.body)));
}));
// Branches: which of the gym admin's branches someone on the team works at (the add / remove budget)
router.put("/staff/:userId/branches", requireGymOwner, staffLimit, smallBody, route(async (req, res) => {
  res.json(await staff.setBranches(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId), staffRules.branchesBody(req.body)));
}));
router.delete("/staff/invites/:inviteId", requireGymOwner, staffLimit, route(async (req, res) => {
  res.json(await staff.cancelInvite(pool(req), req.gym, req.userId, rules.id(req.params.inviteId, "invite")));
}));
router.delete("/staff/:userId", requireGymOwner, staffLimit, route(async (req, res) => {
  res.json(await staff.remove(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId)));
}));

router.get("/dashboard", route(async (req, res) => {
  const dashboard = await service.dashboard(pool(req), req.gym, today());
  const options = staffRules.optionsOf(req.gym);
  // Needs attention › Likely to leave: the members at high renewal risk (gym/predictions.js)
  if (options.includes("predictions.renewals")) dashboard.alerts.renewalRisk = await predictions.highRiskCount(pool(req), req.gym.id, today());
  // Role & Permission: only what this login may see (the gym admin has every option)
  res.json(staffRules.dashboardFor(dashboard, options));
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

// The branch's name and place: the gym admin's alone, like adding a branch (QA 2026-11-07: Staff
// could rename the branch before, and the audit line credited the gym admin)
router.patch("/details", ownerOnly("Only the gym admin can change the branch details."), smallBody, route(async (req, res) => {
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
  // The gym comes along (its name and branch for the member's messages), so the member's page
  // doesn't read the whole dashboard for it (2026-11-07)
  res.json({ ...(await service.member(pool(req), req.gym.id, rules.id(req.params.memberId), today())), gym: service.gymInfo(req.gym) });
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
// Pause Membership: members' requests (Home › Needs attention › Pause requests), approving and
// rejecting them, and a pause the staff record themselves (⋯ › Pause Membership, approved at
// once). Decisions and pauses: 30 an hour per account.
const pauseLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));
router.get("/pauses", route(async (req, res) => {
  res.json(await pauses.list(pool(req), req.gym.id, pauseRules.listQuery(req.query), today()));
}));
router.post("/pauses/:pauseId/approve", pauseLimit, smallBody, route(async (req, res) => {
  res.json(await pauses.decide(pool(req), req.gym, req.userId, pauseRules.pauseId(req.params.pauseId), true, pauseRules.decisionBody(req.body), today()));
}));
router.post("/pauses/:pauseId/reject", pauseLimit, smallBody, route(async (req, res) => {
  res.json(await pauses.decide(pool(req), req.gym, req.userId, pauseRules.pauseId(req.params.pauseId), false, pauseRules.decisionBody(req.body), today()));
}));
router.post("/members/:memberId/pause", pauseLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await pauses.staffPause(pool(req), req.gym, req.userId, rules.id(req.params.memberId), pauseRules.pauseBody(req.body, today(), { staff: true }), today()));
}));

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
  res.json(await service.payments(pool(req), req.gym.id, rules.paymentsQuery(req.query, today())));
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

// The bill attached to a payment (gym/paymentReceipts.js): Add Member's "Attach the payment bill"
// uploads a photo of the plan payment's receipt once the admission is saved. PUT { data: base64,
// mediaType } adds or replaces it (checked from its bytes: JPEG, PNG or WebP, at most 3 MB) and
// answers the payment, DELETE takes it off, GET reads it. Only this branch's payments; uploads
// share the photos' hourly allowance. Its area is members (gym/staffRules.js): the bill is attached
// from Add Member and seen on the member's page.
const RECEIPT_MIGRATION = "Payment bills need the 2026-12-06-payment-receipts migration on this server.";
const receiptRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: RECEIPT_MIGRATION });
    next(error);
  });
const receiptBody = express.json({ limit: Math.ceil(paymentReceipts.receiptLimits.maxBytes * (4 / 3)) + 1024 });

router.put("/payments/:paymentId/receipt", photoLimit, receiptBody, receiptRoute(async (req, res) => {
  const paymentId = rules.id(req.params.paymentId, "payment");
  const checked = paymentReceipts.checkReceipt(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  await paymentReceipts.setReceipt(pool(req), req.gym.id, paymentId, checked);
  res.json(await service.payment(pool(req), req.gym.id, paymentId));
}));
router.delete("/payments/:paymentId/receipt", receiptRoute(async (req, res) => {
  const paymentId = rules.id(req.params.paymentId, "payment");
  await paymentReceipts.removeReceipt(pool(req), req.gym.id, paymentId);
  res.json(await service.payment(pool(req), req.gym.id, paymentId));
}));
router.get("/payments/:paymentId/receipt", receiptRoute(async (req, res) => {
  paymentReceipts.send(res, await paymentReceipts.receiptFile(pool(req), req.gym.id, rules.id(req.params.paymentId, "payment")));
}));

// Invoices (gym/invoices.js, 2026-11-07): one payment's invoice for the Invoice screen (the
// member's ⋯ › Send Invoice opens their latest payment's; a payment's Invoice chip opens its own),
// and Branch details › Invoice details (address, phone, GSTIN; the gym admin only). Area members,
// like the bill. Before migration 2026-12-07 the routes say so instead of a 500.
const INVOICE_MIGRATION = "Invoices need the 2026-12-07-gym-invoices migration on this server.";
const invoiceRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: INVOICE_MIGRATION });
    next(error);
  });
router.get("/payments/:paymentId/invoice", invoiceRoute(async (req, res) => {
  res.json(await invoices.invoice(pool(req), req.gym, { paymentId: rules.id(req.params.paymentId, "payment") }, today()));
}));
router.get("/members/:memberId/invoice", invoiceRoute(async (req, res) => {
  res.json(await invoices.invoice(pool(req), req.gym, { memberId: rules.id(req.params.memberId) }, today()));
}));
router.get("/invoice-details", invoiceRoute(async (req, res) => {
  res.json(await invoices.invoiceDetails(pool(req), req.gym));
}));
router.patch("/invoice-details", ownerOnly("Only the gym admin can change the invoice details."), smallBody, invoiceRoute(async (req, res) => {
  res.json(await invoices.updateInvoiceDetails(pool(req), req.gym, req.userId, invoiceRules.invoiceDetailsBody(req.body)));
}));

// The gym's logo (gym/logos.js, 2026-11-08): printed at the top right of every invoice. PUT
// { data: base64, mediaType } adds or replaces it (checked from its bytes: JPEG, PNG or WebP, at
// most 2 MB; the gym admin only, the photos' hourly allowance) and answers the Invoice details,
// DELETE takes it off, GET reads it (every portal login, for the Invoice details preview). It is
// the gym's, not the branch's, so every branch prints the same logo. No area, like Invoice details.
const LOGO_MIGRATION = "Gym logos need the 2026-12-08-gym-logos migration on this server.";
const logoRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: LOGO_MIGRATION });
    next(error);
  });
const logoBody = express.json({ limit: Math.ceil(logos.logoLimits.maxBytes * (4 / 3)) + 1024 });
router.put("/logo", ownerOnly("Only the gym admin can change the logo."), photoLimit, logoBody, logoRoute(async (req, res) => {
  const checked = logos.checkLogo(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  await logos.setLogo(pool(req), req.gym, req.userId, checked);
  res.json(await invoices.invoiceDetails(pool(req), req.gym));
}));
router.delete("/logo", ownerOnly("Only the gym admin can change the logo."), logoRoute(async (req, res) => {
  await logos.removeLogo(pool(req), req.gym, req.userId);
  res.json(await invoices.invoiceDetails(pool(req), req.gym));
}));
router.get("/logo", logoRoute(async (req, res) => {
  logos.send(res, await logos.logoFile(pool(req), req.gym.brand_id));
}));

// The branch's public profile (gym/gymProfile.js, Gym Hub phase 2, 2026-11-09): the description,
// facilities, opening hours and photos members will see when they discover gyms. Every portal login
// reads it (no area, like Invoice details); only the gym admin changes it. Photos: POST
// { data: base64, mediaType } adds one (checked from its bytes: JPEG, PNG or WebP, at most 3 MB; up
// to 8; the photos' hourly allowance), DELETE removes one, GET reads one. Before migration
// 2026-12-17 the routes say so.
const PROFILE_MIGRATION = "The public profile needs the 2026-12-17-gym-public-profile migration on this server.";
const profileRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: PROFILE_MIGRATION });
    next(error);
  });
const profileOwner = ownerOnly("Only the gym admin can change the public profile.");
const galleryBody = express.json({ limit: Math.ceil(gymProfile.photoLimits.maxBytes * (4 / 3)) + 1024 });
router.get("/profile", profileRoute(async (req, res) => {
  res.json(await gymProfile.profile(pool(req), req.gym));
}));
router.patch("/profile", profileOwner, smallBody, profileRoute(async (req, res) => {
  res.json(await gymProfile.updateProfile(pool(req), req.gym, req.userId, profileRules.profileBody(req.body)));
}));
router.post("/profile/photos", profileOwner, photoLimit, galleryBody, profileRoute(async (req, res) => {
  const checked = gymProfile.checkGymPhoto(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.status(201).json(await gymProfile.addPhoto(pool(req), req.gym, req.userId, checked));
}));
router.delete("/profile/photos/:photoId", profileOwner, profileRoute(async (req, res) => {
  res.json(await gymProfile.removePhoto(pool(req), req.gym, req.userId, rules.id(req.params.photoId, "photo")));
}));
router.get("/profile/photos/:photoId", profileRoute(async (req, res) => {
  gymProfile.send(res, await gymProfile.photoFile(pool(req), req.gym.id, rules.id(req.params.photoId, "photo")));
}));

// Reminder Templates (gym/templates.js, 2026-11-08): the branch's own wording for Send Reminder
// and the enquiry WhatsApp button. Every portal login reads them (no area: the reminders are sent
// from Members, Due Members, Likely to leave and Enquiries; the templates option only decides who
// sees the Reminder Templates screen); only the gym admin rewords or resets
// one, with its own hourly allowance. Before migration 2026-12-11 the routes say so.
const TEMPLATE_MIGRATION = "Reminder Templates need the 2026-12-11-reminder-templates migration on this server.";
const templateRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: TEMPLATE_MIGRATION });
    next(error);
  });
// 30 template changes an hour per account (GYM_TEMPLATE_CHANGES_PER_HOUR; the test server raises it)
const templateLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_TEMPLATE_CHANGES_PER_HOUR) || 30, windowMs: 60 * 60 * 1000 }));
const templateOwner = ownerOnly("Only the gym admin can change the reminder templates.");
router.get("/templates", templateRoute(async (req, res) => {
  res.json(await templates.list(pool(req), req.gym));
}));
router.put("/templates/:kind", templateOwner, templateLimit, smallBody, templateRoute(async (req, res) => {
  const kind = templateRules.kindParam(req.params.kind);
  res.json(await templates.save(pool(req), req.gym, req.userId, kind, templateRules.templateBody(kind, req.body).text));
}));
router.delete("/templates/:kind", templateOwner, templateLimit, templateRoute(async (req, res) => {
  res.json(await templates.reset(pool(req), req.gym, req.userId, templateRules.kindParam(req.params.kind)));
}));

// Send Bulk SMS (gym/sms.js): credits, Auto Reminders, Manual Send, a member's reminder, Message
// Logs. Sending costs the branch's credits, so sends have their own small budget per account.
const SMS_MIGRATION = "SMS needs the 2026-11-25-gym-sms migration on this server.";
// The gym admin's own named templates (2026-11-08), on the same allowance. Before migration
// 2026-12-13 the list reads as empty and these answer 503 naming it.
const ADDED_MIGRATION = "Adding templates needs the 2026-12-13-added-templates migration on this server.";
const addedRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: ADDED_MIGRATION });
    next(error);
  });
router.post("/templates/added", templateOwner, templateLimit, smallBody, addedRoute(async (req, res) => {
  res.status(201).json(await templates.addTemplate(pool(req), req.gym, req.userId, templateRules.addedBody(req.body)));
}));
router.put("/templates/added/:id", templateOwner, templateLimit, smallBody, addedRoute(async (req, res) => {
  const id = rules.id(req.params.id, "template");
  res.json(await templates.editTemplate(pool(req), req.gym, req.userId, id, templateRules.addedBody(req.body)));
}));
router.delete("/templates/added/:id", templateOwner, templateLimit, addedRoute(async (req, res) => {
  res.json(await templates.deleteTemplate(pool(req), req.gym, req.userId, rules.id(req.params.id, "template")));
}));
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
// The report of what is filtered: CSV by default, an Excel file with ?format=xlsx (2026-11-09)
router.get("/attendance/export", route(async (req, res) => {
  const { format, query } = attendanceRules.exportQuery(req.query, today());
  const report = await attendance.exportReport(pool(req), req.gym.id, query, format);
  const name = `attendance-${query.from}-to-${query.to}.${format}`;
  res.set("Content-Disposition", `attachment; filename="${name}"`);
  if (format === "xlsx") {
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(report);
  }
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.send(`\uFEFF${report}`);
}));

// Attendance › Staff & Trainers (gym/staffAttendance.js, 2026-11-09): the branch's Staff and
// Trainers, who is in today and their visits; the gym admin alone sees it and checks them in or
// out by hand (they scan the branch's QR code themselves through /api/attendance). No area: it is
// the gym admin's, like the team.
const STAFF_ATTENDANCE_MIGRATION = "Staff & Trainers attendance needs the 2026-12-15-staff-attendance migration on this server.";
const staffAttendanceRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: STAFF_ATTENDANCE_MIGRATION });
    next(error);
  });
const teamAttendanceOwner = ownerOnly("Only the gym admin can see Staff & Trainers attendance.");
router.get("/team-attendance", teamAttendanceOwner, staffAttendanceRoute(async (req, res) => {
  res.json(await staffAttendance.board(pool(req), req.gym, attendanceRules.teamQuery(req.query, today()), today()));
}));
router.post("/team-attendance/:userId/check-in", teamAttendanceOwner, staffAttendanceRoute(async (req, res) => {
  const { alreadyIn } = await staffAttendance.adminCheckIn(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId), today());
  res.status(alreadyIn ? 200 : 201).json({ ok: true, alreadyIn });
}));
router.post("/team-attendance/:userId/check-out", teamAttendanceOwner, staffAttendanceRoute(async (req, res) => {
  res.json({ ok: true, ...(await staffAttendance.adminCheckOut(pool(req), req.gym, req.userId, staffRules.userIdParam(req.params.userId), today())) });
}));

// Wallet: the takings, and (for a login with Expenses › Expense list) what was spent and the net
// (collected − spent). Before the expenses migration `expenses` is left out and Wallet is as it was.
router.get("/wallet", route(async (req, res) => {
  const wallet = await service.wallet(pool(req), req.gym.id, today());
  const spent = staffRules.optionsOf(req.gym).includes("expenses.view") ? await expenses.spent(pool(req), req.gym.id, today()) : null;
  if (spent) {
    wallet.expenses = spent;
    wallet.net = { today: wallet.today.total - spent.today, month: wallet.month.total - spent.month };
  }
  res.json(wallet);
}));

// Expenses (gym/expenses.js, 2026-11-08): Manage › Expense. Area expenses (staffRules.areaOfPath):
// the gym admin, and Staff given Expenses. Adding and editing share an hourly allowance; deleting
// is the gym admin's alone and audited, with the bill's file. Before migration 2026-12-10 the
// routes say so instead of a 500.
const EXPENSE_MIGRATION = "Expenses need the 2026-12-10-gym-expenses migration on this server.";
const expenseRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: EXPENSE_MIGRATION });
    next(error);
  });
const expenseLimit = limitPerUser(createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }));
const expenseId = (req) => rules.id(req.params.expenseId, "expense");

router.get("/expenses", expenseRoute(async (req, res) => {
  // canDelete: whether this login may delete (the gym admin); the app shows Delete only then
  res.json({ ...(await expenses.list(pool(req), req.gym.id, expenseRules.expensesQuery(req.query, today()))), canDelete: req.gym.kind === "owner" });
}));
router.post("/expenses", expenseLimit, smallBody, expenseRoute(async (req, res) => {
  res.status(201).json(await expenses.add(pool(req), req.gym.id, req.userId, expenseRules.expenseBody(req.body, today())));
}));
router.put("/expenses/:expenseId", expenseLimit, smallBody, expenseRoute(async (req, res) => {
  res.json(await expenses.edit(pool(req), req.gym, req.userId, expenseId(req), expenseRules.expenseBody(req.body, today())));
}));
router.delete("/expenses/:expenseId", ownerOnly("Only the gym admin can delete an expense."), expenseLimit, expenseRoute(async (req, res) => {
  const bill = await expenses.remove(pool(req), req.gym, req.userId, expenseId(req));
  if (bill) await expenseBills.discard(bill);
  res.json({ ok: true });
}));

// An expense's bill photo (gym/expenseBills.js): PUT { data: base64, mediaType } adds or replaces
// it (checked from its bytes: JPEG, PNG or WebP, at most 3 MB) and answers the expense, DELETE
// takes it off, GET reads it. Only this branch's expenses; uploads share the photos' allowance.
const billBody = express.json({ limit: Math.ceil(expenseBills.billLimits.maxBytes * (4 / 3)) + 1024 });
router.put("/expenses/:expenseId/bill", photoLimit, billBody, expenseRoute(async (req, res) => {
  const id = expenseId(req);
  const checked = expenseBills.checkBill(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  await expenseBills.setBill(pool(req), req.gym.id, id, checked);
  res.json(await expenses.one(pool(req), req.gym.id, id));
}));
router.delete("/expenses/:expenseId/bill", expenseRoute(async (req, res) => {
  const id = expenseId(req);
  await expenseBills.removeBill(pool(req), req.gym.id, id);
  res.json(await expenses.one(pool(req), req.gym.id, id));
}));
router.get("/expenses/:expenseId/bill", expenseRoute(async (req, res) => {
  expenseBills.send(res, await expenseBills.billFile(pool(req), req.gym.id, expenseId(req)));
}));

module.exports = { gymRouter: router };
