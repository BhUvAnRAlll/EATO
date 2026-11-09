// Delivery partners and deliveries (Meal Operations phase 4, 2026-11-10), mounted inside
// /api/admin/kitchen (adminOnly: the role is read from the database on every request):
//   GET  /delivery/board                      today's partners, loads and counts
//   GET|POST /delivery/partners?search=       GET|PUT /delivery/partners/:id
//   POST /delivery/partners/:id/availability  { available }
//   POST /orders/:id/delivery/assign          { partnerId? } (left out: the best free partner)
//   POST /orders/:id/delivery/advance         { from }
//   POST /orders/:id/delivery/fail            { reason, note? }
// Before migration 2027-01-06 these answer 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const { inTransaction } = require("../gym/service");
const { ValidationError } = require("../profile");
const kitchenRules = require("../kitchens/rules");
const mealRules = require("../meals/rules");
const meals = require("../meals/service");
const deliveries = require("./service");
const rules = require("./rules");

const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "16kb" });
// 300 delivery changes an hour per admin (DELIVERY_CHANGES_PER_HOUR; a busy evening has many steps)
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.DELIVERY_CHANGES_PER_HOUR) || 300, windowMs: 60 * 60 * 1000 }));

const MIGRATION = "Deliveries need the 2027-01-06-delivery migration on this server.";
const route = (handler) => async (req, res, next) => {
  try {
    if (!(await deliveries.ready(pool(req)))) return res.status(503).json({ error: MIGRATION });
    await handler(req, res, next);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  }
};

const router = express.Router({ caseSensitive: true, strict: true });
const partnerId = (req) => kitchenRules.positiveId(req.params.id, "delivery partner");

router.get("/delivery/board", route(async (req, res) => {
  const now = kitchenRules.indiaNow();
  res.json(await deliveries.board(pool(req), kitchenRules.dayBounds(now.date).start, now.date));
}));
router.get("/delivery/partners", route(async (req, res) => {
  kitchenRules.onlyFields(req.query, ["search"]);
  if (req.query.search !== undefined && typeof req.query.search !== "string") throw new ValidationError("Search with text.");
  res.json({ partners: await deliveries.partners(pool(req), { search: (req.query.search ?? "").trim().slice(0, 40), dayStart: kitchenRules.dayBounds(kitchenRules.indiaNow().date).start }) });
}));
router.post("/delivery/partners", changeLimit, smallBody, route(async (req, res) => {
  const saved = await deliveries.savePartner(pool(req), inTransaction, null, rules.partnerBody(req.body));
  await recordAdminAction(pool(req), req, "delivery.partner_add", "order", null, `Added delivery partner “${saved.partner.name}”`);
  res.status(201).json(saved);
}));
router.get("/delivery/partners/:id", route(async (req, res) => {
  res.json(await deliveries.partner(pool(req), partnerId(req)));
}));
router.put("/delivery/partners/:id", changeLimit, smallBody, route(async (req, res) => {
  const saved = await deliveries.savePartner(pool(req), inTransaction, partnerId(req), rules.partnerBody(req.body));
  await recordAdminAction(pool(req), req, "delivery.partner_edit", "order", null, `Edited delivery partner “${saved.partner.name}”`);
  res.json(saved);
}));
router.post("/delivery/partners/:id/availability", changeLimit, smallBody, route(async (req, res) => {
  kitchenRules.onlyFields(req.body, ["available"]);
  if (typeof req.body.available !== "boolean") throw new ValidationError("Say whether they are available.");
  res.json(await deliveries.setAvailable(pool(req), partnerId(req), req.body.available));
}));

router.post("/orders/:id/delivery/assign", changeLimit, smallBody, route(async (req, res) => {
  const id = mealRules.orderId(req.params.id);
  const { partnerId: chosen } = rules.assignBody(req.body);
  const done = await inTransaction(pool(req), (db) => deliveries.assign(db, id, chosen, req.userId));
  const order = await meals.adminOrder(pool(req), id);
  await recordAdminAction(pool(req), req, "order.delivery_assign", "order", id, `Order ${order.code}: given to ${done.partner.name}`.slice(0, 200));
  res.json({ order });
}));
router.post("/orders/:id/delivery/advance", changeLimit, smallBody, route(async (req, res) => {
  const id = mealRules.orderId(req.params.id);
  const step = rules.advanceBody(req.body);
  const done = await inTransaction(pool(req), (db) => deliveries.advance(db, id, step, req.userId));
  const order = await meals.adminOrder(pool(req), id);
  // Delivered: into the member's Macro diary once, as when the admin marks it delivered
  const macroLogged = done.delivered ? await meals.logDelivered(pool(req), order, done.userId, req) : null;
  res.json({ order, macroLogged });
}));
router.post("/orders/:id/delivery/fail", changeLimit, smallBody, route(async (req, res) => {
  const id = mealRules.orderId(req.params.id);
  const body = rules.failBody(req.body);
  await inTransaction(pool(req), (db) => deliveries.fail(db, id, body, req.userId));
  const order = await meals.adminOrder(pool(req), id);
  await recordAdminAction(pool(req), req, "order.delivery_failed", "order", id, `Order ${order.code}: delivery failed (${body.reason.replace(/_/g, " ")})`);
  res.json({ order });
}));

module.exports = { deliveryRouter: router };
