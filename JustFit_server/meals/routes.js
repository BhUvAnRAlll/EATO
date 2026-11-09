// Meal ordering's routes (2026-11-09), mounted in index.js:
//   /api/meals          members: the menu, one meal, favourites, a meal's photo (requireUser)
//   /api/orders         members: the cart's options, place an order and pay it the Razorpay way
//                       (payments/: the checkout's answer is verified by its signature), my orders,
//                       cancel; while PAYMENT_PROVIDER is the dummy, its gateway at /gateway/dummy/checkout
//   /api/admin/kitchen  the Super Admin: add and delete meals, the delivery times, the day's orders
//                       and their steps (adminOnly: the role is read on every request)
// Who is asking always comes from the session. Before migration 2026-12-23 the routes that need it
// answer 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const meals = require("./service");
const catalog = require("./catalog");
const catalogRules = require("./catalogRules");
const { inTransaction } = require("../gym/service");
const photos = require("./photos");
const rules = require("./rules");
const payments = require("../payments/service");
const paymentRules = require("../payments/rules");
const kitchenOrders = require("../kitchens/assign");
const assignRules = require("../kitchens/assignRules");
const { inTransaction: inTx } = require("../gym/service");

// A wrong PAYMENT_PROVIDER or missing Razorpay keys stop the server at startup, not at the first Pay
paymentRules.providerSettings();

const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "8kb" });
// A meal, category or banner with its photo: at most 2 MB of photo as base64 (4/3 of its bytes) plus the fields
const mealBody = express.json({ limit: Math.ceil(photos.mealPhotoLimits.maxBytes * (4 / 3)) + 16 * 1024 });

const MIGRATION = "Meal ordering needs the 2026-12-23-meal-ordering migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

// ---- Members: the menu ----

const mealsRouter = express.Router({ caseSensitive: true, strict: true });
// 60 favourite taps an hour per account
const favoriteLimit = limitPerUser(createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }));

mealsRouter.get("/", route(async (req, res) => {
  res.json(await meals.menu(pool(req), req.userId, rules.menuQuery(req.query)));
}));
// Everything the Meals tab shows in one read (meals, categories, today's banners and coupons)
mealsRouter.get("/storefront", route(async (req, res) => {
  res.json(await catalog.storefront(pool(req), req.userId, { mealToApi: meals.mealToApi }));
}));
for (const kind of ["categories", "banners"]) {
  mealsRouter.get(`/${kind}/:id/photo`, route(async (req, res) => {
    const file = await photos.read(await catalog.photoKey(pool(req), kind, catalogRules.id(req.params.id, kind === "categories" ? "category" : "banner")));
    if (!file) return res.status(404).json({ error: "No photo." });
    photos.send(res, file);
  }));
}
mealsRouter.get("/:id", route(async (req, res) => {
  res.json(await meals.meal(pool(req), req.userId, rules.mealId(req.params.id)));
}));
mealsRouter.get("/:id/photo", route(async (req, res) => {
  const file = await photos.read(await meals.photoKey(pool(req), rules.mealId(req.params.id)));
  if (!file) return res.status(404).json({ error: "That meal has no photo." });
  photos.send(res, file);
}));
mealsRouter.put("/:id/favorite", favoriteLimit, route(async (req, res) => {
  res.json(await meals.setFavorite(pool(req), req.userId, rules.mealId(req.params.id), true));
}));
mealsRouter.delete("/:id/favorite", favoriteLimit, route(async (req, res) => {
  res.json(await meals.setFavorite(pool(req), req.userId, rules.mealId(req.params.id), false));
}));

// ---- Members: orders ----

const ordersRouter = express.Router({ caseSensitive: true, strict: true });
// 20 orders and 20 cancels an hour per account (MEAL_ORDERS_PER_HOUR; the test server raises it)
const orderLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.MEAL_ORDERS_PER_HOUR) || 20, windowMs: 60 * 60 * 1000 }));

