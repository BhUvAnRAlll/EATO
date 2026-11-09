// Members' meal problems (Meal Operations phase 6, 2026-11-10): a member reports one on their own
// order or meal plan (with an optional photo); the Super Admin works it; every step is an event.
// A refund is a recorded decision (payments are in test mode). Before migration 2027-01-09 nothing
// here runs. Members see only their own issues and never the admin's notes beyond the resolution.
const { ConflictError, NotFoundError } = require("../errors");
const { inTransaction } = require("../gym/service");
const rules = require("./rules");

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const photoUrl = (r) => (r.photo_key ? `/api/admin/kitchen/issues/${r.id}/photo?v=${encodeURIComponent(String(r.photo_key).split(".")[0])}` : null);

let readyCache = { at: 0, value: false };
async function ready(db) {
  if (Date.now() - readyCache.at < 60_000) return readyCache.value;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'meal_issues'");
  readyCache = { at: Date.now(), value: Number(row.n) > 0 };
  return readyCache.value;
}

function issueOf(r, { admin = false } = {}) {
  return {
    id: num(r.id),
    code: rules.issueCode(r.id),
    orderId: r.order_id ?? null,
    orderCode: r.order_id ? r.order_id.slice(0, 8).toUpperCase() : null,
    subscriptionId: r.subscription_id ?? null,
    category: r.category,
    description: r.description,
    status: r.status,
    resolutionNote: r.resolution_note ?? null,
    refund: r.refund_paise === null ? null : Math.round(num(r.refund_paise) / 100),
    createdAt: iso(r.created_at),
    resolvedAt: iso(r.resolved_at),
    ...(admin
      ? { photoUrl: photoUrl(r), member: { id: r.user_id, name: r.member_name ?? null, phone: r.member_phone ?? null }, assignedTo: r.assignee_name ?? null, orderTotal: r.order_total === null || r.order_total === undefined ? null : Math.round(num(r.order_total) / 100) }
      : {}),
  };
}

async function addEvent(db, issueId, action, note, userId) {
  await db.query("INSERT INTO meal_issue_events (issue_id, action, note, created_by) VALUES (?, ?, ?, ?)", [issueId, action, note ?? null, userId ?? null]);
}

/** A member reports a problem on their own order or plan; at most one open issue per order */
async function report(pool, userId, body, photoKey) {
  return inTransaction(pool, async (db) => {
    if (body.orderId) {
      const [[order]] = await db.query("SELECT id FROM orders WHERE id = ? AND user_id = ? FOR UPDATE", [body.orderId, userId]);
      if (!order) throw new NotFoundError("That order isn't on your account.");
      const [[open]] = await db.query("SELECT id FROM meal_issues WHERE order_id = ? AND status IN ('open', 'in_progress')", [body.orderId]);
      if (open) throw new ConflictError(`You've already reported this order (${rules.issueCode(open.id)}). We're on it.`);
    } else {
      const [[sub]] = await db.query("SELECT id FROM meal_subscriptions WHERE id = ? AND user_id = ?", [body.subscriptionId, userId]);
      if (!sub) throw new NotFoundError("That meal plan isn't on your account.");
    }
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM meal_issues WHERE user_id = ? AND status IN ('open', 'in_progress')", [userId]);
    if (num(n) >= 10) throw new ConflictError("You have 10 open reports. We'll get back to you on those first.");
    const [result] = await db.query(
      "INSERT INTO meal_issues (user_id, order_id, subscription_id, category, description, photo_key) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, body.orderId, body.subscriptionId, body.category, body.description, photoKey ?? null],
    );
    await addEvent(db, result.insertId, "opened", null, userId);
    const [[row]] = await db.query("SELECT * FROM meal_issues WHERE id = ?", [result.insertId]);
    return { issue: issueOf(row) };
  });
}

