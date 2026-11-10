// Meal subscriptions (Meal Operations phase 5, 2026-11-10; per meal since 2027-01-10, the user's design).
// Members, /api/subscriptions (requireUser in index.js): GET /lengths, GET /mine (running and past),
//   POST / { clientId, mealId, lengthId, quantity, slot, startsOn, addressId } (waits for payment, with
//   the checkout), POST /:id/verify-payment, POST /:id/payment-failed, POST /:id/pause { from, until },
//   POST /:id/resume, POST /:id/skip { day }, POST /:id/unskip { day }, POST /:id/cancel { reason? }.
// Admin, inside /api/admin/kitchen (adminOnly): GET|PUT /subscription-lengths,
//   GET /subscriptions?status=&search=, GET /subscriptions/:id, POST /subscriptions/:id/activate|pause|
//   resume|cancel|extend, POST /subscriptions/generate { day }. The whole meal plans are gone for new
//   subscriptions (the user's choice); running plan subscriptions keep their orders until they end.
// Who is asking always comes from the session. Before migration 2027-01-08 these answer 503 naming it;
// the lengths and subscribing need 2027-01-10 too.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const { ValidationError } = require("../profile");
const paymentRules = require("../payments/rules");
const mealRules = require("../meals/rules");
const meals = require("../meals/service");
const subscriptions = require("./service");
const rules = require("./rules");

const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "16kb" });
const today = () => mealRules.indiaNow().date;
const MIGRATION = "Meal subscriptions need the 2027-01-08-meal-subscriptions migration on this server.";
const route = (handler) => async (req, res, next) => {
  try {
    if (!(await subscriptions.ready(pool(req)))) return res.status(503).json({ error: MIGRATION });
    await handler(req, res, next);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  }
};
const subscriptionId = (value) => mealRules.orderId(value); // a UUID, like an order's id
const MEAL_MIGRATION = "Meal subscriptions need the 2027-01-10-meal-item-subscriptions migration on this server.";
const mealRoute = (handler) => route(async (req, res, next) => {
  if (!(await subscriptions.mealReady(pool(req)))) return res.status(503).json({ error: MEAL_MIGRATION });
  await handler(req, res, next);
});

// ---- Members ----

const memberRouter = express.Router({ caseSensitive: true, strict: true });
// 30 subscribing, pausing, skipping and cancelling an hour per account (SUBSCRIPTION_CHANGES_PER_HOUR)
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.SUBSCRIPTION_CHANGES_PER_HOUR) || 30, windowMs: 60 * 60 * 1000 }));
const payLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.MEAL_PAYMENTS_PER_HOUR) || 60, windowMs: 60 * 60 * 1000 }));

memberRouter.get("/lengths", mealRoute(async (req, res) => {
  rules.onlyFields(req.query, []);
  res.json(await subscriptions.lengths(pool(req)));
}));
memberRouter.get("/mine", route(async (req, res) => {
  res.json(await subscriptions.mine(pool(req), req.userId, today()));
}));
memberRouter.post("/", changeLimit, smallBody, mealRoute(async (req, res) => {
  const made = await subscriptions.subscribeMeal(pool(req), req.userId, rules.subscribeMealBody(req.body, today()), today(), meals.loadSlots);
  res.status(made.repeated ? 200 : 201).json(made);
}));
memberRouter.post("/:id/verify-payment", payLimit, smallBody, route(async (req, res) => {
  res.json(await subscriptions.confirm(pool(req), req.userId, subscriptionId(req.params.id), paymentRules.verifyBody(req.body), today()));
}));
memberRouter.post("/:id/payment-failed", payLimit, smallBody, route(async (req, res) => {
  const body = paymentRules.failureBody(req.body);
  res.json(await require("../payments/service").failSubscription(pool(req), req.userId, subscriptionId(req.params.id), body));
}));
const mineAfter = async (req, res) => res.json(await subscriptions.mine(pool(req), req.userId, today()));
memberRouter.post("/:id/pause", changeLimit, smallBody, route(async (req, res) => {
  await subscriptions.pause(pool(req), subscriptionId(req.params.id), req.body, today(), { userId: req.userId });
  await mineAfter(req, res);
}));
memberRouter.post("/:id/resume", changeLimit, smallBody, route(async (req, res) => {
  rules.onlyFields(req.body ?? {}, []);
  await subscriptions.resume(pool(req), subscriptionId(req.params.id), today(), { userId: req.userId });
  await mineAfter(req, res);
}));
for (const [path, undo] of [["skip", false], ["unskip", true]]) {
  memberRouter.post(`/:id/${path}`, changeLimit, smallBody, route(async (req, res) => {
    await subscriptions.skip(pool(req), req.userId, subscriptionId(req.params.id), req.body, today(), undo);
    await mineAfter(req, res);
  }));
}
memberRouter.post("/:id/cancel", changeLimit, smallBody, route(async (req, res) => {
  const { reason } = mealRules.cancelBody(req.body ?? {}, { required: false });
  await subscriptions.cancel(pool(req), subscriptionId(req.params.id), reason, { userId: req.userId });
  await mineAfter(req, res);
}));