ordersRouter.get("/options", route(async (req, res) => {
  res.json(await meals.orderOptions(pool(req)));
}));
// The cart's price before Pay, with a coupon when one is typed (nothing is written)
ordersRouter.post("/quote", smallBody, route(async (req, res) => {
  res.json(await meals.quote(pool(req), req.userId, rules.quoteBody(req.body)));
}));
ordersRouter.get("/", route(async (req, res) => {
  res.json(await meals.myOrders(pool(req), req.userId));
}));
ordersRouter.post("/", orderLimit, smallBody, route(async (req, res) => {
  const placed = await meals.placeOrder(pool(req), req.userId, rules.orderBody(req.body));
  res.status(placed.repeated ? 200 : 201).json(placed);
}));
// Payments: 60 checks, failures and dummy checkouts an hour per account
const payLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.MEAL_PAYMENTS_PER_HOUR) || 60, windowMs: 60 * 60 * 1000 }));
// The dummy gateway: what Razorpay's servers would answer when the member pays (no money moves)
ordersRouter.post("/gateway/dummy/checkout", payLimit, smallBody, route(async (req, res) => {
  res.json(await payments.dummyCheckout(pool(req), req.userId, paymentRules.dummyCheckoutBody(req.body)));
}));
// What the checkout returned: the signature is checked before the order is placed
ordersRouter.post("/:id/verify-payment", payLimit, smallBody, route(async (req, res) => {
  res.json(await meals.confirmPayment(pool(req), req.userId, rules.orderId(req.params.id), paymentRules.verifyBody(req.body)));
}));
// A checkout that failed or was closed (the order keeps waiting; Pay tries again)
ordersRouter.post("/:id/payment-failed", payLimit, smallBody, route(async (req, res) => {
  res.json(await payments.fail(pool(req), req.userId, rules.orderId(req.params.id), paymentRules.failureBody(req.body)));
}));
ordersRouter.get("/:id", route(async (req, res) => {
  res.json(await meals.myOrder(pool(req), req.userId, rules.orderId(req.params.id)));
}));
ordersRouter.post("/:id/cancel", orderLimit, smallBody, route(async (req, res) => {
  const { reason } = rules.cancelBody(req.body, { required: false });
  res.json(await meals.cancelMine(pool(req), req.userId, rules.orderId(req.params.id), reason));
}));

// ---- The Super Admin: meals, delivery times, orders ----

const kitchenRouter = express.Router({ caseSensitive: true, strict: true });
// Kitchens and the meal-operations dashboard (Meal Operations phase 1, kitchens/routes.js)
kitchenRouter.use(require("../kitchens/routes").kitchensRouter);
// Delivery partners and deliveries (Meal Operations phase 4, delivery/routes.js)
kitchenRouter.use(require("../delivery/routes").deliveryRouter);
const photoLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));

kitchenRouter.get("/meals", route(async (req, res) => {
  res.json(await meals.adminMeals(pool(req)));
}));
/**
 * Splits `photo` (and `removePhoto`) off a body, checks the rest with `check`, then checks and saves
 * the photo. → { values, imageKey } where imageKey is undefined (keep), null (remove) or the new
 * file's name; or null after answering a refused photo. The caller deletes a new file if its write fails.
 */
async function withPhoto(req, res, check, limits) {
  const { photo, removePhoto, ...fields } = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const values = check(fields);
  if (removePhoto !== undefined && removePhoto !== true) return res.status(400).json({ error: "Unexpected field: removePhoto." }) && null;
  if (photo === undefined || photo === null) return { values, imageKey: removePhoto ? null : undefined };
  const checked = photos.checkPhotoWith(photo, limits);
  if (!checked.ok) {
    res.status(checked.status).json({ error: checked.error });
    return null;
  }
  return { values, imageKey: await photos.save(checked.bytes, checked.mediaType) };
}
/** Runs a write that uses a just-saved photo; a failed write deletes the file again */
async function keepingPhoto(imageKey, write) {
  try {
    return await write();
  } catch (error) {
    if (imageKey) await photos.remove(imageKey).catch(() => {});
    throw error;
  }
}
const dropOld = (key) => (key ? photos.remove(key).catch(() => {}) : Promise.resolve());