async function mine(pool, userId) {
  const [rows] = await pool.query("SELECT * FROM meal_issues WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);
  return { issues: rows.map((r) => issueOf(r)) };
}

const ADMIN_COLUMNS = `i.*, u.full_name AS member_name, u.phone AS member_phone, a.full_name AS assignee_name, o.total_paise AS order_total`;
const ADMIN_JOINS = "FROM meal_issues i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN users a ON a.id = i.assigned_to LEFT JOIN orders o ON o.id = i.order_id";

async function adminList(pool, { status, search }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("i.status = ?");
    params.push(status);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(u.full_name LIKE ? OR u.phone LIKE ? OR i.description LIKE ? OR i.order_id LIKE ?)");
    params.push(like, like, like, `${search.toLowerCase().replace(/[\\%_]/g, "")}%`);
  }
  const [rows] = await pool.query(`SELECT ${ADMIN_COLUMNS} ${ADMIN_JOINS} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY FIELD(i.status, 'open', 'in_progress', 'resolved', 'rejected'), i.created_at DESC LIMIT 100`, params);
  const [counts] = await pool.query("SELECT status, COUNT(*) AS n FROM meal_issues GROUP BY status");
  const byStatus = Object.fromEntries(rules.STATUSES.map((s) => [s, 0]));
  for (const c of counts) byStatus[c.status] = num(c.n);
  return { issues: rows.map((r) => issueOf(r, { admin: true })), counts: byStatus };
}

async function adminOne(db, id) {
  const [[row]] = await db.query(`SELECT ${ADMIN_COLUMNS} ${ADMIN_JOINS} WHERE i.id = ?`, [id]);
  if (!row) throw new NotFoundError("That issue doesn't exist.");
  const [events] = await db.query(
    "SELECT e.action, e.note, e.created_at, u.full_name FROM meal_issue_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.issue_id = ? ORDER BY e.created_at, e.id",
    [id],
  );
  return { issue: { ...issueOf(row, { admin: true }), events: events.map((e) => ({ action: e.action, note: e.note ?? null, by: e.full_name ?? null, at: iso(e.created_at) })) } };
}

/** The admin works an issue (rules.actionBody decides what changes); the issue row is locked */
async function act(pool, id, action, body, userId) {
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query(`SELECT i.*, o.total_paise AS order_total FROM meal_issues i LEFT JOIN orders o ON o.id = i.order_id WHERE i.id = ? FOR UPDATE`, [id]);
    if (!row) throw new NotFoundError("That issue doesn't exist.");
    const maxRefund = row.order_total === null || row.order_total === undefined ? null : Math.round(num(row.order_total) / 100);
    const change = rules.actionBody(action, body, { status: row.status }, maxRefund);
    const closing = change.status === "resolved" || change.status === "rejected";
    await db.query(
      `UPDATE meal_issues SET status = ?, assigned_to = IF(?, ?, assigned_to), resolution_note = IF(?, ?, resolution_note), refund_paise = IF(?, ?, refund_paise),
         resolved_at = IF(?, NOW(), IF(? = 'open', NULL, resolved_at)) WHERE id = ?`,
      [change.status, change.assign ? 1 : 0, userId, closing ? 1 : 0, change.note, change.refundPaise != null ? 1 : 0, change.refundPaise ?? null, closing ? 1 : 0, change.status, id],
    );
    await addEvent(db, id, action, change.refundPaise != null ? `${change.note} · refund ₹${change.refundPaise / 100}` : change.note, userId);
  });
  return adminOne(pool, id);
}

async function photoKey(pool, id) {
  const [[row]] = await pool.query("SELECT photo_key FROM meal_issues WHERE id = ?", [id]);
  if (!row?.photo_key) throw new NotFoundError("That issue has no photo.");
  return row.photo_key;
}

/** The customer page's issues (admin) */
async function forUser(pool, userId) {
  const [rows] = await pool.query(`SELECT ${ADMIN_COLUMNS} ${ADMIN_JOINS} WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT 20`, [userId]);
  return rows.map((r) => issueOf(r, { admin: true }));
}

module.exports = { ready, report, mine, adminList, adminOne, act, photoKey, forUser };
