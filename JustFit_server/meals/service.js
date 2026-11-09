// Meal ordering (2026-11-09): the menu members order from, the Super Admin's meals and delivery
// times, and the orders. The admin is also the kitchen and the delivery person: they move each
// order one step at a time, and a delivered order is logged into the member's Macro diary once.
// Every member query is scoped to the signed-in account; an order that isn't theirs reads as missing.
// Since 2026-11-10 an order is paid the Razorpay way (payments/service.js): it waits as
// awaiting_payment until the gateway's signature is checked, and members and the admin never list
// an order that was never paid.
const { NotFoundError, ConflictError } = require("../errors");
const { ValidationError } = require("../profile");
const { inTransaction } = require("../gym/service");
const addresses = require("../addresses/service");
const diary = require("../macro/diary");
const { logRequestError } = require("../logging");
const rules = require("./rules");
const catalog = require("./catalog");
const payments = require("../payments/service");
const kitchenOrders = require("../kitchens/assign");
const assignRules = require("../kitchens/assignRules");
const deliveries = require("../delivery/service");

// Orders that were paid (or placed before payments): never one still waiting, or one the system
// cancelled because it was never paid
const PAID_ONLY = "o.status <> 'awaiting_payment' AND (o.cancelled_by IS NULL OR o.cancelled_by <> 'system')";

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

const tagsOf = (value) => (typeof value === "string" && value ? value.split(",") : value instanceof Set ? [...value] : []);
const mealToApi = (row, favorite) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  servingSize: row.serving_size ?? null,
  ingredients: row.ingredients ?? null,
  diet: row.diet,
  tags: tagsOf(row.tags),
  calories: num(row.calories),
  proteinG: num(row.protein_g),
  carbsG: num(row.carbs_g),
  fatG: num(row.fat_g),
  price: Math.round(num(row.price_paise) / 100),
  mrp: row.mrp_paise ? Math.round(num(row.mrp_paise) / 100) : null,
  imageUrl: rules.mealImageUrl(row),
  ...(favorite === undefined ? { available: num(row.is_available) === 1 } : { favorite }),
});

// ---- The menu (members) ----