// { name, description?, diet, calories, proteinG, carbsG, fatG, price, mrp?, tags?, servingSize?,
// ingredients?, available?, photo?: { data, mediaType } }. The photo is checked from its bytes and
// saved first; a refused meal leaves no file behind.
kitchenRouter.post("/meals", photoLimit, mealBody, route(async (req, res) => {
  const got = await withPhoto(req, res, rules.mealBody, photos.mealPhotoLimits);
  if (!got) return;
  const added = await keepingPhoto(got.imageKey, () => meals.addMeal(pool(req), got.values, got.imageKey ?? null));
  await recordAdminAction(pool(req), req, "meal.create", "meal", added.meal.id, `Added meal “${got.values.name}”`);
  res.status(201).json(added);
}));
// Every field again; photo replaces the photo, removePhoto: true takes it away
kitchenRouter.put("/meals/:id", photoLimit, mealBody, route(async (req, res) => {
  const id = rules.mealId(req.params.id);
  const got = await withPhoto(req, res, rules.mealBody, photos.mealPhotoLimits);
  if (!got) return;
  const { oldImageKey, ...saved } = await keepingPhoto(got.imageKey, () => meals.updateMeal(pool(req), id, got.values, got.imageKey));
  await dropOld(oldImageKey);
  await recordAdminAction(pool(req), req, "meal.edit", "meal", id, `Edited meal “${got.values.name}”`);
  res.json(saved);
}));
// { available }: show or hide a meal on the menu
kitchenRouter.patch("/meals/:id/visibility", smallBody, route(async (req, res) => {
  const id = rules.mealId(req.params.id);
  rules.onlyFields(req.body, ["available"]);
  if (typeof req.body.available !== "boolean") return res.status(400).json({ error: "Say whether members see the meal." });
  const saved = await meals.setAvailable(pool(req), id, req.body.available);
  await recordAdminAction(pool(req), req, req.body.available ? "meal.show" : "meal.hide", "meal", id, `${req.body.available ? "Showed" : "Hid"} meal “${saved.meal.name}”`);
  res.json(saved);
}));
// A copy of a meal, hidden until the admin edits and shows it
kitchenRouter.post("/meals/:id/duplicate", photoLimit, route(async (req, res) => {
  const id = rules.mealId(req.params.id);
  const copy = await meals.duplicateMeal(pool(req), id);
  await recordAdminAction(pool(req), req, "meal.duplicate", "meal", copy.meal.id, `Copied a meal as “${copy.meal.name}”`);
  res.status(201).json(copy);
}));
kitchenRouter.delete("/meals/:id", route(async (req, res) => {
  const id = rules.mealId(req.params.id);
  const { name, imageKey } = await meals.deleteMeal(pool(req), id);
  if (imageKey) await photos.remove(imageKey).catch(() => {});
  await recordAdminAction(pool(req), req, "meal.delete", "meal", id, `Deleted meal “${name}”`);
  res.json({ deleted: true });
}));

// ---- Categories, banners, coupons ----

kitchenRouter.get("/categories", route(async (req, res) => {
  res.json(await catalog.adminCategories(pool(req)));
}));
kitchenRouter.post("/categories", photoLimit, mealBody, route(async (req, res) => {
  const got = await withPhoto(req, res, catalogRules.categoryBody, photos.tileLimits);
  if (!got) return;
  const saved = await keepingPhoto(got.imageKey, () => catalog.saveCategory(pool(req), inTransaction, null, got.values, got.imageKey ?? null));
  await recordAdminAction(pool(req), req, "meal.category_add", "meal", String(saved.category.id), `Added category “${got.values.name}”`);
  res.status(201).json(saved);
}));
kitchenRouter.put("/categories/:id", photoLimit, mealBody, route(async (req, res) => {
  const id = catalogRules.id(req.params.id, "category");
  const got = await withPhoto(req, res, catalogRules.categoryBody, photos.tileLimits);
  if (!got) return;
  const old = got.imageKey !== undefined ? await catalog.currentPhoto(pool(req), "categories", id) : null;
  const saved = await keepingPhoto(got.imageKey, () => catalog.saveCategory(pool(req), inTransaction, id, got.values, got.imageKey));
  if (old !== got.imageKey) await dropOld(old);
  await recordAdminAction(pool(req), req, "meal.category_edit", "meal", String(id), `Edited category “${got.values.name}”`);
  res.json(saved);
}));