// ---- The Super Admin ----

const adminRouter = express.Router({ caseSensitive: true, strict: true });
const adminLimit = limitPerUser(createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 }));

adminRouter.get("/subscription-lengths", mealRoute(async (req, res) => {
  res.json(await subscriptions.lengths(pool(req), { all: true }));
}));
adminRouter.put("/subscription-lengths", adminLimit, smallBody, mealRoute(async (req, res) => {
  const { lengths } = rules.lengthsBody(req.body);
  const saved = await subscriptions.saveLengths(pool(req), lengths);
  await recordAdminAction(pool(req), req, "meal.subscription_prices", "meal", null, `Subscription prices: ${lengths.map((l) => `${l.label} ${l.percentOff}% off${l.active ? "" : " (off)"}`).join(", ")}`);
  res.json(saved);
}));
adminRouter.get("/subscriptions", route(async (req, res) => {
  rules.onlyFields(req.query, ["status", "search"]);
  const status = req.query.status ?? null;
  if (status !== null && !["active", "paused", "expiring", "cancelled", "completed"].includes(status)) throw new ValidationError("Pick a status from the list.");
  if (req.query.search !== undefined && typeof req.query.search !== "string") throw new ValidationError("Search with text.");
  res.json(await subscriptions.adminList(pool(req), { status, search: (req.query.search ?? "").trim().slice(0, 40) }, today()));
}));
adminRouter.post("/subscriptions/generate", adminLimit, smallBody, route(async (req, res) => {
  rules.onlyFields(req.body, ["day"]);
  const d = rules.day(req.body.day, "day");
  if (d < today() || d > rules.addDays(today(), 6)) throw new ValidationError("Make orders for today to 6 days ahead.");
  const done = await subscriptions.generate(pool(req), d, meals.loadSlots);
  await recordAdminAction(pool(req), req, "meal.subscription_orders", "meal", null, `Made ${done.made} subscription orders for ${d}`);
  res.json(done);
}));
adminRouter.get("/subscriptions/:id", route(async (req, res) => {
  res.json(await subscriptions.adminOne(pool(req), subscriptionId(req.params.id), today()));
}));
const ACTIONS = {
  activate: async (req, id) => subscriptions.activate(pool(req), id),
  pause: async (req, id) => subscriptions.pause(pool(req), id, req.body, today()),
  resume: async (req, id) => { rules.onlyFields(req.body ?? {}, []); return subscriptions.resume(pool(req), id, today()); },
  cancel: async (req, id) => subscriptions.cancel(pool(req), id, mealRules.cancelBody(req.body ?? {}, { required: true }).reason),
  extend: async (req, id) => {
    rules.onlyFields(req.body, ["days"]);
    if (!Number.isInteger(req.body.days) || req.body.days < 1 || req.body.days > 90) throw new ValidationError("Extend by 1 to 90 days.");
    return subscriptions.extend(pool(req), id, req.body.days);
  },
};
for (const [action, run] of Object.entries(ACTIONS)) {
  adminRouter.post(`/subscriptions/:id/${action}`, adminLimit, smallBody, route(async (req, res) => {
    const id = subscriptionId(req.params.id);
    await run(req, id);
    const answer = await subscriptions.adminOne(pool(req), id, today());
    await recordAdminAction(pool(req), req, `meal.subscription_${action}`, "meal", null, `Subscription ${answer.subscription.code}: ${action}`);
    res.json(answer);
  }));
}

/**
 * Makes tomorrow's subscription orders every hour (India's day), so kitchens see them in good time;
 * idempotent, never in tests. Before the migration it does nothing.
 */
function startSubscriptionOrders(appPool, logError) {
  if (process.env.NODE_ENV === "test") return null;
  const tick = async () => {
    try {
      if (await subscriptions.ready(appPool)) await subscriptions.generate(appPool, rules.addDays(today(), 1), meals.loadSlots);
    } catch (error) {
      logError(error);
    }
  };
  setTimeout(tick, 30_000).unref();
  return setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { subscriptionsRouter: memberRouter, subscriptionsAdminRouter: adminRouter, startSubscriptionOrders };
