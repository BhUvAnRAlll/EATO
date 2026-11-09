// Orders through kitchens (Meal Operations phase 3, 2026-11-10): giving an order its kitchen,
// moving a kitchen's order one step at a time with its timeline, taking the recipes' stock when
// cooking starts, changing an order's kitchen, holidays and each meal time's daily capacity.
// Before migration 2027-01-05 none of this runs (ready() is false) and orders keep the four
// steps they had.
const { ConflictError, NotFoundError } = require("../errors");
const rules = require("./assignRules");

const num = (v) => Number(v);
const hoursOf = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// Whether migration 2027-01-05 has run (orders.kitchen_id exists), checked at most once a minute
let readyCache = { at: 0, value: false };
async function ready(db) {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'kitchen_id'",
  );
  readyCache = { at: Date.now(), value: Number(row.n) > 0 };
  return readyCache.value;
}

/** Each meal's recipe: Map mealId → [{ ingredientId, quantity }] */
async function recipesFor(db, mealIds) {
  const recipes = new Map();
  if (mealIds.length === 0) return recipes;
  const [rows] = await db.query("SELECT meal_id, ingredient_id, quantity FROM meal_recipes WHERE meal_id IN (?)", [mealIds]);
  for (const r of rows) {
    const list = recipes.get(r.meal_id) ?? [];
    list.push({ ingredientId: num(r.ingredient_id), quantity: num(r.quantity) });
    recipes.set(r.meal_id, list);
  }
  return recipes;
}

/**
 * The kitchens that might take an order, with what problem() needs. `lock` locks their rows (in id
 * order) so two orders at once can't both take a kitchen's last place. `exceptOrderId` leaves an
 * order out of the counts (when moving it).
 */
async function kitchensFor(db, { pincode, date, slot, ids = null, lock = false, exceptOrderId = null }) {
  const [rows] = await db.query(
    `SELECT k.* FROM kitchens k WHERE ${ids ? "k.id IN (?)" : "k.status = 'active' AND EXISTS (SELECT 1 FROM kitchen_pincodes p WHERE p.kitchen_id = k.id AND p.pincode = ?)"}
     ORDER BY k.id${lock ? " FOR UPDATE" : ""}`,
    [ids ?? pincode],
  );
  if (rows.length === 0) return [];
  const kitchenIds = rows.map((r) => r.id);
  const except = exceptOrderId ?? "";
  const [[pins], [menu], [stock], [day], [slotMeals]] = await Promise.all([
    db.query("SELECT kitchen_id, pincode FROM kitchen_pincodes WHERE kitchen_id IN (?)", [kitchenIds]),
    db.query("SELECT kitchen_id, meal_id, available FROM kitchen_meals WHERE kitchen_id IN (?)", [kitchenIds]),
    db.query("SELECT kitchen_id, ingredient_id, quantity FROM kitchen_stock WHERE kitchen_id IN (?)", [kitchenIds]),
    db.query(
      `SELECT kitchen_id, COUNT(*) AS n FROM orders WHERE kitchen_id IN (?) AND delivery_date = ? AND status <> 'cancelled' AND id <> ? GROUP BY kitchen_id`,
      [kitchenIds, date, except],
    ),
    db.query(
      `SELECT o.kitchen_id, COALESCE(SUM(oi.quantity), 0) AS n FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.kitchen_id IN (?) AND o.delivery_date = ? AND o.meal_slot = ? AND o.status <> 'cancelled' AND o.id <> ? GROUP BY o.kitchen_id`,
      [kitchenIds, date, slot, except],
    ),
  ]);
  const by = (list, key) => {
    const map = new Map();
    for (const r of list) map.set(num(r.kitchen_id), [...(map.get(num(r.kitchen_id)) ?? []), r]);
    return map;
  };
  const [pinsBy, menuBy, stockBy] = [by(pins), by(menu), by(stock)];
  const dayBy = new Map(day.map((r) => [num(r.kitchen_id), num(r.n)]));
  const slotBy = new Map(slotMeals.map((r) => [num(r.kitchen_id), num(r.n)]));
  return rows.map((r) => ({
    id: num(r.id),
    name: r.name,
    status: r.status,
    hours: hoursOf(r.opening_hours),
    pincodes: new Set((pinsBy.get(num(r.id)) ?? []).map((p) => p.pincode)),
    menu: new Map((menuBy.get(num(r.id)) ?? []).map((m) => [m.meal_id, num(m.available) === 1])),
    stock: new Map((stockBy.get(num(r.id)) ?? []).map((s) => [num(s.ingredient_id), num(s.quantity)])),
    dayOrders: dayBy.get(num(r.id)) ?? 0,
    maxDailyOrders: num(r.max_daily_orders),
    slotMeals: slotBy.get(num(r.id)) ?? 0,
    prepCapacity: num(r.prep_capacity),
    latitude: r.latitude === null ? null : num(r.latitude),
    longitude: r.longitude === null ? null : num(r.longitude),
    radiusKm: num(r.radius_km),
  }));
}

