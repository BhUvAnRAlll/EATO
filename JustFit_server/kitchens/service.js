// Kitchens and the meal-operations dashboard (Meal Operations phase 1, 2026-11-10). The Super Admin
// registers kitchens (details, hours, the pincodes they serve, capacity, a photo), changes their
// status with a reason, keeps each kitchen's staff roster, and reads one day's operations: orders by
// step, revenue, delayed and upcoming orders, kitchens by status. Every route is admin only.
// Orders are assigned to kitchens from phase 3; until then the dashboard counts every order.
const { ConflictError, NotFoundError } = require("../errors");
const { inTransaction } = require("../gym/service");
const xlsx = require("../gym/xlsx");
const rules = require("./rules");
const inventory = require("./inventory");
const deliveries = require("../delivery/service");
const subscriptions = require("../subscriptions/service");

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);
const hoursOf = (v) => (typeof v === "string" ? JSON.parse(v) : v);
// Paid orders only (never one still waiting for payment, or one the system cancelled for it)
const PAID_ONLY = "o.status <> 'awaiting_payment' AND (o.cancelled_by IS NULL OR o.cancelled_by <> 'system')";

const photoUrl = (row) => (row.image_key ? `/api/admin/kitchen/kitchens/${row.id}/photo?v=${encodeURIComponent(String(row.image_key).split(".")[0])}` : null);

function kitchenOf(row, now = Date.now()) {
  const hours = hoursOf(row.opening_hours);
  const at = rules.indiaNow(now);
  return {
    id: num(row.id),
    code: rules.kitchenCode(row.id),
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email ?? null,
    address: row.address,
    area: row.area ?? null,
    city: row.city,
    pincode: row.pincode,
    latitude: row.latitude === null ? null : num(row.latitude),
    longitude: row.longitude === null ? null : num(row.longitude),
    hours,
    openNow: row.status === "active" && rules.openAt(hours, at.day, at.minutes),
    maxDailyOrders: num(row.max_daily_orders),
    prepCapacity: num(row.prep_capacity),
    radiusKm: num(row.radius_km),
    status: row.status,
    statusNote: row.status_note ?? null,
    statusChangedAt: iso(row.status_changed_at),
    photoUrl: photoUrl(row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const staffOf = (r) => ({ id: num(r.id), name: r.name, phone: r.phone, role: r.role, available: num(r.available) === 1, note: r.note ?? null });

/** Every kitchen, with how many pincodes and staff it has; ?status= and ?search= narrow it */
async function list(pool, { status, search }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("k.status = ?");
    params.push(status);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(k.name LIKE ? OR k.city LIKE ? OR k.area LIKE ? OR k.pincode LIKE ? OR EXISTS (SELECT 1 FROM kitchen_pincodes kp WHERE kp.kitchen_id = k.id AND kp.pincode LIKE ?))");
    params.push(like, like, like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT k.*, (SELECT COUNT(*) FROM kitchen_pincodes p WHERE p.kitchen_id = k.id) AS pincode_count,
       (SELECT COUNT(*) FROM kitchen_staff s WHERE s.kitchen_id = k.id) AS staff_count
     FROM kitchens k ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY FIELD(k.status, 'active', 'temporarily_closed', 'maintenance', 'inactive'), k.name LIMIT 200`,
    params,
  );
  const [counts] = await pool.query("SELECT status, COUNT(*) AS n FROM kitchens GROUP BY status");
  const byStatus = Object.fromEntries(rules.STATUSES.map((s) => [s, 0]));
  for (const c of counts) byStatus[c.status] = num(c.n);
  return {
    kitchens: rows.map((r) => ({ ...kitchenOf(r), pincodeCount: num(r.pincode_count), staffCount: num(r.staff_count) })),
    counts: { all: Object.values(byStatus).reduce((a, b) => a + b, 0), ...byStatus },
  };
}

/** One kitchen with its pincodes and staff */
async function get(db, id) {
  const [[row]] = await db.query("SELECT * FROM kitchens WHERE id = ?", [id]);
  if (!row) throw new NotFoundError("That kitchen doesn't exist.");
  const [[pins], [staff]] = await Promise.all([
    db.query("SELECT pincode FROM kitchen_pincodes WHERE kitchen_id = ? ORDER BY pincode", [id]),
    db.query("SELECT * FROM kitchen_staff WHERE kitchen_id = ? ORDER BY FIELD(role, 'manager', 'chef', 'prep'), name", [id]),
  ]);
  return { kitchen: { ...kitchenOf(row), pincodes: pins.map((p) => p.pincode), staff: staff.map(staffOf) } };
}

const FIELDS = (f) => [f.name, f.contactName, f.phone, f.email, f.address, f.area, f.city, f.pincode, f.latitude, f.longitude, JSON.stringify(f.hours), f.maxDailyOrders, f.prepCapacity, f.radiusKm];
const duplicateName = (error) => error?.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_kitchens_name");

/**
 * Adds (id null) or replaces a kitchen's details and pincodes in one transaction. imageKey:
 * undefined keeps the photo, null removes it, a name sets it. → { kitchen, oldImageKey }
 */
async function save(pool, id, fields, imageKey, userId) {
  try {
    const result = await inTransaction(pool, async (db) => {
      let kitchenId = id;
      let oldImageKey = null;
      if (id === null) {
        const [inserted] = await db.query(
          `INSERT INTO kitchens (name, contact_name, phone, email, address, area, city, pincode, latitude, longitude, opening_hours,
             max_daily_orders, prep_capacity, radius_km, image_key, created_by, status_changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [...FIELDS(fields), imageKey ?? null, userId],
        );
        kitchenId = inserted.insertId;
      } else {
        const [[row]] = await db.query("SELECT image_key FROM kitchens WHERE id = ? FOR UPDATE", [id]);
        if (!row) throw new NotFoundError("That kitchen doesn't exist.");
        if (imageKey !== undefined) oldImageKey = row.image_key ?? null;
        await db.query(
          `UPDATE kitchens SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, area = ?, city = ?, pincode = ?, latitude = ?, longitude = ?,
             opening_hours = ?, max_daily_orders = ?, prep_capacity = ?, radius_km = ?${imageKey !== undefined ? ", image_key = ?" : ""} WHERE id = ?`,
          [...FIELDS(fields), ...(imageKey !== undefined ? [imageKey] : []), id],
        );
        await db.query("DELETE FROM kitchen_pincodes WHERE kitchen_id = ?", [id]);
      }
      await db.query("INSERT INTO kitchen_pincodes (kitchen_id, pincode) VALUES ?", [fields.pincodes.map((p) => [kitchenId, p])]);
      return { kitchenId, oldImageKey };
    });
    return { ...(await get(pool, result.kitchenId)), oldImageKey: result.oldImageKey };
  } catch (error) {
    if (duplicateName(error)) throw new ConflictError("Another kitchen already has that name.");
    throw error;
  }
}