async function menu(pool, userId, { search, diet }) {
  const where = ["m.is_available = TRUE"];
  const params = [userId];
  if (diet) {
    where.push("m.diet = ?");
    params.push(diet);
  }
  if (search) {
    where.push("(m.name LIKE ? OR m.description LIKE ?)");
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const [rows] = await pool.query(
    `SELECT m.*, (f.meal_id IS NOT NULL) AS fav FROM meals m
     LEFT JOIN favorite_meals f ON f.meal_id = m.id AND f.user_id = ?
     WHERE ${where.join(" AND ")} ORDER BY fav DESC, m.is_popular DESC, m.name LIMIT 200`,
    params,
  );
  return { meals: rows.map((r) => mealToApi(r, num(r.fav) === 1)) };
}

async function meal(pool, userId, id) {
  const [[row]] = await pool.query(
    `SELECT m.*, (f.meal_id IS NOT NULL) AS fav FROM meals m
     LEFT JOIN favorite_meals f ON f.meal_id = m.id AND f.user_id = ? WHERE m.id = ? AND m.is_available = TRUE`,
    [userId, id],
  );
  if (!row) throw new NotFoundError("That meal is no longer on the menu.");
  return { meal: mealToApi(row, num(row.fav) === 1) };
}

async function setFavorite(pool, userId, id, on) {
  const [[row]] = await pool.query("SELECT id FROM meals WHERE id = ? AND is_available = TRUE", [id]);
  if (!row) throw new NotFoundError("That meal is no longer on the menu.");
  if (on) await pool.query("INSERT IGNORE INTO favorite_meals (user_id, meal_id) VALUES (?, ?)", [userId, id]);
  else await pool.query("DELETE FROM favorite_meals WHERE user_id = ? AND meal_id = ?", [userId, id]);
  return { mealId: id, favorite: on };
}

/** The meal's photo file name, for the photo route (any meal on the menu) */
async function photoKey(pool, id) {
  const [[row]] = await pool.query("SELECT image_key FROM meals WHERE id = ?", [id]);
  if (!row?.image_key) throw new NotFoundError("That meal has no photo.");
  return row.image_key;
}

// ---- The admin's meals ----

async function adminMeals(pool, onlyId = null) {
  const [rows] = await pool.query(
    `SELECT m.*, (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.meal_id = m.id AND o.status NOT IN ('awaiting_payment', 'delivered', 'cancelled')) AS open_orders
     FROM meals m ${onlyId ? "WHERE m.id = ?" : ""} ORDER BY m.created_at DESC, m.name`,
    onlyId ? [onlyId] : [],
  );
  return { meals: rows.map((r) => ({ ...mealToApi(r), openOrders: num(r.open_orders) })) };
}

const MEAL_FIELDS = (f) => [f.name, f.description, f.servingSize, f.ingredients, f.diet, f.tags.join(","), f.calories, f.proteinG, f.carbsG, f.fatG, f.pricePaise, f.mrpPaise, f.available ? 1 : 0];

async function adminMeal(pool, id) {
  const { meals } = await adminMeals(pool, id);
  if (!meals[0]) throw new NotFoundError("That meal was deleted.");
  return { meal: meals[0] };
}

/** Adds a meal; its photo (already checked and saved by the route) is the file `imageKey` */
async function addMeal(pool, fields, imageKey) {
  const id = rules.mealIdFor(fields.name);
  await pool.query(
    `INSERT INTO meals (name, description, serving_size, ingredients, diet, tags, calories, protein_g, carbs_g, fat_g, price_paise, mrp_paise, is_available, id, image_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...MEAL_FIELDS(fields), id, imageKey],
  );
  return adminMeal(pool, id);
}

/**
 * Changes a meal (every field). `imageKey`: undefined keeps the photo, null removes it, a name puts
 * in a new one. Returns the old photo's file name when it was replaced or removed, so the route can
 * delete the file after the row has changed. Orders already placed keep their copy.
 */
async function updateMeal(pool, id, fields, imageKey) {
  const [[row]] = await pool.query("SELECT image_key FROM meals WHERE id = ?", [id]);
  if (!row) throw new NotFoundError("That meal was deleted.");
  const photo = imageKey === undefined ? row.image_key : imageKey;
  await pool.query(
    `UPDATE meals SET name = ?, description = ?, serving_size = ?, ingredients = ?, diet = ?, tags = ?, calories = ?, protein_g = ?,
       carbs_g = ?, fat_g = ?, price_paise = ?, mrp_paise = ?, is_available = ?, image_key = ? WHERE id = ?`,
    [...MEAL_FIELDS(fields), photo, id],
  );
  return { ...(await adminMeal(pool, id)), oldImageKey: imageKey !== undefined && row.image_key && row.image_key !== imageKey ? row.image_key : null };
}

/** Shows or hides a meal on the menu (hidden meals can't be ordered; orders placed stay) */
async function setAvailable(pool, id, available) {
  const [result] = await pool.query("UPDATE meals SET is_available = ? WHERE id = ?", [available ? 1 : 0, id]);
  if (result.affectedRows === 0) throw new NotFoundError("That meal was deleted.");
  return adminMeal(pool, id);
}

/**
 * Deletes a meal. Past and open orders keep their own copy of its name, price and macros
 * (order_items.meal_id becomes NULL); favourites of it go with it. Returns its photo's file name
 * so the route can delete the file after the row has gone.
 */
/**
 * Copies a meal as "<name> (copy)", hidden from the menu, without its photo (one file belongs to one
 * meal), with its recipe, preparation time and kitchens once migration 2026-12-31 has run
 */
async function duplicateMeal(pool, id) {
  const newId = await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT * FROM meals WHERE id = ? FOR SHARE", [id]);
    if (!row) throw new NotFoundError("That meal was deleted.");
    const name = `${row.name.slice(0, 73)} (copy)`;
    const copyId = rules.mealIdFor(name);
    await db.query(
      `INSERT INTO meals (id, name, description, serving_size, ingredients, image_url, diet, tags, calories, protein_g, carbs_g, fat_g, price_paise, mrp_paise, is_available)
       SELECT ?, ?, description, serving_size, ingredients, image_url, diet, tags, calories, protein_g, carbs_g, fat_g, price_paise, mrp_paise, FALSE FROM meals WHERE id = ?`,
      [copyId, name, id],
    );
    try {
      await db.query("INSERT INTO meal_recipes (meal_id, ingredient_id, quantity) SELECT ?, ingredient_id, quantity FROM meal_recipes WHERE meal_id = ?", [copyId, id]);
      await db.query("INSERT INTO meal_prep (meal_id, prep_minutes) SELECT ?, prep_minutes FROM meal_prep WHERE meal_id = ?", [copyId, id]);
      await db.query("INSERT INTO kitchen_meals (kitchen_id, meal_id, available) SELECT kitchen_id, ?, available FROM kitchen_meals WHERE meal_id = ?", [copyId, id]);
    } catch (error) {
      if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
    }
    return copyId;
  });
  return adminMeal(pool, newId);
}

async function deleteMeal(pool, id) {
  const [[row]] = await pool.query("SELECT id, name, image_key FROM meals WHERE id = ?", [id]);
  if (!row) throw new NotFoundError("That meal was already deleted.");
  await pool.query("DELETE FROM meals WHERE id = ?", [id]);
  return { name: row.name, imageKey: row.image_key ?? null };
}

// ---- Delivery times ----

async function loadSlots(pool) {
  const [rows] = await pool.query("SELECT * FROM meal_delivery_slots");
  const slots = structuredClone(rules.DEFAULT_SLOTS);
  for (const r of rows) {
    slots[r.slot] = {
      startsAt: rules.hhmm(r.starts_at), endsAt: rules.hhmm(r.ends_at), active: num(r.active) === 1,
      // orders a day across justFit (phase 3; null = no limit, and before migration 2027-01-05)
      capacity: r.capacity === undefined || r.capacity === null ? null : num(r.capacity),
    };
  }
  return slots;
}

async function saveSlots(pool, slots, adminId) {
  if (await kitchenOrders.ready(pool)) {
    await pool.query(
      `INSERT INTO meal_delivery_slots (slot, starts_at, ends_at, active, capacity, updated_by) VALUES ?
       ON DUPLICATE KEY UPDATE starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), active = VALUES(active), capacity = VALUES(capacity), updated_by = VALUES(updated_by)`,
      [rules.SLOTS.map((s) => [s, slots[s].startsAt, slots[s].endsAt, slots[s].active ? 1 : 0, slots[s].capacity ?? null, adminId])],
    );
    return { slots: await loadSlots(pool) };
  }
  await pool.query(
    `INSERT INTO meal_delivery_slots (slot, starts_at, ends_at, active, updated_by) VALUES ?
     ON DUPLICATE KEY UPDATE starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), active = VALUES(active), updated_by = VALUES(updated_by)`,
    [rules.SLOTS.map((s) => [s, slots[s].startsAt, slots[s].endsAt, slots[s].active ? 1 : 0, adminId])],
  );
  return { slots: await loadSlots(pool) };
}

/**
 * What the cart needs: the three meal times and, for each of the next 7 days, which are open. Since
 * phase 3 a holiday closes its day (with its note) and a meal time with a daily capacity closes
 * once it is booked up (`full`).
 */
async function orderOptions(pool, now = Date.now()) {
  const slots = await loadSlots(pool);
  let days = rules.orderDays(slots, now);
  let holidays = [];
  if (await kitchenOrders.ready(pool)) {
    const first = days[0].date;
    const last = days[days.length - 1].date;
    holidays = await kitchenOrders.holidays(pool, first);
    const off = new Map(holidays.map((h) => [h.day, h.note]));
    const taken = await kitchenOrders.booked(pool, first, last);
    days = days.map((d) => ({
      ...d,
      holiday: off.get(d.date) ?? null,
      slots: d.slots.map((x) => {
        const full = slots[x.slot].capacity !== null && (taken.get(`${d.date}:${x.slot}`) ?? 0) >= slots[x.slot].capacity;
        return { ...x, open: x.open && !off.has(d.date) && !full, full };
      }),
    }));
  }
  return { slots, days, holidays, cutoffMinutes: rules.CUTOFF_MINUTES, maxQuantity: rules.MAX_QUANTITY };
}

// ---- Orders ----

const ORDER_COLUMNS = `o.id, o.user_id, o.delivery_date, o.meal_slot, o.slot_starts_at, o.slot_ends_at, o.delivery_pincode,
  o.receiver_name, o.receiver_phone, o.delivery_address, o.latitude, o.longitude, o.instructions, o.status, o.cancel_reason,
  o.cancelled_by, o.total_paise, o.subtotal_paise, o.discount_paise, o.coupon_code, o.payment_method, o.payment_ref, o.delivered_at, o.created_at, o.updated_at`;

async function itemsFor(db, orderIds) {
  if (orderIds.length === 0) return new Map();
  const [rows] = await db.query(
    `SELECT oi.order_id, oi.meal_id, oi.meal_name, oi.quantity, oi.unit_price_paise, oi.calories, oi.protein_g, oi.carbs_g, oi.fat_g,
       m.id AS m_id, m.image_url, m.image_key
     FROM order_items oi LEFT JOIN meals m ON m.id = oi.meal_id WHERE oi.order_id IN (?) ORDER BY oi.meal_name`,
    [orderIds],
  );
  const byOrder = new Map();
  for (const r of rows) {
    const list = byOrder.get(r.order_id) ?? [];
    list.push({
      mealId: r.meal_id,
      name: r.meal_name,
      quantity: num(r.quantity),
      price: Math.round(num(r.unit_price_paise) / 100),
      calories: num(r.calories),
      proteinG: num(r.protein_g),
      carbsG: num(r.carbs_g),
      fatG: num(r.fat_g),
      imageUrl: r.m_id ? rules.mealImageUrl({ id: r.m_id, image_url: r.image_url, image_key: r.image_key }) : null,
    });
    byOrder.set(r.order_id, list);
  }
  return byOrder;
}

function orderToApi(r, items, extra = {}) {
  const totals = items.reduce(
    (t, i) => ({ calories: t.calories + i.calories * i.quantity, proteinG: t.proteinG + i.proteinG * i.quantity, carbsG: t.carbsG + i.carbsG * i.quantity, fatG: t.fatG + i.fatG * i.quantity }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return {
    id: r.id,
    code: r.id.slice(0, 8).toUpperCase(),
    date: day(r.delivery_date),
    slot: r.meal_slot,
    slotStartsAt: r.slot_starts_at ? rules.hhmm(r.slot_starts_at) : null,
    slotEndsAt: r.slot_ends_at ? rules.hhmm(r.slot_ends_at) : null,
    status: r.status,
    total: Math.round(num(r.total_paise) / 100),
    subtotal: Math.round(num(r.subtotal_paise ?? r.total_paise) / 100),
    discount: Math.round(num(r.discount_paise ?? 0) / 100),
    couponCode: r.coupon_code ?? null,
    payment: r.payment_method ? { method: r.payment_method, ref: r.payment_ref } : null,
    address: {
      receiverName: r.receiver_name,
      receiverPhone: r.receiver_phone,
      line: r.delivery_address,
      pincode: r.delivery_pincode,
      latitude: r.latitude === null ? null : num(r.latitude),
      longitude: r.longitude === null ? null : num(r.longitude),
      instructions: r.instructions ?? null,
    },
    kitchen: r.kitchen_id === undefined || r.kitchen_id === null ? null : { id: num(r.kitchen_id), name: r.kitchen_name ?? null },
    stockTaken: r.stock_taken === undefined ? false : num(r.stock_taken) === 1,
    delivery: r.delivery ?? null, // phase 4: the partner and the delivery's step
    cancelReason: r.cancel_reason ?? null,
    cancelledBy: r.cancelled_by ?? null,
    deliveredAt: iso(r.delivered_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    items,
    totals: { calories: Math.round(totals.calories), proteinG: Math.round(totals.proteinG), carbsG: Math.round(totals.carbsG), fatG: Math.round(totals.fatG) },
    ...extra,
  };
}

async function ordersWhere(db, where, params, order = "o.delivery_date DESC, o.created_at DESC", limit = 50) {
  // The kitchen (phase 3) once migration 2027-01-05 has run
  const withKitchen = await kitchenOrders.ready(db);
  const [rows] = await db.query(
    `SELECT ${ORDER_COLUMNS}${withKitchen ? ", o.kitchen_id, o.stock_taken, kk.name AS kitchen_name" : ""}, u.full_name AS member_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id${withKitchen ? " LEFT JOIN kitchens kk ON kk.id = o.kitchen_id" : ""}
     WHERE ${where} ORDER BY ${order} LIMIT ${limit}`,
    params,
  );
  const [items, delivered] = await Promise.all([itemsFor(db, rows.map((r) => r.id)), deliveries.forOrders(db, rows.map((r) => r.id))]);
  return rows.map((r) => ({ row: { ...r, delivery: delivered.get(r.id) ?? null }, items: items.get(r.id) ?? [] }));
}

async function myOrder(db, userId, id) {
  const [found] = await ordersWhere(db, "o.id = ? AND o.user_id = ?", [id, userId]);
  if (!found) throw new NotFoundError("That order isn't on your account.");
  return { order: orderToApi(found.row, found.items) };
}

async function myOrders(pool, userId) {
  const found = await ordersWhere(pool, `o.user_id = ? AND ${PAID_ONLY}`, [userId]);
  return { orders: found.map((f) => orderToApi(f.row, f.items)) };
}

// The answer to Pay: the order and, while it waits for payment, the checkout's options
async function withPayment(pool, userId, id, repeated) {
  const { order } = await myOrder(pool, userId, id);
  // A retried Pay for an order the system closed unpaid: the app starts a new order instead
  if (order.status === "cancelled" && order.cancelledBy === "system") throw new ConflictError("This checkout expired before it was paid. Tap Pay to place the order again.");
  if (order.status !== "awaiting_payment") return { order, checkout: null, repeated };
  const checkout = await payments.openPayment(pool, userId, {
    id: order.id, totalPaise: Math.round(order.total * 100), receiverPhone: order.address.receiverPhone, receiverName: order.address.receiverName,
  });
  return { order, checkout, repeated };
}

/**
 * Places an order. The prices and macros come from the menu (never the app), the address must be
 * the member's and deliverable, the meal time must still be open; the order and its items are
 * written in one transaction. Once migration 2026-12-28 has run the order waits for payment
 * (awaiting_payment) and the answer carries the checkout's options; before it, the old test
 * payment places it at once. The same clientId again returns the first order (and its checkout).
 * Any other order of the member's still waiting for payment is cancelled first, so an abandoned
 * checkout never holds a coupon's use.
 */
async function placeOrder(pool, userId, body, now = Date.now()) {
  const paid = await payments.ready(pool);
  const [[existing]] = await pool.query("SELECT id FROM orders WHERE user_id = ? AND client_id = ?", [userId, body.clientId]);
  if (existing) return withPayment(pool, userId, existing.id, true);
  if (paid) await payments.expireUnpaid(pool);

  const slots = await loadSlots(pool);
  const problem = rules.slotProblem(slots, body.date, body.slot, now);
  if (problem) throw new ConflictError(problem);
  const address = await addresses.deliverableAddress(pool, userId, body.addressId);
  const slot = slots[body.slot];
  const viaKitchens = await kitchenOrders.ready(pool);
  if (viaKitchens) {
    const holiday = (await kitchenOrders.holidays(pool, body.date)).find((h) => h.day === body.date);
    if (holiday) throw new ConflictError(`No deliveries that day: ${holiday.note}. Pick another day.`);
    if (slot.capacity !== null && ((await kitchenOrders.booked(pool, body.date, body.date)).get(`${body.date}:${body.slot}`) ?? 0) >= slot.capacity) {
      throw new ConflictError(`${body.slot[0].toUpperCase()}${body.slot.slice(1)} is fully booked that day. Pick another meal time or day.`);
    }
  }

  let id;
  try {
    id = await inTransaction(pool, async (db) => {
      if (paid) {
        await db.query(
          "UPDATE orders SET status = 'cancelled', cancelled_by = 'system', cancel_reason = 'Payment not completed' WHERE user_id = ? AND status = 'awaiting_payment'",
          [userId],
        );
      }
      const ids = body.items.map((i) => i.mealId);
      const [rows] = await db.query("SELECT * FROM meals WHERE id IN (?) AND is_available = TRUE FOR SHARE", [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const missing = ids.find((mealId) => !byId.has(mealId));
      if (missing) throw new ConflictError("A meal in your cart is no longer on the menu. Remove it and try again.");
      const subtotal = body.items.reduce((sum, i) => sum + num(byId.get(i.mealId).price_paise) * i.quantity, 0);
      // The coupon is checked with its row locked, so two orders at once can't both use a last use
      const coupon = body.couponCode ? await catalog.couponFor(db, userId, body.couponCode, subtotal, { lock: true, now }) : null;
      if (coupon?.problem) throw new ConflictError(coupon.problem);
      const discount = coupon?.discountPaise ?? 0;
      // Phase 3: the kitchen that will cook it (locked while it's chosen); none while justFit has no kitchens
      const { kitchenId } = viaKitchens
        ? await kitchenOrders.assign(db, { pincode: address.pincode, date: body.date, slot: body.slot, startsAt: slot.startsAt, items: body.items, lat: address.latitude, lng: address.longitude })
        : { kitchenId: null };
      const [[{ uuid }]] = await db.query("SELECT UUID() AS uuid");
      await db.query(
        `INSERT INTO orders (id, user_id, client_id, delivery_date, meal_slot, slot_starts_at, slot_ends_at, delivery_pincode,
           receiver_name, receiver_phone, delivery_address, latitude, longitude, instructions, total_paise, subtotal_paise, discount_paise,
           coupon_id, coupon_code, status, payment_method, payment_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid, userId, body.clientId, body.date, body.slot, slot.startsAt, slot.endsAt, address.pincode, address.receiverName, address.receiverPhone,
          rules.addressLine(address), address.latitude, address.longitude, address.instructions, subtotal - discount, subtotal, discount,
          coupon?.id ?? null, coupon?.code ?? null,
          paid ? "awaiting_payment" : "placed", paid ? payments.providerName() : "test", paid ? null : rules.testPaymentRef()],
      );
      if (viaKitchens) {
        await db.query("UPDATE orders SET kitchen_id = ? WHERE id = ?", [kitchenId, uuid]);
        if (!paid) await kitchenOrders.addEvent(db, uuid, "placed", null, userId);
      }
      await db.query(
        "INSERT INTO order_items (order_id, meal_id, meal_name, quantity, unit_price_paise, calories, protein_g, carbs_g, fat_g) VALUES ?",
        [body.items.map((i) => {
          const m = byId.get(i.mealId);
          return [uuid, m.id, m.name, i.quantity, m.price_paise, m.calories, m.protein_g, m.carbs_g, m.fat_g];
        })],
      );
      return uuid;
    });
  } catch (error) {
    // Two Pay taps raced with the same clientId: the first one's order is the answer
    if (error?.code === "ER_DUP_ENTRY") {
      const [[winner]] = await pool.query("SELECT id FROM orders WHERE user_id = ? AND client_id = ?", [userId, body.clientId]);
      if (winner) return withPayment(pool, userId, winner.id, true);
    }
    throw error;
  }
  return withPayment(pool, userId, id, false);
}

