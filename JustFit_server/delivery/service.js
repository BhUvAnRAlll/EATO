// Delivery partners and deliveries (Meal Operations phase 4, 2026-11-10). Super Admin only. Every
// delivery change locks the order and its delivery row and is written to the order's timeline;
// the order's own status follows: out for delivery when the partner leaves, delivered (then logged
// into the member's Macro diary by the route) or failed. Before migration 2027-01-06 nothing here runs.
const { ConflictError, NotFoundError } = require("../errors");
const { addEvent } = require("../kitchens/assign");
const rules = require("./rules");

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const OPEN = "('assigned', 'accepted', 'at_kitchen', 'picked_up', 'out_for_delivery', 'at_customer')";

let readyCache = { at: 0, value: false };
async function ready(db) {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'deliveries'");
  readyCache = { at: Date.now(), value: Number(row.n) > 0 };
  return readyCache.value;
}

const partnerOf = (r, pincodes = []) => ({
  id: num(r.id),
  name: r.name,
  phone: r.phone,
  vehicle: r.vehicle,
  vehicleNumber: r.vehicle_number ?? null,
  idStatus: r.id_status,
  active: r.status === "active",
  available: num(r.available) === 1,
  maxOrders: num(r.max_orders),
  note: r.note ?? null,
  carrying: num(r.carrying ?? 0),
  deliveredToday: num(r.delivered_today ?? 0),
  pincodes,
});

/** Partners with what they carry now and what they delivered today (India's day bounds in seconds) */
async function partners(db, { search = "", ids = null, lock = false, dayStart = null } = {}) {
  const where = [];
  const params = [];
  if (ids) {
    where.push("p.id IN (?)");
    params.push(ids);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(p.name LIKE ? OR p.phone LIKE ? OR p.vehicle_number LIKE ?)");
    params.push(like, like, like);
  }
  const [rows] = await db.query(
    `SELECT p.*, (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id = p.id AND d.status IN ${OPEN}) AS carrying,
       (SELECT COUNT(*) FROM deliveries d WHERE d.partner_id = p.id AND d.status = 'delivered' AND d.delivered_at >= FROM_UNIXTIME(?)) AS delivered_today
     FROM delivery_partners p ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.status, p.name LIMIT 200${lock ? " FOR UPDATE" : ""}`,
    [dayStart ?? 0, ...params],
  );
  if (rows.length === 0) return [];
  const [pins] = await db.query("SELECT partner_id, pincode FROM delivery_partner_pincodes WHERE partner_id IN (?) ORDER BY pincode", [rows.map((r) => r.id)]);
  return rows.map((r) => partnerOf(r, pins.filter((p) => num(p.partner_id) === num(r.id)).map((p) => p.pincode)));
}

async function partner(db, id) {
  const [found] = await partners(db, { ids: [id] });
  if (!found) throw new NotFoundError("That delivery partner doesn't exist.");
  return { partner: found };
}

const duplicatePhone = (error) => error?.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_delivery_partners_phone");

async function savePartner(pool, inTransaction, id, f) {
  try {
    const savedId = await inTransaction(pool, async (db) => {
      let partnerId = id;
      const values = [f.name, f.phone, f.vehicle, f.vehicleNumber, f.idStatus, f.active ? "active" : "inactive", f.available ? 1 : 0, f.maxOrders, f.note];
      if (id === null) {
        const [result] = await db.query(
          "INSERT INTO delivery_partners (name, phone, vehicle, vehicle_number, id_status, status, available, max_orders, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          values,
        );
        partnerId = result.insertId;
      } else {
        const [result] = await db.query(
          "UPDATE delivery_partners SET name = ?, phone = ?, vehicle = ?, vehicle_number = ?, id_status = ?, status = ?, available = ?, max_orders = ?, note = ? WHERE id = ?",
          [...values, id],
        );
        if (result.affectedRows === 0) throw new NotFoundError("That delivery partner doesn't exist.");
        await db.query("DELETE FROM delivery_partner_pincodes WHERE partner_id = ?", [id]);
      }
      await db.query("INSERT INTO delivery_partner_pincodes (partner_id, pincode) VALUES ?", [f.pincodes.map((p) => [partnerId, p])]);
      return partnerId;
    });
    return partner(pool, savedId);
  } catch (error) {
    if (duplicatePhone(error)) throw new ConflictError("Another delivery partner has that number.");
    throw error;
  }
}