kitchenRouter.get("/banners", route(async (req, res) => {
  res.json(await catalog.adminBanners(pool(req)));
}));
kitchenRouter.post("/banners", photoLimit, mealBody, route(async (req, res) => {
  const got = await withPhoto(req, res, catalogRules.bannerBody, photos.bannerLimits);
  if (!got) return;
  const saved = await keepingPhoto(got.imageKey, () => catalog.saveBanner(pool(req), null, got.values, got.imageKey ?? null));
  await recordAdminAction(pool(req), req, "meal.banner_add", "meal", String(saved.banner.id), `Added banner “${got.values.title}”`);
  res.status(201).json(saved);
}));
kitchenRouter.put("/banners/:id", photoLimit, mealBody, route(async (req, res) => {
  const id = catalogRules.id(req.params.id, "banner");
  const got = await withPhoto(req, res, catalogRules.bannerBody, photos.bannerLimits);
  if (!got) return;
  const old = got.imageKey !== undefined ? await catalog.currentPhoto(pool(req), "banners", id) : null;
  const saved = await keepingPhoto(got.imageKey, () => catalog.saveBanner(pool(req), id, got.values, got.imageKey));
  if (old !== got.imageKey) await dropOld(old);
  await recordAdminAction(pool(req), req, "meal.banner_edit", "meal", String(id), `Edited banner “${got.values.title}”`);
  res.json(saved);
}));

kitchenRouter.get("/coupons", route(async (req, res) => {
  res.json(await catalog.adminCoupons(pool(req)));
}));
kitchenRouter.post("/coupons", smallBody, route(async (req, res) => {
  const values = catalogRules.couponBody(req.body);
  const saved = await catalog.saveCoupon(pool(req), null, values);
  await recordAdminAction(pool(req), req, "meal.coupon_add", "meal", String(saved.coupon.id), `Added coupon ${values.code}`);
  res.status(201).json(saved);
}));
kitchenRouter.put("/coupons/:id", smallBody, route(async (req, res) => {
  const id = catalogRules.id(req.params.id, "coupon");
  const values = catalogRules.couponBody(req.body);
  const saved = await catalog.saveCoupon(pool(req), id, values);
  await recordAdminAction(pool(req), req, "meal.coupon_edit", "meal", String(id), `Edited coupon ${values.code}`);
  res.json(saved);
}));

for (const [kind, label] of [["categories", "category"], ["banners", "banner"], ["coupons", "coupon"]]) {
  kitchenRouter.delete(`/${kind}/:id`, route(async (req, res) => {
    const id = catalogRules.id(req.params.id, label);
    const { label: name, imageKey } = await catalog.remove(pool(req), kind, id);
    await dropOld(imageKey);
    await recordAdminAction(pool(req), req, `meal.${label}_delete`, "meal", String(id), `Deleted ${label} “${name}”`);
    res.json({ deleted: true });
  }));
}

kitchenRouter.get("/slots", route(async (req, res) => {
  res.json({ slots: await meals.loadSlots(pool(req)) });
}));
kitchenRouter.put("/slots", smallBody, route(async (req, res) => {
  const saved = await meals.saveSlots(pool(req), rules.slotsBody(req.body), req.userId);
  const s = saved.slots;
  const line = rules.SLOTS.map((slot) => (s[slot].active ? `${slot} ${s[slot].startsAt}–${s[slot].endsAt}` : `${slot} off`)).join(", ");
  await recordAdminAction(pool(req), req, "meal.times", "meal", null, `Set delivery times: ${line}`.slice(0, 200));
  res.json(saved);
}));