/** Whether an order's meal time is still open (a late payment may then still place it) */
async function slotOpen(db, orderId, now = Date.now()) {
  const [[row]] = await db.query("SELECT delivery_date, meal_slot FROM orders WHERE id = ?", [orderId]);
  if (!row) return false;
  return rules.slotProblem(await loadSlots(db), day(row.delivery_date), row.meal_slot, now) === null;
}

/** What the checkout returned: checked, then the order is placed */
async function confirmPayment(pool, userId, orderId, body) {
  await myOrder(pool, userId, orderId); // 404 when it isn't theirs
  const result = await payments.verify(pool, userId, orderId, body, { slotOpen: (db, id) => slotOpen(db, id) });
  if (!result.alreadyPaid && (await kitchenOrders.ready(pool))) await kitchenOrders.addEvent(pool, orderId, "placed", `Paid · ${body.providerPaymentId}`, userId);
  return { ...(await myOrder(pool, userId, orderId)), alreadyPaid: result.alreadyPaid };
}

/** A member cancels their own order while it is still only placed (before cooking starts) */
async function cancelMine(pool, userId, id, reason) {
  const [result] = await pool.query(
    "UPDATE orders SET status = 'cancelled', cancelled_by = 'member', cancel_reason = ? WHERE id = ? AND user_id = ? AND status IN ('awaiting_payment', 'placed')",
    [reason, id, userId],
  );
  if (result.affectedRows === 0) {
    const { order } = await myOrder(pool, userId, id); // 404 when it isn't theirs
    throw new ConflictError(order.status === "cancelled" ? "This order is already cancelled." : "This order is already being prepared, so it can't be cancelled.");
  }
  if (await kitchenOrders.ready(pool)) await kitchenOrders.addEvent(pool, id, "cancelled", reason ? `By the member: ${reason}` : "By the member", userId);
  return myOrder(pool, userId, id);
}