/**
 * The kitchen for a new order, chosen inside the order's transaction: → { kitchenId } (null while
 * justFit has no kitchens at all, so ordering keeps working before kitchens are set up). With
 * kitchens but none able, a 409 the member reads.
 */
async function assign(db, order) {
  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM kitchens");
  if (num(n) === 0) return { kitchenId: null };
  const kitchens = await kitchensFor(db, { pincode: order.pincode, date: order.date, slot: order.slot, lock: true });
  const need = rules.needs(order.items, await recipesFor(db, order.items.map((i) => i.mealId)));
  const chosen = rules.choose(kitchens, { ...order, need });
  if (!chosen) {
    if (kitchens.length === 0) throw new ConflictError("We don't deliver to this pincode yet. Pick another address.");
    throw new ConflictError("Our kitchens can't make this order for that meal time. Try another meal time or day, or fewer meals.");
  }
  return { kitchenId: chosen.id };
}

async function addEvent(db, orderId, status, note, userId) {
  await db.query("INSERT INTO order_events (order_id, status, note, created_by) VALUES (?, ?, ?, ?)", [orderId, status, note ?? null, userId ?? null]);
}

/**
 * Takes the stock an order's recipes need from its kitchen, once (stock_taken). Short of anything,
 * it refuses unless overridden with a reason; an override takes what there is (never below 0).
 */