// ?day= and, since phase 3, ?kitchen=<id> or none (orders without a kitchen)
kitchenRouter.get("/orders", route(async (req, res) => {
  const { kitchen, ...rest } = req.query;
  if (kitchen !== undefined && (typeof kitchen !== "string" || !/^(none|[1-9][0-9]{0,9})$/.test(kitchen))) {
    return res.status(400).json({ error: "Pick a kitchen from the list." });
  }
  res.json(await meals.adminOrders(pool(req), rules.adminDay(rest), kitchen === undefined ? null : kitchen === "none" ? "none" : Number(kitchen)));
}));
kitchenRouter.post("/orders/:id/advance", smallBody, route(async (req, res) => {
  const id = rules.orderId(req.params.id);
  // Phase 3's seven steps (with an optional stock override) once migration 2027-01-05 has run
  const step = (await kitchenOrders.ready(pool(req))) ? assignRules.advanceBody(req.body) : rules.advanceBody(req.body);
  const result = await meals.advance(pool(req), id, step, req);
  await recordAdminAction(pool(req), req, `order.${step.to}`, "order", id, `Order ${result.order.code}: ${step.to.replace(/_/g, " ")}`);
  res.json(result);
}));
kitchenRouter.post("/orders/:id/cancel", smallBody, route(async (req, res) => {
  const id = rules.orderId(req.params.id);
  const { reason } = rules.cancelBody(req.body, { required: true });
  const result = await meals.adminCancel(pool(req), id, reason);
  await recordAdminAction(pool(req), req, "order.cancel", "order", id, `Cancelled order ${result.order.code}`);
  res.json(result);
}));

// ---- Phase 3: an order's kitchen and timeline, holidays ----

const KITCHEN_MIGRATION = "Orders through kitchens need the 2027-01-05-kitchen-orders migration on this server.";
const needsKitchens = (handler) => route(async (req, res, next) => {
  if (!(await kitchenOrders.ready(pool(req)))) return res.status(503).json({ error: KITCHEN_MIGRATION });
  return handler(req, res, next);
});

// Moves an order to another kitchen before cooking starts { kitchenId }
kitchenRouter.post("/orders/:id/kitchen", smallBody, needsKitchens(async (req, res) => {
  const id = rules.orderId(req.params.id);
  const { kitchenId } = assignRules.kitchenBody(req.body);
  const moved = await inTx(pool(req), (db) => kitchenOrders.changeKitchen(db, id, kitchenId, req.userId));
  const order = await meals.adminOrder(pool(req), id);
  await recordAdminAction(pool(req), req, "order.kitchen", "order", id, `Order ${order.code}: moved to ${moved.kitchen.name}`.slice(0, 200));
  res.json({ order });
}));
kitchenRouter.get("/orders/:id/events", needsKitchens(async (req, res) => {
  const id = rules.orderId(req.params.id);
  await meals.adminOrder(pool(req), id); // 404 when it's gone
  res.json({ events: await kitchenOrders.events(pool(req), id) });
}));

kitchenRouter.get("/holidays", needsKitchens(async (req, res) => {
  res.json({ holidays: await kitchenOrders.holidays(pool(req), rules.indiaNow().date) });
}));
kitchenRouter.post("/holidays", smallBody, needsKitchens(async (req, res) => {
  const { day, note } = assignRules.holidayBody(req.body, rules.indiaNow().date);
  await pool(req).query("INSERT INTO meal_holidays (day, note, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)", [day, note, req.userId]);
  await recordAdminAction(pool(req), req, "meal.holiday_add", "meal", null, `No deliveries on ${day}: ${note}`.slice(0, 200));
  res.status(201).json({ holidays: await kitchenOrders.holidays(pool(req), rules.indiaNow().date) });
}));
kitchenRouter.delete("/holidays/:day", needsKitchens(async (req, res) => {
  const day = req.params.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "Pick a day like 2026-11-14." });
  const [result] = await pool(req).query("DELETE FROM meal_holidays WHERE day = ?", [day]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "That day isn't a holiday." });
  await recordAdminAction(pool(req), req, "meal.holiday_remove", "meal", null, `Deliveries back on ${day}`);
  res.json({ holidays: await kitchenOrders.holidays(pool(req), rules.indiaNow().date) });
}));

module.exports = { mealsRouter, ordersRouter, kitchenRouter };
