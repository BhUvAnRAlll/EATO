// Meal plans and subscriptions (Meal Operations phase 5, 2026-11-10). A member subscribes to a plan
// for 7 / 28 / 90 days (paid the Razorpay way, like an order), and each delivery day the generator
// makes one order per meal time (through the kitchens and delivery like any order, paid by the
// subscription). Meals used = the subscription's delivered orders; failed or cancelled ones never
// count. Pausing or skipping a day moves the end on. Before migration 2027-01-08 nothing here runs.
const { ConflictError, NotFoundError } = require("../errors");
const { inTransaction } = require("../gym/service");
const addresses = require("../addresses/service");
const kitchenOrders = require("../kitchens/assign");
const payments = require("../payments/service");
const mealRules = require("../meals/rules");
const rules = require("./rules");

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
const jsonOf = (v) => (typeof v === "string" ? JSON.parse(v) : v ?? []);

let readyCache = { at: 0, value: false };
async function ready(db) {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'meal_subscriptions'");
  readyCache = { at: Date.now(), value: Number(row.n) > 0 };
  return readyCache.value;
}

// ---- Plans ----

function planOf(r, lengths, mealIds) {
  return {
    id: num(r.id), slug: r.slug, name: r.name, tagline: r.tagline, description: r.description, goal: r.goal,
    mealsPerDay: num(r.meals_per_day), slots: rules.slotsFor(num(r.meals_per_day)), calories: num(r.calories), proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g), fatG: num(r.fat_g), waterL: num(r.water_l), included: jsonOf(r.included), active: num(r.active) === 1, sortOrder: num(r.sort_order),
    lengths: rules.lengthsWithSavings(lengths.map((l) => ({ days: num(l.days), price: Math.round(num(l.price_paise) / 100) }))),
    mealIds,
  };
}

/** Plans with their lengths (savings worked out) and meals; members get active plans that have a price */
async function plans(db, { all = false } = {}) {
  const [rows] = await db.query(`SELECT * FROM meal_plans ${all ? "" : "WHERE active = 1"} ORDER BY sort_order, name`);
  if (rows.length === 0) return { plans: [] };
  const ids = rows.map((r) => r.id);
  const [[lengths], [meals]] = await Promise.all([
    db.query("SELECT plan_id, days, price_paise FROM meal_plan_lengths WHERE plan_id IN (?) ORDER BY days", [ids]),
    db.query("SELECT pm.plan_id, pm.meal_id FROM meal_plan_meals pm JOIN meals m ON m.id = pm.meal_id WHERE pm.plan_id IN (?) ORDER BY m.name", [ids]),
  ]);
  const list = rows.map((r) => planOf(r, lengths.filter((l) => num(l.plan_id) === num(r.id)), meals.filter((m) => num(m.plan_id) === num(r.id)).map((m) => m.meal_id)));
  return { plans: all ? list : list.filter((p) => p.lengths.length > 0) };
}

async function plan(db, idOrSlug, { all = false } = {}) {
  const { plans: list } = await plans(db, { all });
  const found = list.find((p) => (typeof idOrSlug === "number" ? p.id === idOrSlug : p.slug === idOrSlug));
  if (!found) throw new NotFoundError("That meal plan isn't available.");
  return { plan: found };
}

