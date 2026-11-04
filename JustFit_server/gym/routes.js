// HTTP routes for the gym admin portal (one branch at a time: the one the account last opened), mounted at /api/gym in index.js behind requireUser and
// the per-user rate limit. requireGymStaff reads the caller's role (users.role, every request) and
// their gym (gym_staff) from the database; every handler works on that gym only (req.gym), never
// on a gym or account named in the request. Bodies are small JSON, parsed per route.
const express = require("express");

const { getAccount } = require("../auth");
const { logSecurityEvent } = require("../logging");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const service = require("./service");
const rules = require("./rules");
const sms = require("./sms");
const smsRules = require("./smsRules");

const router = express.Router();
const smallBody = express.json({ limit: "4kb" });
const pool = (req) => req.app.locals.pool;
const today = () => rules.todayInIndia();

// Before migrations/2026-11-19-gym-portal.sql has run, say so instead of a 500
const MIGRATION = "The gym portal needs the 2026-11-19-gym-portal migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

// 403 unless the caller is a gym admin linked to a gym
async function requireGymStaff(req, res, next) {
  let account;
  try {
    account = await getAccount(req.userId, pool(req));
  } catch {
    return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
  }
  if (account.role !== "gym_admin") {
    logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
    return res.status(403).json({ error: "Only gym admins can do that." });
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

router.get("/dashboard", route(async (req, res) => {
  res.json(await service.dashboard(pool(req), req.gym, today()));
}));

// The account's branches, and switching to another one
router.get("/branches", route(async (req, res) => {
  res.json(await service.branches(pool(req), req.gym, req.userId));
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
router.post("/members/:memberId/check-in", route(async (req, res) => {
  res.json(await service.checkIn(pool(req), req.gym.id, req.userId, rules.id(req.params.memberId), today()));
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
  res.json(await service.enquiries(pool(req), req.gym.id));
}));
router.post("/enquiries", smallBody, route(async (req, res) => {
  res.status(201).json(await service.addEnquiry(pool(req), req.gym.id, req.userId, rules.enquiryBody(req.body), today()));
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
  res.json(await service.deleteItem(pool(req), req.gym.id, rules.id(req.params.itemId, "item")));
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

router.get("/wallet", route(async (req, res) => {
  res.json(await service.wallet(pool(req), req.gym.id, today()));
}));

module.exports = { gymRouter: router };