// ---- The admin's orders ----

const SLOT_ORDER = "FIELD(o.meal_slot, 'breakfast', 'lunch', 'snack', 'dinner'), o.created_at";

/** The admin's orders for a day; `kitchen`: a kitchen's id, "none" (no kitchen) or null (all) */
async function adminOrders(pool, date, kitchen = null) {
  const viaKitchens = await kitchenOrders.ready(pool);
  const filter = viaKitchens && kitchen !== null ? (kitchen === "none" ? " AND o.kitchen_id IS NULL" : " AND o.kitchen_id = ?") : "";
  const found = await ordersWhere(pool, `o.delivery_date = ? AND ${PAID_ONLY}${filter}`, [date, ...(filter.includes("?") ? [kitchen] : [])], SLOT_ORDER, 500);
  const orders = found.map((f) => orderToApi(f.row, f.items, { memberName: f.row.member_name ?? null }));
  const counts = { all: orders.length };
  for (const step of [...(viaKitchens ? assignRules.STEPS : rules.STEPS), "cancelled"]) counts[step] = orders.filter((o) => o.status === step).length;
  const steps = viaKitchens ? assignRules.STEPS : rules.STEPS;
  return { date, orders, counts, steps, kitchens: viaKitchens, deliveries: await deliveries.ready(pool) };
}