async function savePlan(pool, id, f) {
  const savedId = await inTransaction(pool, async (db) => {
    let planId = id;
    const values = [f.name, f.tagline, f.description, f.goal, f.mealsPerDay, f.calories, f.proteinG, f.carbsG, f.fatG, f.waterL, JSON.stringify(f.included), f.active ? 1 : 0, f.sortOrder];
    if (id === null) {
      let slug = rules.slugFor(f.name);
      const [[taken]] = await db.query("SELECT id FROM meal_plans WHERE slug = ?", [slug]);
      if (taken) slug = rules.slugFor(f.name, `-${Date.now().toString(36).slice(-4)}`);
      const [result] = await db.query(
        `INSERT INTO meal_plans (name, tagline, description, goal, meals_per_day, calories, protein_g, carbs_g, fat_g, water_l, included, active, sort_order, slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, slug],
      );
      planId = result.insertId;
    } else {
      const [result] = await db.query(
        `UPDATE meal_plans SET name = ?, tagline = ?, description = ?, goal = ?, meals_per_day = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, water_l = ?,
           included = ?, active = ?, sort_order = ? WHERE id = ?`,
        [...values, id],
      );
      if (result.affectedRows === 0) throw new NotFoundError("That meal plan doesn't exist.");
      await db.query("DELETE FROM meal_plan_lengths WHERE plan_id = ?", [id]);
      await db.query("DELETE FROM meal_plan_meals WHERE plan_id = ?", [id]);
    }
    await db.query("INSERT INTO meal_plan_lengths (plan_id, days, price_paise) VALUES ?", [f.lengths.map((l) => [planId, l.days, l.pricePaise])]);
    if (f.mealIds.length > 0) {
      const [found] = await db.query("SELECT id FROM meals WHERE id IN (?)", [f.mealIds]);
      if (found.length !== f.mealIds.length) throw new ConflictError("One of the meals picked was deleted. Pick again.");
      await db.query("INSERT INTO meal_plan_meals (plan_id, meal_id) VALUES ?", [f.mealIds.map((m) => [planId, m])]);
    }
    return planId;
  });
  return plan(pool, savedId, { all: true });
}

// ---- Subscriptions ----

const COLUMNS = "s.*, u.full_name AS member_name, u.phone AS member_phone";

async function subscriptionOf(db, r, today, { withDays = false } = {}) {
  const [[used]] = await db.query(
    "SELECT SUM(o.status = 'delivered') AS delivered, SUM(o.status NOT IN ('delivered', 'cancelled', 'failed')) AS coming FROM orders o WHERE o.subscription_id = ?",
    [r.id],
  );
  const mealsTotal = num(r.days) * num(r.meals_per_day);
  const pausedFrom = day(r.paused_from);
  const pausedUntil = day(r.paused_until);
  const sub = {
    id: r.id, code: r.id.slice(0, 8).toUpperCase(), planId: r.plan_id === null ? null : num(r.plan_id), planName: r.plan_name, days: num(r.days),
    mealsPerDay: num(r.meals_per_day), slots: rules.slotsFor(num(r.meals_per_day)), calories: num(r.calories), price: Math.round(num(r.price_paise) / 100),
    status: r.status, startsOn: day(r.starts_on), endsOn: day(r.ends_on), pausedFrom, pausedUntil,
    pausedNow: !!pausedFrom && today >= pausedFrom && today <= pausedUntil,
    mealsTotal, mealsUsed: num(used.delivered ?? 0), mealsComing: num(used.coming ?? 0), mealsLeft: Math.max(0, mealsTotal - num(used.delivered ?? 0)),
    address: { receiverName: r.receiver_name, line: r.delivery_address, pincode: r.delivery_pincode },
    payment: r.payment_method ? { method: r.payment_method, ref: r.payment_ref } : null,
    cancelReason: r.cancel_reason ?? null, createdAt: iso(r.created_at),
    member: r.member_name !== undefined ? { name: r.member_name ?? null, phone: r.member_phone ?? null } : undefined,
  };
  if (withDays) sub.upcoming = await upcoming(db, sub, today);
  return sub;
}

/** The next 7 delivery days from tomorrow: each meal time scheduled, skipped, paused or ordered (with its order's step) */
async function upcoming(db, sub, today) {
  const from = rules.addDays(today, 1);
  const to = rules.addDays(today, 7);
  const [rows] = await db.query(
    `SELECT d.day, d.slot, d.status, d.order_id, o.status AS order_status, (SELECT GROUP_CONCAT(oi.meal_name SEPARATOR ', ') FROM order_items oi WHERE oi.order_id = d.order_id) AS meals
     FROM subscription_days d LEFT JOIN orders o ON o.id = d.order_id WHERE d.subscription_id = ? AND d.day BETWEEN ? AND ?`,
    [sub.id, from, to],
  );
  const at = new Map(rows.map((r) => [`${day(r.day)}:${r.slot}`, r]));
  const out = [];
  for (let i = 1; i <= 7; i += 1) {
    const d = rules.addDays(today, i);
    if (d < sub.startsOn || d > sub.endsOn) continue;
    const paused = !!sub.pausedFrom && d >= sub.pausedFrom && d <= sub.pausedUntil;
    out.push({
      day: d,
      slots: sub.slots.map((slot) => {
        const r = at.get(`${d}:${slot}`);
        return { slot, status: paused ? "paused" : r ? (r.status === "ordered" ? r.order_status ?? "ordered" : r.status) : "scheduled", orderId: r?.order_id ?? null, meals: r?.meals ?? null };
      }),
    });
  }
  return out;
}

async function findMine(db, userId, id, lock = false) {
  const [[row]] = await db.query(`SELECT * FROM meal_subscriptions WHERE id = ? AND user_id = ?${lock ? " FOR UPDATE" : ""}`, [id, userId]);
  if (!row) throw new NotFoundError("That subscription isn't on your account.");
  return row;
}

/** The member's current subscription (active, or the last one) with the next 7 days */
async function mine(pool, userId, today) {
  await payments.expireUnpaidSubscriptions(pool);
  const [rows] = await pool.query(
    "SELECT * FROM meal_subscriptions WHERE user_id = ? AND status <> 'awaiting_payment' ORDER BY FIELD(status, 'active', 'paused', 'completed', 'cancelled'), created_at DESC LIMIT 5",
    [userId],
  );
  // An active subscription past its last day is completed
  for (const r of rows) {
    if (r.status === "active" && day(r.ends_on) < today) {
      await pool.query("UPDATE meal_subscriptions SET status = 'completed' WHERE id = ? AND status = 'active'", [r.id]);
      r.status = "completed";
    }
  }
  const current = rows.find((r) => r.status === "active") ?? null;
  return {
    current: current ? await subscriptionOf(pool, current, today, { withDays: true }) : null,
    past: await Promise.all(rows.filter((r) => r !== current).slice(0, 3).map((r) => subscriptionOf(pool, r, today))),
  };
}

/**
 * Subscribes: the plan's price for that length (never the app's), the member's own deliverable
 * address, a start from tomorrow; waits for payment (awaiting_payment) with the checkout's options.
 * The same clientId again returns the same subscription and checkout. One running plan at a time.
 */
async function subscribe(pool, userId, body, today) {
  const [[existing]] = await pool.query("SELECT id FROM meal_subscriptions WHERE user_id = ? AND client_id = ?", [userId, body.clientId]);
  if (existing) return withCheckout(pool, userId, existing.id, today, true);
  await payments.expireUnpaidSubscriptions(pool);
  const { plan: chosen } = await plan(pool, body.planId);
  const length = chosen.lengths.find((l) => l.days === body.days);
  if (!length) throw new ConflictError("That length isn't offered for this plan. Pick another.");
  const address = await addresses.deliverableAddress(pool, userId, body.addressId);
  let id;
  try {
    id = await inTransaction(pool, async (db) => {
      await db.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
      const [[running]] = await db.query("SELECT id FROM meal_subscriptions WHERE user_id = ? AND status = 'active' AND ends_on >= ?", [userId, today]);
      if (running) throw new ConflictError("You already have a running meal plan. Cancel it first, or wait for it to end.");
      // Another unpaid checkout of the member's is replaced by this one
      await db.query("UPDATE meal_subscriptions SET status = 'cancelled', cancel_reason = 'Payment not completed' WHERE user_id = ? AND status = 'awaiting_payment'", [userId]);
      const [[{ uuid }]] = await db.query("SELECT UUID() AS uuid");
      await db.query(
        `INSERT INTO meal_subscriptions (id, user_id, client_id, plan_id, plan_name, days, meals_per_day, calories, price_paise, starts_on, ends_on,
           receiver_name, receiver_phone, delivery_address, delivery_pincode, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid, userId, body.clientId, chosen.id, chosen.name, body.days, chosen.mealsPerDay, chosen.calories, length.price * 100, body.startsOn,
          rules.addDays(body.startsOn, body.days - 1), address.receiverName, address.receiverPhone, mealRules.addressLine(address), address.pincode,
          address.latitude, address.longitude],
      );
      return uuid;
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      const [[winner]] = await pool.query("SELECT id FROM meal_subscriptions WHERE user_id = ? AND client_id = ?", [userId, body.clientId]);
      if (winner) return withCheckout(pool, userId, winner.id, today, true);
    }
    throw error;
  }
  return withCheckout(pool, userId, id, today, false);
}

async function withCheckout(pool, userId, id, today, repeated) {
  const row = await findMine(pool, userId, id);
  const subscription = await subscriptionOf(pool, row, today);
  if (row.status === "cancelled" && row.cancel_reason === "Payment not completed") throw new ConflictError("This checkout expired before it was paid. Tap Subscribe to start again.");
  if (row.status !== "awaiting_payment") return { subscription, checkout: null, repeated };
  const checkout = await payments.openPayment(pool, userId, {
    kind: "subscription", id, totalPaise: num(row.price_paise), receiverPhone: row.receiver_phone, receiverName: row.receiver_name, planName: row.plan_name,
  });
  return { subscription, checkout, repeated };
}

async function confirm(pool, userId, id, body, today) {
  await findMine(pool, userId, id);
  const result = await payments.verifySubscription(pool, userId, id, body);
  return { subscription: await subscriptionOf(pool, await findMine(pool, userId, id), today, { withDays: true }), alreadyPaid: result.alreadyPaid };
}

const runningRow = (row, today) => {
  if (row.status !== "active" || day(row.ends_on) < today) throw new ConflictError("This plan isn't running.");
};

/** Pauses from a day to a day (one pause at a time); the end moves on by those days */
async function pause(pool, id, body, today, { userId = null } = {}) {
  await inTransaction(pool, async (db) => {
    const row = userId ? await findMine(db, userId, id, true) : await adminRow(db, id, true);
    runningRow(row, today);
    if (row.paused_until && day(row.paused_until) >= today) throw new ConflictError("This plan is already paused. Resume it first.");
    const p = rules.pauseBody(body, today, { endsOn: day(row.ends_on) });
    await db.query("UPDATE meal_subscriptions SET paused_from = ?, paused_until = ?, ends_on = DATE_ADD(ends_on, INTERVAL ? DAY) WHERE id = ?", [p.from, p.until, p.days, id]);
    // Orders already made for the paused days are cancelled while the kitchen hasn't started
    await db.query(
      `UPDATE orders SET status = 'cancelled', cancelled_by = ?, cancel_reason = 'Plan paused'
       WHERE subscription_id = ? AND delivery_date BETWEEN ? AND ? AND status IN ('placed', 'accepted')`,
      [userId ? "member" : "admin", id, p.from, p.until],
    );
  });
}

/** Ends a pause early: days not yet paused come off the end again */
async function resume(pool, id, today, { userId = null } = {}) {
  await inTransaction(pool, async (db) => {
    const row = userId ? await findMine(db, userId, id, true) : await adminRow(db, id, true);
    const from = day(row.paused_from);
    const until = day(row.paused_until);
    if (!from || until < today) throw new ConflictError("This plan isn't paused.");
    // Give back the pause days that haven't happened yet (from tomorrow)
    const firstUnused = from > today ? from : rules.addDays(today, 1);
    const unused = firstUnused > until ? 0 : rules.daysBetween(firstUnused, until) + 1;
    await db.query(
      "UPDATE meal_subscriptions SET paused_from = IF(? > ?, NULL, paused_from), paused_until = IF(? > ?, NULL, ?), ends_on = DATE_SUB(ends_on, INTERVAL ? DAY) WHERE id = ?",
      [from, today, from, today, today, unused, id],
    );
  });
}

/** Skips a coming day (every meal time); the end moves on a day. Unskipping undoes it. */
async function skip(pool, userId, id, body, today, undo = false) {
  await inTransaction(pool, async (db) => {
    const row = await findMine(db, userId, id, true);
    runningRow(row, today);
    const { day: d } = rules.skipBody(body, today, { startsOn: day(row.starts_on), endsOn: day(row.ends_on) });
    const [existing] = await db.query("SELECT slot, status FROM subscription_days WHERE subscription_id = ? AND day = ?", [id, d]);
    if (undo) {
      if (!existing.some((e) => e.status === "skipped")) throw new ConflictError("That day isn't skipped.");
      await db.query("DELETE FROM subscription_days WHERE subscription_id = ? AND day = ? AND status = 'skipped'", [id, d]);
      await db.query("UPDATE meal_subscriptions SET ends_on = DATE_SUB(ends_on, INTERVAL 1 DAY) WHERE id = ?", [id]);
      return;
    }
    if (existing.some((e) => e.status === "skipped")) throw new ConflictError("That day is already skipped.");
    if (existing.some((e) => e.status === "ordered")) throw new ConflictError("That day's meals are already with the kitchen, so it can't be skipped now.");
    await db.query("INSERT INTO subscription_days (subscription_id, day, slot, status) VALUES ?", [rules.slotsFor(num(row.meals_per_day)).map((slot) => [id, d, slot, "skipped"])]);
    await db.query("UPDATE meal_subscriptions SET ends_on = DATE_ADD(ends_on, INTERVAL 1 DAY) WHERE id = ?", [id]);
  });
}

/** Cancels a subscription; its orders the kitchen hasn't started are cancelled too */
async function cancel(pool, id, reason, { userId = null } = {}) {
  await inTransaction(pool, async (db) => {
    const row = userId ? await findMine(db, userId, id, true) : await adminRow(db, id, true);
    if (row.status !== "active") throw new ConflictError("Only a running plan can be cancelled.");
    await db.query("UPDATE meal_subscriptions SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason ?? (userId ? "Cancelled by the member" : "Cancelled by justFit"), id]);
    // Cancelled by whoever cancelled the plan ('system' is kept for orders never paid, which lists hide)
    await db.query("UPDATE orders SET status = 'cancelled', cancelled_by = ?, cancel_reason = 'Plan cancelled' WHERE subscription_id = ? AND status IN ('placed', 'accepted')", [userId ? "member" : "admin", id]);
  });
}

// ---- The admin ----

async function adminRow(db, id, lock = false) {
  const [[row]] = await db.query(`SELECT * FROM meal_subscriptions WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!row) throw new NotFoundError("That subscription doesn't exist.");
  return row;
}

async function adminList(pool, { status, search }, today) {
  const where = ["s.status <> 'awaiting_payment'"];
  const params = [];
  if (status === "paused") {
    where.push("s.status = 'active' AND s.paused_from <= ? AND s.paused_until >= ?");
    params.push(today, today);
  } else if (status === "expiring") {
    where.push("s.status = 'active' AND s.ends_on BETWEEN ? AND ?");
    params.push(today, rules.addDays(today, 3));
  } else if (status) {
    where.push("s.status = ?");
    params.push(status);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(u.full_name LIKE ? OR u.phone LIKE ? OR s.plan_name LIKE ?)");
    params.push(like, like, like);
  }
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meal_subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC LIMIT 100`, params);
  return { subscriptions: await Promise.all(rows.map((r) => subscriptionOf(pool, r, today))) };
}

async function adminOne(pool, id, today) {
  const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM meal_subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [id]);
  if (!row) throw new NotFoundError("That subscription doesn't exist.");
  return { subscription: await subscriptionOf(pool, row, today, { withDays: true }) };
}

/** Activates an unpaid subscription by hand (paid in person) */
async function activate(pool, id) {
  const [result] = await pool.query("UPDATE meal_subscriptions SET status = 'active', payment_method = 'admin' WHERE id = ? AND status = 'awaiting_payment'", [id]);
  if (result.affectedRows === 0) throw new ConflictError("Only a subscription waiting for payment can be activated.");
}

async function extend(pool, id, days) {
  const [result] = await pool.query("UPDATE meal_subscriptions SET ends_on = DATE_ADD(ends_on, INTERVAL ? DAY) WHERE id = ? AND status = 'active'", [days, id]);
  if (result.affectedRows === 0) throw new ConflictError("Only a running plan can be extended.");
}

/** Moves a running subscription to another plan from the next order made (price unchanged) */
async function changePlan(pool, id, planId) {
  const { plan: next } = await plan(pool, planId, { all: true });
  const [result] = await pool.query(
    "UPDATE meal_subscriptions SET plan_id = ?, plan_name = ?, meals_per_day = ?, calories = ? WHERE id = ? AND status = 'active'",
    [next.id, next.name, next.mealsPerDay, next.calories, id],
  );
  if (result.affectedRows === 0) throw new ConflictError("Only a running plan can be changed.");
  return next;
}

/**
 * Makes a day's orders for every subscription delivering then: one order per meal time with the
 * plan's next meal, given a kitchen like any order. Already made, skipped or paused meal times are
 * left alone, so running it twice makes nothing new. A holiday or no kitchen able marks the meal time
 * unfilled (with why) and never counts as used. → { made, unfilled }
 */
async function generate(pool, date, loadSlots) {
  const slots = await loadSlots(pool);
  const [subs] = await pool.query("SELECT * FROM meal_subscriptions WHERE status = 'active' AND starts_on <= ? AND ends_on >= ?", [date, date]);
  const holiday = (await kitchenOrders.holidays(pool, date)).find((h) => h.day === date) ?? null;
  const viaKitchens = await kitchenOrders.ready(pool);
  let made = 0;
  let unfilled = 0;
  for (const r of subs) {
    const sub = { status: r.status, startsOn: day(r.starts_on), endsOn: day(r.ends_on), pausedFrom: day(r.paused_from), pausedUntil: day(r.paused_until) };
    if (!rules.deliversOn(sub, date)) continue;
    const [mealRows] = await pool.query(
      "SELECT m.* FROM meal_plan_meals pm JOIN meals m ON m.id = pm.meal_id WHERE pm.plan_id = ? AND m.is_available = TRUE ORDER BY m.name",
      [r.plan_id],
    );
    const plannedSlots = rules.slotsFor(num(r.meals_per_day));
    for (const [slotIndex, slot] of plannedSlots.entries()) {
      try {
        await inTransaction(pool, async (db) => {
          const [[taken]] = await db.query("SELECT status FROM subscription_days WHERE subscription_id = ? AND day = ? AND slot = ? FOR UPDATE", [r.id, date, slot]);
          if (taken) return;
          const why = holiday ? `Holiday: ${holiday.note}` : !slots[slot].active ? "Meal time off" : mealRows.length === 0 ? "No meals in the plan" : null;
          if (why) {
            await db.query("INSERT INTO subscription_days (subscription_id, day, slot, status, note) VALUES (?, ?, ?, 'unfilled', ?)", [r.id, date, slot, why]);
            unfilled += 1;
            return;
          }
          const mealId = rules.mealFor(mealRows.map((m) => m.id), date, slotIndex, sub.startsOn);
          const meal = mealRows.find((m) => m.id === mealId);
          let kitchenId = null;
          if (viaKitchens) {
            try {
              ({ kitchenId } = await kitchenOrders.assign(db, {
                pincode: r.delivery_pincode, date, slot, startsAt: slots[slot].startsAt, items: [{ mealId, quantity: 1 }],
                lat: r.latitude === null ? null : num(r.latitude), lng: r.longitude === null ? null : num(r.longitude),
              }));
            } catch (error) {
              if (!(error instanceof ConflictError)) throw error;
              await db.query("INSERT INTO subscription_days (subscription_id, day, slot, status, note) VALUES (?, ?, ?, 'unfilled', ?)", [r.id, date, slot, "No kitchen could make it"]);
              unfilled += 1;
              return;
            }
          }
          const [[{ uuid }]] = await db.query("SELECT UUID() AS uuid");
          await db.query(
            `INSERT INTO orders (id, user_id, subscription_id, delivery_date, meal_slot, slot_starts_at, slot_ends_at, delivery_pincode, receiver_name, receiver_phone,
               delivery_address, latitude, longitude, total_paise, subtotal_paise, discount_paise, status, payment_method, payment_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'placed', 'subscription', ?)`,
            [uuid, r.user_id, r.id, date, slot, slots[slot].startsAt, slots[slot].endsAt, r.delivery_pincode, r.receiver_name, r.receiver_phone,
              r.delivery_address, r.latitude, r.longitude, r.id.slice(0, 8).toUpperCase()],
          );
          if (viaKitchens) await db.query("UPDATE orders SET kitchen_id = ? WHERE id = ?", [kitchenId, uuid]);
          await db.query(
            "INSERT INTO order_items (order_id, meal_id, meal_name, quantity, unit_price_paise, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)",
            [uuid, meal.id, meal.name, meal.calories, meal.protein_g, meal.carbs_g, meal.fat_g],
          );
          await db.query("INSERT INTO subscription_days (subscription_id, day, slot, status, order_id) VALUES (?, ?, ?, 'ordered', ?)", [r.id, date, slot, uuid]);
          if (viaKitchens) await kitchenOrders.addEvent(db, uuid, "placed", `${r.plan_name} subscription`, null);
          made += 1;
        });
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error; // another run made it first
      }
    }
  }
  return { date, made, unfilled };
}

/** The dashboard's subscription counts (null before migration 2027-01-08) */
async function stats(pool, today, dayStart) {
  if (!(await ready(pool))) return null;
  const [[row]] = await pool.query(
    `SELECT
       SUM(status = 'active' AND created_at >= FROM_UNIXTIME(?)) AS new_today,
       SUM(status = 'active' AND ends_on >= ?) AS active,
       SUM(status = 'active' AND paused_from <= ? AND paused_until >= ?) AS paused,
       SUM(status = 'active' AND ends_on BETWEEN ? AND ?) AS expiring
     FROM meal_subscriptions`,
    [dayStart, today, today, today, today, rules.addDays(today, 3)],
  );
  const [[next]] = await pool.query("SELECT COUNT(*) AS n FROM orders WHERE subscription_id IS NOT NULL AND delivery_date = ? AND status <> 'cancelled'", [rules.addDays(today, 1)]);
  return { newToday: num(row.new_today ?? 0), active: num(row.active ?? 0), paused: num(row.paused ?? 0), expiring: num(row.expiring ?? 0), tomorrow: num(next.n) };
}

module.exports = {
  ready, plans, plan, savePlan, mine, subscribe, confirm, pause, resume, skip, cancel, adminList, adminOne, activate, extend, changePlan, generate, stats,
};