/** Activates, deactivates, closes for a while or marks under maintenance, with the reason */
async function setStatus(pool, id, { status, note }) {
  const [result] = await pool.query(
    "UPDATE kitchens SET status = ?, status_note = ?, status_changed_at = NOW() WHERE id = ?",
    [status, status === "active" ? null : note, id],
  );
  if (result.affectedRows === 0) throw new NotFoundError("That kitchen doesn't exist.");
  return get(pool, id);
}

async function photoKey(pool, id) {
  const [[row]] = await pool.query("SELECT image_key FROM kitchens WHERE id = ?", [id]);
  if (!row?.image_key) throw new NotFoundError("That kitchen has no photo.");
  return row.image_key;
}

// ---- The roster ----

const duplicateStaff = (error) => error?.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_kitchen_staff_phone");

async function addStaff(pool, kitchenId, fields) {
  try {
    await inTransaction(pool, async (db) => {
      const [[kitchen]] = await db.query("SELECT id FROM kitchens WHERE id = ? FOR UPDATE", [kitchenId]);
      if (!kitchen) throw new NotFoundError("That kitchen doesn't exist.");
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM kitchen_staff WHERE kitchen_id = ?", [kitchenId]);
      if (num(n) >= rules.MAX_STAFF) throw new ConflictError(`A kitchen can list up to ${rules.MAX_STAFF} people.`);
      await db.query(
        "INSERT INTO kitchen_staff (kitchen_id, name, phone, role, available, note) VALUES (?, ?, ?, ?, ?, ?)",
        [kitchenId, fields.name, fields.phone, fields.role, fields.available ? 1 : 0, fields.note],
      );
    });
  } catch (error) {
    if (duplicateStaff(error)) throw new ConflictError("Someone with that number is already on this kitchen's staff.");
    throw error;
  }
  return get(pool, kitchenId);
}