async function adminOrder(db, id) {
  const [found] = await ordersWhere(db, "o.id = ?", [id]);
  if (!found) throw new NotFoundError("That order no longer exists.");
  return orderToApi(found.row, found.items, { memberName: found.row.member_name ?? null });
}

/**
 * Logs a delivered order into the member's Macro diary on its day and meal time, once (its key is
 * "order:<id>"). A full day in the diary or any failure is logged on the server and never undoes
 * the delivery.
 */
async function logDelivered(pool, order, userId, req) {
  const [first, ...rest] = order.items;
  if (!first) return false;
  try {
    await diary.logMeal(pool, userId, {
      date: order.date,
      slot: order.slot,
      title: (rest.length ? `${first.name} + ${rest.length} more` : first.name).slice(0, 120),
      loggedAt: Date.now(),
      source: "order",
      planLogKey: `order:${order.id}`,
      items: order.items.map((i) => ({
        name: i.name, quantity: i.quantity, unit: "serving",
        kcal: i.calories * i.quantity, proteinG: i.proteinG * i.quantity, carbsG: i.carbsG * i.quantity, fatG: i.fatG * i.quantity,
      })),
    });
    return true;
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") return true; // already in the diary
    if (!(error instanceof ValidationError)) logRequestError(req, error);
    return false;
  }
}