async function setAvailable(pool, id, available) {
  const [result] = await pool.query("UPDATE delivery_partners SET available = ? WHERE id = ?", [available ? 1 : 0, id]);
  if (result.affectedRows === 0) throw new NotFoundError("That delivery partner doesn't exist.");
  return partner(pool, id);
}

// ---- Deliveries ----

async function lockedOrder(db, orderId) {
  const [[order]] = await db.query("SELECT id, status, delivery_pincode, user_id FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!order) throw new NotFoundError("That order no longer exists.");
  const [[delivery]] = await db.query("SELECT * FROM deliveries WHERE order_id = ? FOR UPDATE", [orderId]);
  return { order, delivery: delivery ?? null };
}

/** The partner for an order: the one asked for (checked), else the free one with the least on the way */
async function pickPartner(db, orderId, pincode, partnerId) {
  const list = (await partners(db, { ids: partnerId ? [partnerId] : null, lock: true }))
    // An order being moved doesn't count against its own partner
    .map((p) => ({ ...p, pincodes: new Set(p.pincodes) }));
  if (partnerId) {
    const p = list[0];
    if (!p) throw new NotFoundError("That delivery partner doesn't exist.");
    const why = rules.partnerProblem(p, pincode);
    if (why) throw new ConflictError(`${p.name} can't take it: ${why}.`);
    return p;
  }
  const chosen = rules.choosePartner(list, pincode);
  if (!chosen) throw new ConflictError("No delivery partner is free for this pincode. Pick one by hand or try again soon.");
  return chosen;
}

/**
 * Gives an order to a delivery partner (or moves it to another before pick-up; a failed delivery
 * starts again as a new attempt, the order back to ready)
 */
async function assign(db, orderId, partnerId, userId) {
  const { order, delivery } = await lockedOrder(db, orderId);
  const retry = delivery?.status === "failed";
  if (!retry && !rules.ASSIGNABLE.includes(order.status)) throw new ConflictError("A partner can be given an order while it's being prepared or ready.");
  if (retry && order.status !== "failed") throw new ConflictError("This order isn't waiting for another try.");
  if (delivery && !retry && !["assigned", "accepted", "at_kitchen"].includes(delivery.status)) throw new ConflictError("The partner has picked it up already.");
  if (delivery && !retry && partnerId && num(delivery.partner_id) === partnerId) throw new ConflictError("That partner already has it.");
  const chosen = await pickPartner(db, orderId, order.delivery_pincode, partnerId);
  await db.query(
    `INSERT INTO deliveries (order_id, partner_id, status, assigned_at) VALUES (?, ?, 'assigned', NOW())
     ON DUPLICATE KEY UPDATE partner_id = VALUES(partner_id), status = 'assigned', assigned_at = NOW(), picked_up_at = NULL, delivered_at = NULL,
       failed_at = NULL, failure_reason = NULL, failure_note = NULL, attempts = attempts + ?`,
    [orderId, chosen.id, retry ? 1 : 0],
  );
  if (retry) await db.query("UPDATE orders SET status = 'ready' WHERE id = ?", [orderId]);
  await addEvent(db, orderId, retry ? "delivery_retry" : delivery ? "delivery_reassigned" : "delivery_assigned", `${chosen.name}`, userId);
  return { partner: { id: chosen.id, name: chosen.name } };
}

/**
 * One delivery step on (`from` is what the admin saw). Leaving for the customer moves the order to
 * out for delivery (it must be ready); delivered delivers the order. → { delivered }
 */
async function advance(db, orderId, { from, to }, userId) {
  const { order, delivery } = await lockedOrder(db, orderId);
  if (!delivery || delivery.status !== from) throw new ConflictError("This delivery has already moved on. Pull down to refresh.");
  if (to === "out_for_delivery" && order.status !== "ready") throw new ConflictError("Mark the order ready for pickup first.");
  await db.query(
    `UPDATE deliveries SET status = ?, picked_up_at = IF(? = 'picked_up', NOW(), picked_up_at), delivered_at = IF(? = 'delivered', NOW(), delivered_at) WHERE order_id = ?`,
    [to, to, to, orderId],
  );
  if (to === "out_for_delivery") await db.query("UPDATE orders SET status = 'out_for_delivery' WHERE id = ?", [orderId]);
  if (to === "delivered") await db.query("UPDATE orders SET status = 'delivered', delivered_at = NOW() WHERE id = ?", [orderId]);
  // Event names fit order_events.status (24 characters): out_for_delivery is written as on_the_way
  await addEvent(db, orderId, `delivery_${to === "out_for_delivery" ? "on_the_way" : to}`, null, userId);
  return { delivered: to === "delivered", userId: order.user_id };
}

/** A failed delivery: the reason is kept and the order is failed until it's retried or cancelled */
async function fail(db, orderId, { reason, note }, userId) {
  const { delivery } = await lockedOrder(db, orderId);
  if (!delivery || delivery.status === "delivered" || delivery.status === "failed") throw new ConflictError("Only a delivery on its way can fail.");
  await db.query("UPDATE deliveries SET status = 'failed', failure_reason = ?, failure_note = ?, failed_at = NOW() WHERE order_id = ?", [reason, note, orderId]);
  await db.query("UPDATE orders SET status = 'failed' WHERE id = ?", [orderId]);
  await addEvent(db, orderId, "delivery_failed", [reason.replace(/_/g, " "), note].filter(Boolean).join(": "), userId);
}

/** The delivery board for today: partners and their loads, ready orders without one, failures */
async function board(pool, dayStart, today) {
  const list = await partners(pool, { dayStart });
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM orders o WHERE o.delivery_date = ? AND o.status = 'ready' AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id)) AS unassigned,
       (SELECT COUNT(*) FROM deliveries d WHERE d.status IN ('assigned', 'accepted', 'at_kitchen')) AS assigned,
       (SELECT COUNT(*) FROM deliveries d WHERE d.status IN ('picked_up', 'out_for_delivery', 'at_customer')) AS ongoing,
       (SELECT COUNT(*) FROM deliveries d WHERE d.status = 'failed') AS failed,
       (SELECT COUNT(*) FROM deliveries d WHERE d.status = 'delivered' AND d.delivered_at >= FROM_UNIXTIME(?)) AS delivered`,
    [today, dayStart],
  );
  const free = list.filter((p) => p.active && p.available && p.idStatus === "verified" && p.carrying < p.maxOrders).length;
  return {
    partners: list,
    counts: { partners: list.length, free, unassigned: num(counts.unassigned), assigned: num(counts.assigned), ongoing: num(counts.ongoing), failed: num(counts.failed), delivered: num(counts.delivered) },
  };
}

/** Each order's delivery for the order lists: Map orderId → { partnerId, partnerName, status, … } */
async function forOrders(db, orderIds) {
  if (orderIds.length === 0 || !(await ready(db))) return new Map();
  const [rows] = await db.query(
    "SELECT d.*, p.name AS partner_name, p.phone AS partner_phone FROM deliveries d LEFT JOIN delivery_partners p ON p.id = d.partner_id WHERE d.order_id IN (?)",
    [orderIds],
  );
  return new Map(rows.map((r) => [r.order_id, {
    partner: r.partner_id === null ? null : { id: num(r.partner_id), name: r.partner_name, phone: r.partner_phone },
    status: r.status, failureReason: r.failure_reason ?? null, failureNote: r.failure_note ?? null, attempts: num(r.attempts),
    assignedAt: iso(r.assigned_at), pickedUpAt: iso(r.picked_up_at), deliveredAt: iso(r.delivered_at),
  }]));
}

module.exports = { ready, partners, partner, savePartner, setAvailable, assign, advance, fail, board, forOrders };