async function editStaff(pool, kitchenId, staffId, fields) {
  try {
    const [result] = await pool.query(
      "UPDATE kitchen_staff SET name = ?, phone = ?, role = ?, available = ?, note = ? WHERE id = ? AND kitchen_id = ?",
      [fields.name, fields.phone, fields.role, fields.available ? 1 : 0, fields.note, staffId, kitchenId],
    );
    if (result.affectedRows === 0) throw new NotFoundError("That person isn't on this kitchen's staff.");
  } catch (error) {
    if (duplicateStaff(error)) throw new ConflictError("Someone with that number is already on this kitchen's staff.");
    throw error;
  }
  return get(pool, kitchenId);
}

async function removeStaff(pool, kitchenId, staffId) {
  const [result] = await pool.query("DELETE FROM kitchen_staff WHERE id = ? AND kitchen_id = ?", [staffId, kitchenId]);
  if (result.affectedRows === 0) throw new NotFoundError("That person isn't on this kitchen's staff.");
  return get(pool, kitchenId);
}

// ---- The meal-operations dashboard ----

const STEPS = ["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery", "delivered", "failed", "cancelled"];

/**
 * One India day of operations: the day's orders by step, delayed ones, revenue from orders paid
 * that day, the next six days' scheduled orders, and kitchens by status with their total capacity.
 * Subscriptions come with phase 5 (null until then).
 */