/**
 * The admin moves an order one step on; `from` is the step they saw, so a double tap moves it once.
 * Since phase 3 every step is on the order's timeline, and starting to prepare takes the recipes'
 * stock from its kitchen (refused when short, unless overridden with a reason), all in one transaction.
 */
async function advance(pool, id, { from, to, override = false, note = null }, req) {
  const moved = (await kitchenOrders.ready(pool))
    ? await inTransaction(pool, async (db) => {
        const [result] = await db.query(
          `UPDATE orders SET status = ?, delivered_at = IF(? = 'delivered', NOW(), delivered_at) WHERE id = ? AND status = ?`,
          [to, to, id, from],
        );
        if (result.affectedRows === 0) return false;
        // Phase 4: once a partner has the order, leaving and delivering are the delivery's steps
        if ((to === "out_for_delivery" || to === "delivered") && (await deliveries.ready(db))) {
          const [[open]] = await db.query("SELECT status FROM deliveries WHERE order_id = ? AND status <> 'failed'", [id]);
          if (open) throw new ConflictError("A delivery partner has this order: use its delivery steps.");
        }
        if (to === "preparing") await kitchenOrders.takeStock(db, id, { override, note, userId: req.userId });
        await kitchenOrders.addEvent(db, id, to, override ? `Started without enough stock: ${note}` : note, req.userId);
        return true;
      })
    : (await pool.query(`UPDATE orders SET status = ?, delivered_at = IF(? = 'delivered', NOW(), delivered_at) WHERE id = ? AND status = ?`, [to, to, id, from]))[0].affectedRows > 0;
  if (!moved) {
    await adminOrder(pool, id); // 404 when it's gone
    throw new ConflictError("This order has already moved on. Pull down to refresh.");
  }
  const order = await adminOrder(pool, id);
  let macroLogged = null;
  if (to === "delivered") {
    const [[owner]] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [id]);
    macroLogged = await logDelivered(pool, order, owner.user_id, req);
  }
  return { order, macroLogged };
}