async function takeStock(db, orderId, { override, note, userId }) {
  const [[order]] = await db.query("SELECT id, kitchen_id, stock_taken FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!order || order.kitchen_id === null || num(order.stock_taken) === 1) return { taken: 0 };
  const [items] = await db.query("SELECT meal_id AS mealId, quantity FROM order_items WHERE order_id = ? AND meal_id IS NOT NULL", [orderId]);
  const need = rules.needs(items.map((i) => ({ mealId: i.mealId, quantity: num(i.quantity) })), await recipesFor(db, items.map((i) => i.mealId)));
  if (need.size === 0) {
    await db.query("UPDATE orders SET stock_taken = 1 WHERE id = ?", [orderId]);
    return { taken: 0 };
  }
  const [rows] = await db.query(
    `SELECT s.ingredient_id, s.quantity, i.name, i.unit FROM kitchen_stock s JOIN ingredients i ON i.id = s.ingredient_id
     WHERE s.kitchen_id = ? AND s.ingredient_id IN (?) ORDER BY s.ingredient_id FOR UPDATE`,
    [order.kitchen_id, [...need.keys()]],
  );
  const have = new Map(rows.map((r) => [num(r.ingredient_id), r]));
  const [ingredientNames] = await db.query("SELECT id, name, unit FROM ingredients WHERE id IN (?)", [[...need.keys()]]);
  const nameOf = new Map(ingredientNames.map((r) => [num(r.id), `${r.name}`]));
  const short = [...need].find(([id, qty]) => num(have.get(id)?.quantity ?? 0) < qty);
  if (short && !override) {
    const [id, qty] = short;
    throw new ConflictError(`Not enough ${nameOf.get(id) ?? "stock"} in this kitchen (needs ${qty}, has ${num(have.get(id)?.quantity ?? 0)}). Restock it, or start with an override and a reason.`);
  }
  for (const [id, qty] of need) {
    const row = have.get(id);
    if (!row) continue; // not stocked here at all (only with an override)
    const before = num(row.quantity);
    const after = Math.max(0, Math.round((before - qty) * 1000) / 1000);
    await db.query("UPDATE kitchen_stock SET quantity = ? WHERE kitchen_id = ? AND ingredient_id = ?", [after, order.kitchen_id, id]);
    await db.query(
      `INSERT INTO stock_moves (kitchen_id, ingredient_id, kind, quantity, balance_after, note, overridden, order_id, created_by) VALUES (?, ?, 'use', ?, ?, ?, ?, ?, ?)`,
      [order.kitchen_id, id, -qty, after, `Order #${orderId.slice(0, 8).toUpperCase()}${note ? ` · ${note}` : ""}`.slice(0, 120), before < qty ? 1 : 0, orderId, userId],
    );
  }
  await db.query("UPDATE orders SET stock_taken = 1 WHERE id = ?", [orderId]);
  return { taken: need.size };
}

/** Moves an order to another kitchen before cooking starts; the kitchen must be able to take it */
async function changeKitchen(db, orderId, kitchenId, userId) {
  const [[order]] = await db.query("SELECT id, status, kitchen_id, delivery_date, meal_slot, slot_starts_at, delivery_pincode, latitude, longitude FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!order) throw new NotFoundError("That order no longer exists.");
  if (!rules.beforeCooking(order.status)) throw new ConflictError("Cooking has started, so its kitchen can't change.");
  if (num(order.kitchen_id) === kitchenId) throw new ConflictError("It's already with that kitchen.");
  const date = order.delivery_date instanceof Date
    ? `${order.delivery_date.getFullYear()}-${String(order.delivery_date.getMonth() + 1).padStart(2, "0")}-${String(order.delivery_date.getDate()).padStart(2, "0")}`
    : String(order.delivery_date).slice(0, 10);
  const [kitchen] = await kitchensFor(db, { ids: [kitchenId], date, slot: order.meal_slot, lock: true, exceptOrderId: orderId });
  if (!kitchen) throw new NotFoundError("That kitchen doesn't exist.");
  const [items] = await db.query("SELECT meal_id AS mealId, quantity FROM order_items WHERE order_id = ? AND meal_id IS NOT NULL", [orderId]);
  const list = items.map((i) => ({ mealId: i.mealId, quantity: num(i.quantity) }));
  const why = rules.problem(kitchen, {
    pincode: order.delivery_pincode, date, startsAt: String(order.slot_starts_at ?? "12:00").slice(0, 5), items: list,
    need: rules.needs(list, await recipesFor(db, list.map((i) => i.mealId))),
    lat: order.latitude === null ? null : num(order.latitude), lng: order.longitude === null ? null : num(order.longitude),
  });
  if (why) throw new ConflictError(`${kitchen.name} can't take it: ${why}.`);
  await db.query("UPDATE orders SET kitchen_id = ? WHERE id = ?", [kitchenId, orderId]);
  await addEvent(db, orderId, "kitchen_changed", `To ${kitchen.name}`, userId);
  return { kitchen: { id: kitchen.id, name: kitchen.name } };
}

async function events(db, orderId) {
  const [rows] = await db.query(
    "SELECT e.status, e.note, e.created_at, u.full_name FROM order_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.order_id = ? ORDER BY e.created_at, e.id",
    [orderId],
  );
  return rows.map((r) => ({ status: r.status, note: r.note ?? null, by: r.full_name ?? null, at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at }));
}

// ---- Holidays and each meal time's capacity ----

async function holidays(db, fromDay) {
  try {
    const [rows] = await db.query("SELECT day, note FROM meal_holidays WHERE day >= ? ORDER BY day LIMIT 60", [fromDay]);
    return rows.map((r) => ({
      day: r.day instanceof Date ? `${r.day.getFullYear()}-${String(r.day.getMonth() + 1).padStart(2, "0")}-${String(r.day.getDate()).padStart(2, "0")}` : String(r.day).slice(0, 10),
      note: r.note,
    }));
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

/** Orders already booked per day and meal time (not cancelled), for days from `fromDay` */
async function booked(db, fromDay, toDay) {
  const [rows] = await db.query(
    `SELECT delivery_date, meal_slot, COUNT(*) AS n FROM orders WHERE delivery_date BETWEEN ? AND ? AND status <> 'cancelled' GROUP BY delivery_date, meal_slot`,
    [fromDay, toDay],
  );
  const map = new Map();
  for (const r of rows) {
    const d = r.delivery_date instanceof Date
      ? `${r.delivery_date.getFullYear()}-${String(r.delivery_date.getMonth() + 1).padStart(2, "0")}-${String(r.delivery_date.getDate()).padStart(2, "0")}`
      : String(r.delivery_date).slice(0, 10);
    map.set(`${d}:${r.meal_slot}`, num(r.n));
  }
  return map;
}

module.exports = { ready, recipesFor, kitchensFor, assign, addEvent, takeStock, changeKitchen, events, holidays, booked };