async function dashboard(pool, { day: date, today }, now = Date.now()) {
  const { start, end } = rules.dayBounds(date);
  const at = rules.indiaNow(now);
  const todayStart = rules.dayBounds(today).start;
  const [[orders], [[revenue]], [upcoming], [kitchens], stock, delivery, subscriptionStats] = await Promise.all([
    pool.query(`SELECT o.* FROM orders o WHERE o.delivery_date = ? AND ${PAID_ONLY}`, [date]), // o.subscription_id once phase 5 runs
    pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(o.total_paise), 0) AS paise FROM orders o
       WHERE o.created_at >= FROM_UNIXTIME(?) AND o.created_at < FROM_UNIXTIME(?) AND o.status <> 'cancelled' AND ${PAID_ONLY}`,
      [start, end],
    ),
    pool.query(
      `SELECT o.delivery_date, COUNT(*) AS n FROM orders o
       WHERE o.delivery_date > ? AND o.delivery_date <= DATE_ADD(?, INTERVAL 6 DAY) AND o.status NOT IN ('cancelled', 'delivered') AND ${PAID_ONLY}
       GROUP BY o.delivery_date ORDER BY o.delivery_date`,
      [date, date],
    ),
    pool.query("SELECT status, COUNT(*) AS n, COALESCE(SUM(max_daily_orders), 0) AS capacity FROM kitchens GROUP BY status"),
    inventory.stockAlerts(pool, now),
    // Phase 4: today's delivery board counts (null before migration 2027-01-06)
    deliveries.ready(pool).then((on) => (on ? deliveries.board(pool, todayStart, today).then((b) => b.counts) : null)),
    // Phase 5: subscriptions (null before migration 2027-01-08)
    subscriptions.stats(pool, today, todayStart),
  ]);
  const byStep = Object.fromEntries(STEPS.map((s) => [s, 0]));
  const bySlot = { breakfast: 0, lunch: 0, dinner: 0 };
  let delayed = 0;
  for (const o of orders) {
    byStep[o.status] = (byStep[o.status] ?? 0) + 1;
    if (o.status !== "cancelled" && bySlot[o.meal_slot] !== undefined) bySlot[o.meal_slot] += 1;
    if (rules.isDelayed({ status: o.status, date: day(o.delivery_date), slotEndsAt: hhmm(o.slot_ends_at) }, at.date, at.minutes)) delayed += 1;
  }
  const kitchenCounts = Object.fromEntries(rules.STATUSES.map((s) => [s, 0]));
  let activeCapacity = 0;
  for (const k of kitchens) {
    kitchenCounts[k.status] = num(k.n);
    if (k.status === "active") activeCapacity = num(k.capacity);
  }
  const live = orders.length - byStep.cancelled;
  return {
    day: date,
    today,
    orders: {
      total: orders.length,
      individual: orders.filter((o) => !o.subscription_id).length,
      subscription: orders.filter((o) => o.subscription_id).length,
      steps: byStep,
      open: byStep.placed + byStep.accepted + byStep.preparing + byStep.quality_check + byStep.ready + byStep.out_for_delivery,
      delayed,
      bySlot,
    },
    revenue: { orders: num(revenue.n), amount: Math.round(num(revenue.paise) / 100) },
    upcoming: upcoming.map((u) => ({ date: day(u.delivery_date), orders: num(u.n) })),
    kitchens: {
      counts: { all: Object.values(kitchenCounts).reduce((a, b) => a + b, 0), ...kitchenCounts },
      activeCapacity,
      // How full the active kitchens are today (null without an active kitchen)
      load: activeCapacity > 0 ? Math.min(999, Math.round((live / activeCapacity) * 100)) : null,
    },
    delivery, // { partners, free, unassigned, assigned, ongoing, failed, delivered }
    subscriptions: subscriptionStats, // { newToday, active, paused, expiring, tomorrow }
    stock, // { items, low, out, expiring } across kitchens; null before migration 2026-12-31
  };
}

const SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
const STATUS_LABEL = { placed: "New", accepted: "Accepted", preparing: "Preparing", quality_check: "Quality check", ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered", failed: "Delivery failed", cancelled: "Cancelled" };

/** The day's paid orders as a spreadsheet (xlsx) or CSV: one row per order */
async function report(pool, { day: date, format }) {
  const [rows] = await pool.query(
    `SELECT o.id, o.delivery_date, o.meal_slot, o.status, o.receiver_name, o.receiver_phone, o.delivery_pincode, o.total_paise, o.discount_paise,
       o.coupon_code, o.payment_method, o.payment_ref, o.created_at, o.cancel_reason,
       (SELECT GROUP_CONCAT(CONCAT(oi.quantity, ' x ', oi.meal_name) ORDER BY oi.meal_name SEPARATOR ', ') FROM order_items oi WHERE oi.order_id = o.id) AS items
     FROM orders o WHERE o.delivery_date = ? AND ${PAID_ONLY}
     ORDER BY FIELD(o.meal_slot, 'breakfast', 'lunch', 'snack', 'dinner'), o.created_at`,
    [date],
  );
  const header = ["Order", "Delivery day", "Meal time", "Status", "Customer", "Phone", "Pincode", "Meals", "Total (₹)", "Discount (₹)", "Coupon", "Payment", "Placed at (UTC)", "Cancel reason"];
  const data = rows.map((r) => [
    r.id.slice(0, 8).toUpperCase(), day(r.delivery_date), SLOT_LABEL[r.meal_slot] ?? r.meal_slot, STATUS_LABEL[r.status] ?? r.status,
    r.receiver_name ?? "", r.receiver_phone ?? "", r.delivery_pincode, r.items ?? "", Math.round(num(r.total_paise) / 100), Math.round(num(r.discount_paise) / 100),
    r.coupon_code ?? "", [r.payment_method, r.payment_ref].filter(Boolean).join(" "), iso(r.created_at), r.cancel_reason ?? "",
  ]);
  const name = `meal-orders-${date}`;
  if (format === "csv") {
    // A cell that starts like a formula is quoted with a leading apostrophe, so a spreadsheet never runs it
    const cell = (v) => {
      const t = v === null || v === undefined ? "" : String(v);
      const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return { name: `${name}.csv`, type: "text/csv; charset=utf-8", body: Buffer.from(`﻿${[header, ...data].map((r) => r.map(cell).join(",")).join("\n")}\n`) };
  }
  return {
    name: `${name}.xlsx`,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: xlsx.workbook({ sheetName: "Orders", header, rows: data, widths: [10, 12, 10, 16, 20, 12, 8, 40, 10, 11, 10, 24, 24, 24] }),
  };
}

module.exports = { list, get, save, setStatus, photoKey, addStaff, editStaff, removeStaff, dashboard, report, kitchenOf };