async function adminCancel(pool, id, reason) {
  const [result] = await pool.query(
    "UPDATE orders SET status = 'cancelled', cancelled_by = 'admin', cancel_reason = ? WHERE id = ? AND status NOT IN ('awaiting_payment', 'delivered', 'cancelled')",  // a failed delivery can be cancelled
    [reason, id],
  );
  if (result.affectedRows > 0 && (await kitchenOrders.ready(pool))) await kitchenOrders.addEvent(pool, id, "cancelled", reason, null);
  if (result.affectedRows === 0) {
    const order = await adminOrder(pool, id);
    throw new ConflictError(order.status === "cancelled" ? "This order is already cancelled." : "A delivered order can't be cancelled.");
  }
  return { order: await adminOrder(pool, id) };
}

/**
 * The cart's price before Pay: the subtotal from the menu and, with a code, what the coupon takes
 * off (or why it can't be used). Nothing is written.
 */
async function quote(pool, userId, { items, couponCode }, now = Date.now()) {
  const ids = items.map((i) => i.mealId);
  const [rows] = await pool.query("SELECT id, price_paise FROM meals WHERE id IN (?) AND is_available = TRUE", [ids]);
  const price = new Map(rows.map((r) => [r.id, num(r.price_paise)]));
  const missing = ids.filter((mealId) => !price.has(mealId));
  const subtotal = items.reduce((sum, i) => sum + (price.get(i.mealId) ?? 0) * i.quantity, 0);
  const coupon = couponCode ? await catalog.couponFor(pool, userId, couponCode, subtotal, { now }) : null;
  const discount = coupon && !coupon.problem ? coupon.discountPaise : 0;
  return {
    subtotal: subtotal / 100,
    discount: discount / 100,
    total: (subtotal - discount) / 100,
    unavailable: missing,
    coupon: coupon ? { code: couponCode, ok: !coupon.problem, problem: coupon.problem ?? null, title: coupon.title ?? null } : null,
  };
}

module.exports = {
  menu, meal, setFavorite, photoKey, adminMeals, addMeal, updateMeal, duplicateMeal, setAvailable, deleteMeal, quote, mealToApi, loadSlots, saveSlots, orderOptions,
  myOrders, myOrder, placeOrder, confirmPayment, cancelMine, adminOrders, adminOrder, advance, adminCancel, logDelivered,
};
