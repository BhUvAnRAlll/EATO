// The gym admin portal's data: one gym's members, payments, enquiries and check-ins. Every
// function takes the gym id the route worked out from the signed-in staff account (gym_staff),
// never one from the request, and every query is scoped to it, so a gym admin only ever sees and
// changes their own gym. Writes that touch a member lock its row and run in one transaction.
const { NotFoundError, ConflictError } = require("../errors");
const { ValidationError } = require("../profile");
const { toE164 } = require("../auth/phone");
const rules = require("./rules");
const staffRules = require("./staffRules");
const predictionRules = require("./predictionRules");
const pauseRules = require("./pauseRules");
const { audit } = require("../admin/overview");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
// The member list's orders (Manage › Member's sort sheet), fragments from this list only
const MEMBER_ORDER = { name: "m.full_name, m.id", days: "m.expires_on, m.full_name, m.id", due: "m.due_amount DESC, m.full_name, m.id" };

// The branch a staff account is working at (the one they last switched to), or null
// Only the portal's people: the gym admin (owner) and Staff. A trainer's branches aren't portal
// branches. `kind` says which the caller is at the open branch (only the owner manages the team).
const PORTAL_KINDS = "('owner', 'staff')";

async function staffGym(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT g.id, g.name AS branch, g.area, g.city, b.id AS brand_id, b.name AS brand, s.kind, s.permissions,
       (SELECT COUNT(*) FROM gym_staff x WHERE x.user_id = s.user_id AND x.kind IN ${PORTAL_KINDS}) AS branch_count
     FROM gym_staff s JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id
     WHERE s.user_id = ? AND s.kind IN ${PORTAL_KINDS} ORDER BY s.selected_at IS NULL, s.selected_at DESC, s.added_at, g.id LIMIT 1`,
    [userId],
  );
  return row ?? null;
}

// The order this login arranged Home's Today tiles in at this branch (gym_staff.home_tiles), or
// null for the default. Before the 2026-12-22 migration there is no column: the default.
async function homeTiles(pool, userId, gymId) {
  try {
    const [[row]] = await pool.query("SELECT home_tiles FROM gym_staff WHERE user_id = ? AND gym_id = ?", [userId, gymId]);
    return rules.homeTilesOf(row?.home_tiles ?? null);
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return null;
    throw error;
  }
}
// Saves it for this login at this branch only; every query is the caller's own gym_staff row
async function saveHomeTiles(pool, userId, gymId, order) {
  await pool.query("UPDATE gym_staff SET home_tiles = ? WHERE user_id = ? AND gym_id = ?", [JSON.stringify(order), userId, gymId]);
  return { order };
}

// access: owner (the gym admin) or staff, so the app shows Staff / Admin Login to the owner only;
// areas / options: what this login may use here (Role & Permission, staffRules.optionsOf), so the app hides the rest
const gymInfo = (gym) => ({ name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city, branchCount: gym.branch_count, access: gym.kind, areas: staffRules.areasOf(gym), options: staffRules.optionsOf(gym) });

// Every branch the account is linked to, and which one is open
async function branches(pool, gym, userId) {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.area, g.city FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ? AND s.kind IN ${PORTAL_KINDS} ORDER BY g.name, g.id`,
    [userId],
  );
  // access: owner (the gym admin, who may add a branch) or staff
  return { currentId: gym.id, gym: gym.brand, access: gym.kind, branches: rows.map((r) => ({ id: r.id, branch: r.name, area: r.area, city: r.city })) };
}

// The gym admin adds another branch of their gym (its name and location) and is linked to it as
// its gym admin in the same transaction; the branch that was open stays open. A name the gym
// already uses is refused, and the justFit team sees the addition in their activity log.
async function addBranch(pool, gym, userId, fields) {
  await inTransaction(pool, async (db) => {
    const [[taken]] = await db.query("SELECT id FROM gyms WHERE brand_id = ? AND name = ? LIMIT 1 FOR UPDATE", [gym.brand_id, fields.branch]);
    if (taken) throw new ConflictError(`${gym.brand} already has a ${fields.branch} branch.`);
    const [branch] = await db.query("INSERT INTO gyms (brand_id, name, area, city, created_by) VALUES (?, ?, ?, ?, ?)", [gym.brand_id, fields.branch, fields.area, fields.city, userId]);
    await db.query("INSERT INTO gym_staff (user_id, gym_id, kind) VALUES (?, ?, 'owner')", [userId, branch.insertId]);
    await audit(db, userId, "gym.branch_add", "gym", branch.insertId, `The gym admin added the ${fields.branch} branch to “${gym.brand}”`);
  });
  return branches(pool, gym, userId);
}

// Opens another of the account's branches; a branch they aren't linked to reads as missing
async function switchBranch(pool, userId, branchId) {
  const [result] = await pool.query(`UPDATE gym_staff SET selected_at = NOW(3) WHERE user_id = ? AND gym_id = ? AND kind IN ${PORTAL_KINDS}`, [userId, branchId]);
  if (result.affectedRows === 0) throw new NotFoundError("That branch isn't one of yours.");
  const gym = await staffGym(pool, userId);
  return branches(pool, gym, userId);
}

const paymentOf = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  detail: r.detail,
  method: r.method,
  amount: r.amount,
  paidOn: r.paid_on,
  memberId: r.member_id ?? null,
});
const PAYMENT_COLUMNS = `id, kind, title, detail, method, amount, ${DAY("paid_on")} AS paid_on, member_id`;

// The bill attached to a payment (gym/paymentReceipts.js), read with the session; ?v= changes with
// the file. The column arrives with migration 2026-12-06: before it every payment reads as having
// no bill, so the member's page and every other payment read keep working
const receiptUrl = (paymentId, key) => (key ? `/api/gym/payments/${paymentId}/receipt?v=${key.slice(0, 8)}` : null);
async function receiptKeys(pool, gymId, ids) {
  if (ids.length === 0) return new Map();
  try {
    const [rows] = await pool.query("SELECT id, receipt_key FROM gym_payments WHERE gym_id = ? AND id IN (?) AND receipt_key IS NOT NULL", [gymId, ids]);
    return new Map(rows.map((r) => [r.id, r.receipt_key]));
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return new Map();
    throw error;
  }
}
async function paymentsWithReceipts(pool, gymId, rows) {
  const keys = await receiptKeys(pool, gymId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...paymentOf(r), receiptUrl: receiptUrl(r.id, keys.get(r.id) ?? null) }));
}

// One of the branch's payments, with its bill (the answer to attaching or removing one)
async function payment(pool, gymId, paymentId) {
  const [[row]] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE id = ? AND gym_id = ?`, [paymentId, gymId]);
  if (!row) throw new NotFoundError("That payment isn't at your gym.");
  const [withReceipt] = await paymentsWithReceipts(pool, gymId, [row]);
  return { payment: withReceipt };
}

const memberOf = (r, today) => ({
  id: r.id,
  code: r.member_code,
  gender: r.gender ?? null,
  email: r.email ?? null,
  heightCm: r.height_cm ?? null,
  weightKg: r.weight_kg === null || r.weight_kg === undefined ? null : Number(r.weight_kg),
  address: r.address ?? null,
  notes: r.notes ?? null,
  photoUrl: r.photo_key ? `/api/gym/members/${r.id}/photo?v=${r.photo_key.slice(0, 8)}` : null,
  name: r.full_name,
  phone: toE164(r.phone),
  dob: r.dob ?? null,
  birthdayToday: Boolean(r.dob) && r.dob.slice(5) === today.slice(5),
  // The catalogue plan's name when bought (migration 2026-12-12); null for a custom plan or before it
  planName: r.plan_name ?? null,
  planLength: r.plan_days ? { duration: r.plan_days, unit: "days" } : { duration: r.plan_months, unit: "months" },
  joinedOn: r.joined_on,
  expiresOn: r.expires_on,
  due: r.due_amount,
  dueBy: r.due_amount > 0 ? r.due_by ?? null : null,
  // Days left on the plan: 0 on its last day, negative once it has ended
  daysLeft: Math.round((Date.parse(`${r.expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000),
  // trainer: who the PT is with (a trainer at this branch), or null
  pt: r.pt_until ? { label: r.pt_label, from: r.pt_from, until: r.pt_until, active: r.pt_until >= today, trainer: r.pt_trainer_id ? { id: r.pt_trainer_id, name: r.pt_trainer_name || "Trainer" } : null } : null,
  overdue: r.due_amount > 0 && Boolean(r.due_by) && r.due_by < today,
  status: r.expires_on < today ? "expired" : r.expires_on === today ? "expiring" : "active",
  inToday: Boolean(r.in_today),
  insideNow: Boolean(r.inside_now),
  // Pause Membership: the open pause (a request waiting, or an approved pause not yet over) and
  // whether the membership is paused today
  pause: openPauseOf(r.pause_json, today),
  pausedNow: pauseRules.pausedOn(openPauseOf(r.pause_json, today), today),
});
// The newest pending or approved pause as the column's JSON (mysql2 may hand it over parsed or as text)
function openPauseOf(json, today) {
  if (!json) return null;
  const p = typeof json === "string" ? JSON.parse(json) : json;
  return pauseRules.isOpen(p, today) ? p : null;
}
const MEMBER_COLUMNS = `m.id, m.member_code, m.gender, m.email, m.height_cm, m.weight_kg, m.address, m.notes, m.photo_key, m.full_name, m.phone, ${DAY("m.dob")} AS dob, m.plan_months, m.plan_days, ${DAY("m.joined_on")} AS joined_on, ${DAY("m.expires_on")} AS expires_on, m.due_amount, ${DAY("m.due_by")} AS due_by, m.pt_label, ${DAY("m.pt_from")} AS pt_from, ${DAY("m.pt_until")} AS pt_until, m.pt_trainer_id,
  (SELECT u.full_name FROM users u WHERE u.id = m.pt_trainer_id) AS pt_trainer_name,
  EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date = ?) AS in_today,
  EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.status = 'inside' AND a.checked_in_at >= NOW() - INTERVAL 12 HOUR) AS inside_now,
  (SELECT JSON_OBJECT('id', p.id, 'status', p.status, 'by', p.requested_by, 'from', DATE_FORMAT(p.pause_from, '%Y-%m-%d'), 'until', DATE_FORMAT(p.pause_until, '%Y-%m-%d'), 'days', p.days, 'reason', p.reason)
     FROM gym_membership_pauses p WHERE p.member_id = m.id AND p.status IN ('pending', 'approved') ORDER BY p.id DESC LIMIT 1) AS pause_json`;

// Home: today's revenue by method, today's counts, what needs attention, the latest payments
async function dashboard(pool, gym, today) {
  // Three independent reads, sent together (2026-11-07)
  const [[[money]], [[counts]], [recent]] = await Promise.all([pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN method = 'online' THEN amount END), 0) AS online,
       COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0) AS cash,
       COALESCE(SUM(kind = 'admission'), 0) AS admissions,
       COALESCE(SUM(kind = 'renewal'), 0) AS renewals,
       COALESCE(SUM(kind = 'due'), 0) AS due_paid,
       COALESCE(SUM(kind = 'pt'), 0) AS pt,
       COALESCE(SUM(kind = 'sale'), 0) AS products
     FROM gym_payments WHERE gym_id = ? AND paid_on = ?`,
    [gym.id, today],
  ), pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_enquiries WHERE gym_id = ? AND enquired_on = ?) AS enquiries,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND due_amount > 0) AS due_members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on = ?) AS expiring,
       (SELECT COUNT(DISTINCT member_id) FROM gym_attendance WHERE gym_id = ? AND on_date = ?) AS attendance,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on BETWEEN ? AND ?) AS expiring_soon,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND DATE_FORMAT(dob, '%m-%d') = ?) AS birthdays,
       (SELECT COUNT(*) FROM gym_membership_pauses WHERE gym_id = ? AND status = 'pending') AS pause_requests`,
    [gym.id, today, gym.id, gym.id, today, gym.id, today, gym.id, rules.addDays(today, 1), rules.addDays(today, 3), gym.id, today.slice(5), gym.id],
  ), pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? ORDER BY id DESC LIMIT 5`, [gym.id])]);
  return {
    gym: gymInfo(gym),
    today,
    revenue: { online: Number(money.online), cash: Number(money.cash) },
    stats: { admission: Number(money.admissions), renewal: Number(money.renewals), enquiry: counts.enquiries, duePaid: Number(money.due_paid), pt: Number(money.pt), product: Number(money.products) },
    alerts: { dueMembers: counts.due_members, expiringToday: counts.expiring, attendance: counts.attendance, expiringSoon: counts.expiring_soon, birthdays: counts.birthdays, pauseRequests: counts.pause_requests },
    recent: recent.map(paymentOf),
  };
}

// The member search (name, ID, and a phone when digits are typed) as a SQL fragment with its
// bound values; "" matches everyone. Shared by the member list and the predictions.
function memberSearch(search) {
  if (!search) return { sql: "", params: [] };
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = search.replace(/[\s+-]/g, "");
  if (/^\d{3,12}$/.test(digits)) {
    // Phones are stored as 10 digits: a typed "+91 98765" (or 91 and all ten) searches "98765"
    const local = /^\s*\+91/.test(search) || (digits.length === 12 && digits.startsWith("91")) ? digits.slice(2) : digits;
    return { sql: " AND (m.full_name LIKE ? OR m.phone LIKE ? OR m.member_code LIKE ?)", params: [like, `%${local.slice(-10)}%`, `%${digits}`] };
  }
  return { sql: " AND (m.full_name LIKE ? OR m.member_code LIKE ?)", params: [like, like] };
}

// The last day "expiring soon" looks at: today + days, or (for "all") every plan still running
const expiringUntil = (today, days) => (days === rules.EXPIRING_SOON_DAYS.all ? "9999-12-31" : rules.addDays(today, days));

async function members(pool, gymId, { filter, search, days = rules.EXPIRING_SOON_DAYS.default, sort = "name", page = 1 }, today) {
  const params = [today, gymId];
  let where = "WHERE m.gym_id = ?";
  const found = memberSearch(search);
  where += found.sql;
  params.push(...found.params);
  if (filter === "due") where += " AND m.due_amount > 0";
  if (filter === "overdue") { where += " AND m.due_amount > 0 AND m.due_by < ?"; params.push(today); }
  if (filter === "expiring") { where += " AND m.expires_on = ?"; params.push(today); }
  if (filter === "expiring_soon") { where += " AND m.expires_on BETWEEN ? AND ?"; params.push(rules.addDays(today, 1), expiringUntil(today, days)); }
  if (filter === "birthday") { where += " AND DATE_FORMAT(m.dob, '%m-%d') = ?"; params.push(today.slice(5)); }
  if (filter === "expired") { where += " AND m.expires_on < ?"; params.push(today); }
  // 50 a page (one more row tells whether there is a next page), the counts fetched alongside
  const size = rules.limits.page;
  const withName = await hasPlanName(pool);
  const [[rows], counts] = await Promise.all([
    pool.query(`SELECT ${memberColumns(withName)} FROM gym_members m ${where} ORDER BY ${MEMBER_ORDER[sort] ?? MEMBER_ORDER.name} LIMIT ? OFFSET ?`, [...params, size + 1, (page - 1) * size]),
    memberCounts(pool, gymId, found, today, days),
  ]);
  const list = rows.slice(0, size);
  return { members: list.map((r) => memberOf(r, today)), counts, page, nextPage: rows.length > size ? page + 1 : null };
}

// How many members each filter would list (within the same search), for the list's chips;
// "expiring soon" counts the window the caller asked for (tomorrow to `days` ahead, or all)
async function memberCounts(pool, gymId, found, today, days) {
  const [[c]] = await pool.query(
    `SELECT COUNT(*) AS all_members,
            COALESCE(SUM(m.due_amount > 0), 0) AS due,
            COALESCE(SUM(m.due_amount > 0 AND m.due_by < ?), 0) AS overdue,
            COALESCE(SUM(m.expires_on = ?), 0) AS expiring,
            COALESCE(SUM(m.expires_on BETWEEN ? AND ?), 0) AS expiring_soon,
            COALESCE(SUM(m.expires_on < ?), 0) AS expired,
            COALESCE(SUM(DATE_FORMAT(m.dob, '%m-%d') = ?), 0) AS birthday
     FROM gym_members m WHERE m.gym_id = ?${found.sql}`,
    [today, today, rules.addDays(today, 1), expiringUntil(today, days), today, today.slice(5), gymId, ...found.params],
  );
  return {
    all: Number(c.all_members), due: Number(c.due), overdue: Number(c.overdue), expiring: Number(c.expiring),
    expiring_soon: Number(c.expiring_soon), expired: Number(c.expired), birthday: Number(c.birthday),
  };
}

async function memberRow(db, gymId, memberId, today, { lock = false } = {}) {
  const [[row]] = await db.query(`SELECT ${memberColumns(await hasPlanName(db))} FROM gym_members m WHERE m.id = ? AND m.gym_id = ?${lock ? " FOR UPDATE" : ""}`, [today, memberId, gymId]);
  if (!row) throw new NotFoundError("That member isn't at your gym.");
  return row;
}

async function member(pool, gymId, memberId, today) {
  const row = await memberRow(pool, gymId, memberId, today);
  const [[payments], [[visits]]] = await Promise.all([
    pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? AND member_id = ? ORDER BY id DESC LIMIT 20`, [gymId, memberId]),
    pool.query(
      `SELECT COUNT(*) AS month, ${DAY("MAX(on_date)")} AS last FROM gym_attendance WHERE gym_id = ? AND member_id = ? AND on_date >= ?`,
      [gymId, memberId, `${today.slice(0, 8)}01`],
    ),
  ]);
  return { member: { ...memberOf(row, today), visitsThisMonth: visits.month, lastVisit: visits.last ?? null }, payments: await paymentsWithReceipts(pool, gymId, payments) };
}

// One transaction: `work(connection)` runs between BEGIN and COMMIT, rolled back on any error
async function inTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

const duplicatePhone = (error) => error?.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_gym_members_phone");
const SAME_PHONE = "A member with that phone number is already at your gym.";

// dueBy (due payments only): the date the due was to be paid by, kept for the payment-on-time
// prediction. Written only when there is one, so every other payment keeps working before
// migration 2026-12-02-gym-payment-due-by.sql has run.
// invoiceNo (2026-11-07): the branch's next invoice number, taken with the counter row locked, so
// every payment has an invoice of its own from the moment it is saved. A counter sale arrives with
// the pool, so it opens a transaction of its own first. Before migration 2026-12-07-gym-invoices.sql
// there is no counter: the payment is saved without a number and gets one the first time its
// invoice is opened (gym/invoices.js).
async function nextInvoiceNo(db, gymId) {
  try {
    const [[row]] = await db.query("SELECT next_invoice_no FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
    await db.query("UPDATE gyms SET next_invoice_no = next_invoice_no + 1 WHERE id = ?", [gymId]);
    return row.next_invoice_no;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return null;
    throw error;
  }
}
async function addPayment(db, gymId, userId, payment, today) {
  if (typeof db.getConnection === "function") return inTransaction(db, (connection) => addPayment(connection, gymId, userId, payment, today));
  const { memberId = null, kind, title, detail, method, amount, dueBy = null } = payment;
  const columns = ["gym_id", "member_id", "kind", "title", "detail", "method", "amount", "paid_on", "created_by"];
  const values = [gymId, memberId, kind, title, detail, method, amount, today, userId];
  if (dueBy) { columns.push("due_by"); values.push(dueBy); }
  const invoiceNo = await nextInvoiceNo(db, gymId);
  if (invoiceNo) { columns.push("invoice_no"); values.push(invoiceNo); }
  const [result] = await db.query(`INSERT INTO gym_payments (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, values);
  return result.insertId;
}

// "3 Months"; "15 Days" for a member whose plan was saved in days before 2026-11-07, and for a
// PT whose picked end date isn't a whole number of months
const planText = ({ duration, unit }) => `${duration} ${unit === "days" ? (duration === 1 ? "Day" : "Days") : duration === 1 ? "Month" : "Months"}`;
// A PT payment's line: the package and how long it runs ("PT · 12 sessions · 1 Month"); when the
// end date was picked by hand and isn't the duration's, the days between the two dates
const ptDetail = (body, from, until) => {
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  const length = until === rules.planEnd(from, body.duration) ? planText(body) : planText({ duration: days, unit: "days" });
  return `PT · ${body.package} · ${length}`.slice(0, 80);
};
// Whether gym_members has plan_name yet (migration 2026-12-12): asked once, and again a minute
// later while it's missing, so members keep working before the migration runs
let planNameColumn = { has: false, at: 0 };
async function hasPlanName(db) {
  if (planNameColumn.has || Date.now() - planNameColumn.at < 60000) return planNameColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members' AND COLUMN_NAME = 'plan_name'");
  planNameColumn = { has: Number(row.n) > 0, at: Date.now() };
  return planNameColumn.has;
}
// The member columns, with the plan's name once the column exists
const memberColumns = (withPlanName) => (withPlanName ? `${MEMBER_COLUMNS}, m.plan_name` : MEMBER_COLUMNS);

// The catalogue plan's name for Add Member and Renewal: one of this branch's plans, or a 400
async function catalogPlanName(db, gymId, planId) {
  if (planId === null) return null;
  const [[item]] = await db.query(`SELECT name FROM gym_catalog_items WHERE id = ? AND gym_id = ? AND kind = 'plan'${await activeOnly(db)}`, [planId, gymId]);
  if (!item) throw new ValidationError("Pick one of your plans.");
  return item.name;
}

// The members row's two length columns: plan_months is set and plan_days NULL (day plans ended
// on 2026-11-07; older rows may still carry plan_days, which the reads above still show)
const planColumns = ({ duration }) => [duration, null];

// The ID the next new member at this branch will get (a preview: the save makes the real one)
async function nextMemberCode(pool, gym) {
  const [[row]] = await pool.query("SELECT next_member_no FROM gyms WHERE id = ?", [gym.id]);
  return { code: rules.memberCode(gym.brand, gym.branch, row.next_member_no) };
}

// A new member: the branch's next ID (its counter locked, so two saves never share one), their
// plan from today; what they didn't pay is owed
async function admit(pool, gym, userId, body, today) {
  const gymId = gym.id;
  try {
    const memberId = await inTransaction(pool, async (db) => {
      const [[counter]] = await db.query("SELECT next_member_no FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
      const code = rules.memberCode(gym.brand, gym.branch, counter.next_member_no);
      await db.query("UPDATE gyms SET next_member_no = next_member_no + 1 WHERE id = ?", [gymId]);
      const planName = await catalogPlanName(db, gymId, body.planId);
      const [result] = await db.query(
        "INSERT INTO gym_members (gym_id, member_code, full_name, phone, dob, gender, email, height_cm, weight_kg, address, notes, plan_months, plan_days, joined_on, expires_on, due_amount, due_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [gymId, code, body.name, body.phone, body.dob, body.gender, body.email, body.heightCm, body.weightKg, body.address, body.notes, ...planColumns(body), body.joinedOn, rules.planEnd(body.joinedOn, body.duration), body.due, body.dueBy, userId],
      );
      if (planName !== null && (await hasPlanName(db))) await db.query("UPDATE gym_members SET plan_name = ? WHERE id = ?", [planName, result.insertId]);
      await addPayment(db, gymId, userId, { memberId: result.insertId, kind: "admission", title: body.name, detail: planText(body), method: body.method, amount: body.paid }, body.paidOn);
      return result.insertId;
    });
    return member(pool, gymId, memberId, today);
  } catch (error) {
    if (duplicatePhone(error)) throw new ConflictError(SAME_PHONE);
    throw error;
  }
}

// A renewal: the new plan follows on from the current one (or starts today if it has ended)
async function renew(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    const due = row.due_amount + body.due;
    if (due > rules.limits.amount) throw new ValidationError("That would make the due amount more than ₹10,00,000.");
    // A new amount owed takes the date given; otherwise an earlier one stays
    const dueBy = body.due > 0 ? body.dueBy : due > 0 ? row.due_by : null;
    await db.query("UPDATE gym_members SET plan_months = ?, plan_days = ?, expires_on = ?, due_amount = ?, due_by = ? WHERE id = ? AND gym_id = ?", [...planColumns(body), rules.renewedUntil(row.expires_on, today, body.duration), due, dueBy, memberId, gymId]);
    // The plan they renewed onto: the catalogue plan's name, or none for a custom plan
    const planName = await catalogPlanName(db, gymId, body.planId);
    if (await hasPlanName(db)) await db.query("UPDATE gym_members SET plan_name = ? WHERE id = ? AND gym_id = ?", [planName, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "renewal", title: row.full_name, detail: planText(body), method: body.method, amount: body.paid }, today);
  });
  return member(pool, gymId, memberId, today);
}

// Part or all of what a member owes
async function collectDue(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    if (row.due_amount === 0) throw new ValidationError("This member has no dues.");
    if (body.amount > row.due_amount) throw new ValidationError(`That's more than their due (₹${row.due_amount.toLocaleString("en-IN")}).`);
    // Paid in full: no date any more; part: the new date if one was given, else the old one
    const left = row.due_amount - body.amount;
    const dueBy = left === 0 ? null : body.dueBy ?? row.due_by;
    // What's still owed always has a date (else the member could never show as overdue)
    if (left > 0 && !dueBy) throw new ValidationError("Pick the date the rest should be paid by.");
    await db.query("UPDATE gym_members SET due_amount = ?, due_by = ? WHERE id = ? AND gym_id = ?", [left, dueBy, memberId, gymId]);
    // The payment remembers the due date it was paid against (late or on time, for prediction #2)
    await addPayment(db, gymId, userId, { memberId, kind: "due", title: row.full_name, detail: "Due payment", method: body.method, amount: body.amount, dueBy: row.due_by }, body.paidOn ?? today);
  });
  return member(pool, gymId, memberId, today);
}

// Personal training a member paid for
async function personalTraining(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    // The period: the dates picked, else the day after a running PT ends (or today) plus the duration
    const { from, until } = rules.ptPeriod(body, row.pt_until, today);
    await db.query("UPDATE gym_members SET pt_label = ?, pt_from = ?, pt_until = ? WHERE id = ? AND gym_id = ?", [body.package, from, until, memberId, gymId]);
    // The trainer this PT is with (Staff / Admin Login's trainers): only one of this branch's;
    // null takes the trainer off; left out, the member keeps the one they have
    if (body.trainerId !== undefined) {
      if (body.trainerId !== null) {
        const [[trainer]] = await db.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND user_id = ? AND kind = 'trainer'", [gymId, body.trainerId]);
        if (!trainer) throw new ValidationError("Pick one of this branch's trainers.");
      }
      await db.query("UPDATE gym_members SET pt_trainer_id = ? WHERE id = ? AND gym_id = ?", [body.trainerId, memberId, gymId]);
    }
    await addPayment(db, gymId, userId, { memberId, kind: "pt", title: row.full_name, detail: ptDetail(body, from, until), method: body.method, amount: body.amount }, today);
  });
  return member(pool, gymId, memberId, today);
}

// A service sold; like a product, it isn't tied to a member
async function service(pool, gymId, userId, body, today) {
  const id = await addPayment(pool, gymId, userId, { kind: "service", title: body.item, detail: "Service", method: body.method, amount: body.amount }, today);
  const [[row]] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE id = ? AND gym_id = ?`, [id, gymId]);
  return { payment: paymentOf(row) };
}

async function sale(pool, gymId, userId, body, today) {
  const id = await addPayment(pool, gymId, userId, { kind: "sale", title: body.item, detail: body.detail, method: body.method, amount: body.amount }, today);
  const [[row]] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE id = ? AND gym_id = ?`, [id, gymId]);
  return { payment: paymentOf(row) };
}

// A product sold or a service added to a member (their ⋯ › Sell Product / Add Service), in one
// transaction: the member and the catalogue item are locked; the price comes from the catalogue;
// a counted product must have enough in stock and is taken out of it; what isn't collected now is
// added to what the member owes. The payment is the amount collected, on the payment date.
async function sellToMember(pool, gymId, userId, memberId, kind, body, today) {
  const product = kind === "product";
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    const [[item]] = await db.query(`SELECT id, name, price, stock FROM gym_catalog_items WHERE id = ? AND gym_id = ? AND kind = ?${await activeOnly(db)} FOR UPDATE`, [body.itemId, gymId, kind]);
    if (!item) throw new NotFoundError(`That ${product ? "product" : "service"} isn't in your catalogue.`);
    if (product && item.stock !== null && item.stock < body.quantity) {
      throw new ConflictError(item.stock === 0 ? `${item.name} is out of stock.` : `Only ${item.stock} of ${item.name} left in stock.`);
    }
    const total = item.price * body.quantity;
    if (total > rules.limits.amount) throw new ValidationError("That comes to more than ₹10,00,000. Sell fewer at a time.");
    if (body.discount >= total) throw new ValidationError("The discount must be less than the amount.");
    const payable = total - body.discount;
    if (body.paid > payable) throw new ValidationError("The amount collected can't be more than the amount payable.");
    const due = payable - body.paid;
    if (due > 0 && !body.dueBy) throw new ValidationError("Pick the date the rest should be paid by.");
    const owed = row.due_amount + due;
    if (owed > rules.limits.amount) throw new ValidationError("That would make the due amount more than ₹10,00,000.");
    if (product && item.stock !== null) await db.query("UPDATE gym_catalog_items SET stock = stock - ? WHERE id = ? AND gym_id = ?", [body.quantity, item.id, gymId]);
    if (due > 0) await db.query("UPDATE gym_members SET due_amount = ?, due_by = ? WHERE id = ? AND gym_id = ?", [owed, body.dueBy, memberId, gymId]);
    const detail = product && body.quantity > 1 ? `${item.name} × ${body.quantity}` : item.name;
    await addPayment(db, gymId, userId, { memberId, kind: product ? "sale" : "service", title: row.full_name, detail: detail.slice(0, 80), method: body.method, amount: body.paid }, body.paidOn);
  });
  return member(pool, gymId, memberId, today);
}

async function editMember(pool, gymId, memberId, body, today) {
  await memberRow(pool, gymId, memberId, today);
  const sets = [];
  const params = [];
  if (body.name !== undefined) { sets.push("full_name = ?"); params.push(body.name); }
  if (body.phone !== undefined) { sets.push("phone = ?"); params.push(body.phone); }
  if (body.dob !== undefined) { sets.push("dob = ?"); params.push(body.dob); }
  if (body.gender !== undefined) { sets.push("gender = ?"); params.push(body.gender); }
  // The optional details: column names only from this list
  for (const [key, column] of [["email", "email"], ["heightCm", "height_cm"], ["weightKg", "weight_kg"], ["address", "address"], ["notes", "notes"]]) {
    if (body[key] !== undefined) { sets.push(`${column} = ?`); params.push(body[key]); }
  }
  try {
    await pool.query(`UPDATE gym_members SET ${sets.join(", ")} WHERE id = ? AND gym_id = ?`, [...params, memberId, gymId]);
  } catch (error) {
    if (duplicatePhone(error)) throw new ConflictError(SAME_PHONE);
    throw error;
  }
  return member(pool, gymId, memberId, today);
}

// Enquiries: people who asked about joining, followed up until they join (Convert to member) or
// say no. Open = new or follow-up; Today / Overdue = open ones whose call-back day is today / past.
const ENQUIRY_LIST_LIMIT = 200;
const ENQUIRY_COLUMNS = `e.id, e.full_name, e.phone, e.note, e.status, ${DAY("e.follow_up_on")} AS follow_up_on, e.interest, e.source,
  e.member_id, m.member_code, ${DAY("e.enquired_on")} AS enquired_on`;
const OPEN = "e.status IN ('new', 'follow_up')";
const ENQUIRY_VIEW_SQL = {
  today: `${OPEN} AND e.follow_up_on = ?`,
  overdue: `${OPEN} AND e.follow_up_on < ?`,
  open: OPEN,
  joined: "e.status = 'joined'",
  lost: "e.status = 'lost'",
  all: "1 = 1",
};
// Who referred them (migration 2026-12-09): the number, and the branch's member with that number
// when there is one (read live: a name changed later shows the new name). Before the migration the
// enquiries are read without it (selectEnquiries), so the lists keep working.
const REFERRER_COLUMNS = "e.referred_by_phone, r.id AS referrer_id, r.full_name AS referrer_name, r.member_code AS referrer_code";
const REFERRER_JOIN = "LEFT JOIN gym_members r ON r.gym_id = e.gym_id AND r.phone = e.referred_by_phone";
// The plan a Gym Hub join request picked (migration 2026-12-19), once the column exists (checked
// at most once a minute until it does)
let planLabelColumn = { has: false, at: 0 };
async function hasEnquiryPlan(db) {
  if (planLabelColumn.has || Date.now() - planLabelColumn.at < 60000) return planLabelColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'plan_label'");
  planLabelColumn = { has: Number(row.n) > 0, at: Date.now() };
  return planLabelColumn.has;
}
async function selectEnquiries(db, tail, params) {
  const columns = (await hasEnquiryPlan(db)) ? `${ENQUIRY_COLUMNS}, e.plan_label` : ENQUIRY_COLUMNS;
  try {
    const [rows] = await db.query(`SELECT ${columns}, ${REFERRER_COLUMNS} FROM gym_enquiries e LEFT JOIN gym_members m ON m.id = e.member_id ${REFERRER_JOIN} ${tail}`, params);
    return rows;
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR" || !String(error.sqlMessage ?? "").includes("referred_by_phone")) throw error;
    const [rows] = await db.query(`SELECT ${columns} FROM gym_enquiries e LEFT JOIN gym_members m ON m.id = e.member_id ${tail}`, params);
    return rows;
  }
}
const referrerOf = (r) =>
  r.referred_by_phone ? { phone: toE164(r.referred_by_phone), member: r.referrer_id ? { id: r.referrer_id, name: r.referrer_name, code: r.referrer_code } : null } : null;

// contacts: every contact attempt, oldest first; lead: the conversion score (null once closed)
const enquiryOf = (r, contacts = [], today = rules.todayInIndia()) => ({
  id: r.id,
  name: r.full_name,
  phone: toE164(r.phone),
  note: r.note,
  status: r.status,
  followUpOn: r.follow_up_on,
  interest: r.interest,
  source: r.source,
  // A Gym Hub join request's plan ("Gold · 3 Months · ₹4,500"), null otherwise
  planLabel: r.plan_label ?? null,
  referredBy: referrerOf(r),
  member: r.member_id ? { id: r.member_id, code: r.member_code } : null,
  enquiredOn: r.enquired_on,
  contacts: contacts.map((c) => ({ id: c.id, kind: c.kind, outcome: c.outcome, note: c.note ?? null, on: c.contacted_on })),
  lead: predictionRules.enquiryScore({ today, status: r.status, enquiredOn: r.enquired_on, source: r.source, interest: r.interest, contacts: contacts.map((c) => ({ kind: c.kind, outcome: c.outcome, contactedOn: c.contacted_on })) }),
});

// The contact attempts of these enquiries, grouped by enquiry, oldest first. Before migration
// 2026-11-30-gym-enquiry-contacts.sql has run there are none (the list still works; logging one
// answers 503 through the route's handler); before 2026-12-18-enquiry-contact-notes.sql they are
// read without their notes.
async function contactsOf(db, gymId, enquiryIds) {
  const grouped = new Map(enquiryIds.map((id) => [id, []]));
  if (enquiryIds.length === 0) return grouped;
  const read = (note) =>
    db.query(`SELECT id, enquiry_id, kind, outcome${note ? ", note" : ""}, ${DAY("contacted_on")} AS contacted_on FROM gym_enquiry_contacts WHERE gym_id = ? AND enquiry_id IN (?) ORDER BY contacted_on, id`, [gymId, enquiryIds]);
  try {
    let rows;
    try {
      [rows] = await read(true);
    } catch (error) {
      if (error?.code !== "ER_BAD_FIELD_ERROR" || !String(error.sqlMessage ?? "").includes("'note'")) throw error;
      [rows] = await read(false);
    }
    for (const row of rows) grouped.get(row.enquiry_id)?.push(row);
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  return grouped;
}

async function enquiry(db, gymId, enquiryId, today = rules.todayInIndia()) {
  const [row] = await selectEnquiries(db, "WHERE e.id = ? AND e.gym_id = ?", [enquiryId, gymId]);
  if (!row) throw new NotFoundError("That enquiry doesn't exist.");
  return enquiryOf(row, (await contactsOf(db, gymId, [row.id])).get(row.id), today);
}

// POST /api/gym/enquiries/:id/contacts: a contact attempt, dated today, with what they said and
// the next follow-up date when given (a new enquiry then moves to follow-up), in one transaction;
// answers the enquiry with its new score. The note's column is written only with a note, so a
// plain log works before its migration.
async function addContact(pool, gymId, userId, enquiryId, { kind, outcome, note, followUpOn }, today) {
  const current = await enquiry(pool, gymId, enquiryId, today);
  if (followUpOn && !["new", "follow_up"].includes(current.status)) throw new ValidationError("This enquiry is closed, so it has no follow-up date to move.");
  await inTransaction(pool, async (db) => {
    const noted = note ? { column: ", note", mark: ", ?", values: [note] } : { column: "", mark: "", values: [] };
    await db.query(
      `INSERT INTO gym_enquiry_contacts (gym_id, enquiry_id, kind, outcome${noted.column}, contacted_on, created_by) VALUES (?, ?, ?, ?${noted.mark}, ?, ?)`,
      [gymId, enquiryId, kind, outcome, ...noted.values, today, userId],
    );
    if (followUpOn) {
      await db.query("UPDATE gym_enquiries SET follow_up_on = ?, status = IF(status = 'new', 'follow_up', status) WHERE id = ? AND gym_id = ?", [followUpOn, enquiryId, gymId]);
    }
  });
  return { enquiry: await enquiry(pool, gymId, enquiryId, today) };
}

async function addEnquiry(pool, gymId, userId, body, today) {
  // The referrer's column is written only for a referral, so other enquiries save before its migration
  const referral = body.referredBy ? { columns: ", referred_by_phone", marks: ", ?", values: [body.referredBy] } : { columns: "", marks: "", values: [] };
  const [result] = await pool.query(
    `INSERT INTO gym_enquiries (gym_id, full_name, phone, note, status, follow_up_on, interest, source, enquired_on, created_by${referral.columns})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${referral.marks})`,
    [gymId, body.name, body.phone, body.note, body.followUpOn ? "follow_up" : "new", body.followUpOn, body.interest, body.source, today, userId, ...referral.values],
  );
  return { enquiry: await enquiry(pool, gymId, result.insertId) };
}

// One list (view) with search, and how many are in each list
async function enquiries(pool, gymId, { view, search }, today) {
  const params = [gymId];
  let where = `WHERE e.gym_id = ? AND ${ENQUIRY_VIEW_SQL[view]}`;
  if (view === "today" || view === "overdue") params.push(today);
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = search.replace(/[\s+-]/g, "");
    if (/^\d{3,12}$/.test(digits)) {
      const local = /^\s*\+91/.test(search) || (digits.length === 12 && digits.startsWith("91")) ? digits.slice(2) : digits;
      where += " AND (e.full_name LIKE ? OR e.phone LIKE ?)";
      params.push(like, `%${local.slice(-10)}%`);
    } else {
      where += " AND e.full_name LIKE ?";
      params.push(like);
    }
  }
  // Due lists: the longest-waiting call-back first; the rest: newest enquiry first
  const order = view === "today" || view === "overdue" ? "e.follow_up_on, e.id" : "e.id DESC";
  const rows = await selectEnquiries(pool, `${where} ORDER BY ${order} LIMIT ?`, [...params, ENQUIRY_LIST_LIMIT]);
  const contacts = await contactsOf(pool, gymId, rows.map((r) => r.id));
  const list = rows.map((r) => enquiryOf(r, contacts.get(r.id), today));
  // Open: the hottest first (the conversion score), newest among equals
  if (view === "open") list.sort((a, b) => (b.lead?.score ?? 0) - (a.lead?.score ?? 0) || b.id - a.id);
  const [[counts]] = await pool.query(
    `SELECT
       COALESCE(SUM(${OPEN} AND e.follow_up_on = ?), 0) AS today,
       COALESCE(SUM(${OPEN} AND e.follow_up_on < ?), 0) AS overdue,
       COALESCE(SUM(${OPEN}), 0) AS open,
       COALESCE(SUM(e.status = 'joined'), 0) AS joined,
       COALESCE(SUM(e.status = 'lost'), 0) AS lost,
       COUNT(*) AS \`all\`
     FROM gym_enquiries e WHERE e.gym_id = ?`,
    [today, today, gymId],
  );
  return {
    today,
    enquiries: list,
    counts: Object.fromEntries(rules.ENQUIRY_VIEWS.map((v) => [v, Number(counts[v])])),
  };
}

// Changes an enquiry of this gym. Joined links the member they became, who must be this gym's.
// A follow-up date on a new enquiry moves it to follow-up.
async function editEnquiry(pool, gymId, enquiryId, body) {
  const current = await enquiry(pool, gymId, enquiryId);
  if (body.memberId !== undefined) {
    const [[member]] = await pool.query("SELECT id FROM gym_members WHERE id = ? AND gym_id = ?", [body.memberId, gymId]);
    if (!member) throw new NotFoundError("That member isn't at this branch.");
  }
  // A referral needs who referred them; a change to the source or the referrer is checked against
  // what the enquiry ends up with (an older referral saved without a number can still be edited
  // otherwise). Another source clears the referrer.
  // Only the app sets "justFit app": staff can keep it on such an enquiry, never choose it
  if (body.source === "app" && current.source !== "app") throw new ValidationError("Pick how they found the gym: walk-in, call, WhatsApp, Instagram, referral or other.");
  const finalSource = body.source !== undefined ? body.source : current.source;
  const currentReferrer = current.referredBy ? current.referredBy.phone.replace(/^\+91/, "") : null;
  if (body.source !== undefined || body.referredBy !== undefined) {
    const referredBy = finalSource === "referral" ? (body.referredBy !== undefined ? body.referredBy : currentReferrer) : null;
    const problem = rules.referrerProblem({ source: finalSource, referredBy, phone: body.phone !== undefined ? body.phone : current.phone?.replace(/^\+91/, "") ?? null });
    if (problem) throw new ValidationError(problem);
    body = { ...body, referredBy };
  }
  // The referrer's column is written only when it changes, so other edits work before its migration
  if (body.referredBy !== undefined && body.referredBy === currentReferrer) {
    const { referredBy: _unchanged, ...rest } = body;
    body = rest;
  }
  const columns = { name: "full_name", phone: "phone", note: "note", interest: "interest", source: "source", followUpOn: "follow_up_on", status: "status", memberId: "member_id", referredBy: "referred_by_phone" };
  const fields = { ...body };
  if (fields.followUpOn && fields.status === undefined && current.status === "new") fields.status = "follow_up";
  // Moved off joined: no longer linked to a member
  if (fields.status !== undefined && fields.status !== "joined") fields.memberId = null;
  const keys = Object.keys(fields).filter((k) => Object.hasOwn(columns, k));
  await pool.query(
    `UPDATE gym_enquiries SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ? AND gym_id = ?`,
    [...keys.map((k) => fields[k]), enquiryId, gymId],
  );
  return { enquiry: await enquiry(pool, gymId, enquiryId) };
}

// The gym admin changes their branch's name or place, in one transaction. The change is written
// to the admin audit log, so the justFit team can see who changed it.
async function updateDetails(pool, gym, userId, fields) {
  await inTransaction(pool, async (db) => {
    const keys = Object.keys(fields);
    const columns = { branch: "name", area: "area", city: "city" };
    await db.query(`UPDATE gyms SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => fields[k]), gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin edited ${gym.brand}’s ${fields.branch ?? gym.branch} branch`);
  });
  return { gym: gymInfo(await staffGym(pool, userId)) };
}

// Every payment, newest first, a page at a time
async function payments(pool, gymId, { kind, before, day }) {
  const params = [gymId];
  let where = "WHERE gym_id = ?";
  if (kind) { where += " AND kind = ?"; params.push(kind); }
  if (day) { where += " AND paid_on = ?"; params.push(day); }
  if (before) { where += " AND id < ?"; params.push(before); }
  const [rows] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments ${where} ORDER BY id DESC LIMIT ?`, [...params, rules.limits.page + 1]);
  const page = rows.slice(0, rules.limits.page);
  return { payments: page.map(paymentOf), nextBefore: rows.length > rules.limits.page ? page[page.length - 1].id : null };
}

// Wallet: today's and this month's money by method and by type, and what members still owe
async function wallet(pool, gymId, today) {
  const monthStart = `${today.slice(0, 8)}01`;
  const sums = async (from) => {
    const [[row]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN method = 'online' THEN amount END), 0) AS online,
         COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0) AS cash,
         COALESCE(SUM(CASE WHEN kind = 'admission' THEN amount END), 0) AS admission,
         COALESCE(SUM(CASE WHEN kind = 'renewal' THEN amount END), 0) AS renewal,
         COALESCE(SUM(CASE WHEN kind = 'due' THEN amount END), 0) AS due,
         COALESCE(SUM(CASE WHEN kind = 'pt' THEN amount END), 0) AS pt,
         COALESCE(SUM(CASE WHEN kind = 'service' THEN amount END), 0) AS service,
         COALESCE(SUM(CASE WHEN kind = 'sale' THEN amount END), 0) AS sale
       FROM gym_payments WHERE gym_id = ? AND paid_on BETWEEN ? AND ?`,
      [gymId, from, today],
    );
    const n = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
    return { online: n.online, cash: n.cash, total: n.online + n.cash, byKind: { admission: n.admission, renewal: n.renewal, due: n.due, pt: n.pt, service: n.service, sale: n.sale } };
  };
  const [[owed]] = await pool.query("SELECT COALESCE(SUM(due_amount), 0) AS total, COUNT(NULLIF(due_amount, 0)) AS members FROM gym_members WHERE gym_id = ?", [gymId]);
  return { today: await sums(today), month: await sums(monthStart), due: { total: Number(owed.total), members: owed.members } };
}

// ---- Plans / Catalogue: the branch's price list ------------------------------------------

// imageUrl: the item's optional picture (gym/catalogImages.js), read with the session; ?v= changes with the file
// details: what a plan or PT package includes (null before migration 2026-12-17); benefits,
// bestValue, status, sortOrder: Gym Profile phase 2 (migration 2026-12-24; active and no
// benefits before it)
const itemOf = (r) => ({
  id: r.id, kind: r.kind, name: r.name, duration: r.duration ?? null, unit: r.duration_unit ?? null, price: r.price, stock: r.stock ?? null, details: r.details ?? null,
  benefits: readBenefits(r.benefits), bestValue: Number(r.best_value ?? 0) === 1, status: r.status ?? "active", sortOrder: Number(r.sort_order ?? 0),
  imageUrl: r.image_key ? `/api/gym/catalog/${r.id}/image?v=${r.image_key.slice(0, 8)}` : null,
});
function readBenefits(stored) {
  try {
    return rules.catalogBenefits((typeof stored === "string" ? JSON.parse(stored) : stored) ?? []);
  } catch {
    return [];
  }
}
// The gym's own order first (0, never ordered, after), then the usual one
const KIND_ORDER = "FIELD(kind, 'plan', 'pt', 'service', 'product'), duration_unit = 'months', IF(duration_unit = 'months', duration * 30, duration), price, name, id";
const ORDERED = `FIELD(kind, 'plan', 'pt', 'service', 'product'), sort_order = 0, sort_order, ${KIND_ORDER}`;

// Whether gym_catalog_items has `details` yet (migration 2026-12-17), checked at most once a minute
// until it does, so the catalogue keeps working before the migration
let detailsColumn = { has: false, at: 0 };
async function hasCatalogDetails(db) {
  if (detailsColumn.has || Date.now() - detailsColumn.at < 60000) return detailsColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'details'");
  detailsColumn = { has: Number(row.n) > 0, at: Date.now() };
  return detailsColumn.has;
}
// Whether it has benefits, best_value, sort_order and status yet (migration 2026-12-24), the same way
let optionsColumn = { has: false, at: 0 };
async function hasPlanOptions(db) {
  if (optionsColumn.has || Date.now() - optionsColumn.at < 60000) return optionsColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_catalog_items' AND COLUMN_NAME = 'status'");
  optionsColumn = { has: Number(row.n) > 0, at: Date.now() };
  return optionsColumn.has;
}
// " AND status = 'active'" once the column exists: what new sales, members and join requests may use
const activeOnly = async (db, alias = "") => ((await hasPlanOptions(db)) ? ` AND ${alias}status = 'active'` : "");

async function catalog(pool, gymId) {
  const [details, options] = await Promise.all([hasCatalogDetails(pool), hasPlanOptions(pool)]);
  const [rows] = await pool.query(
    `SELECT id, kind, name, duration, duration_unit, price, stock, image_key${details ? ", details" : ""}${options ? ", benefits, best_value, sort_order, status" : ""}
     FROM gym_catalog_items WHERE gym_id = ? ORDER BY ${options ? ORDERED : KIND_ORDER}`,
    [gymId],
  );
  return { items: rows.map(itemOf) };
}

const OPTION_FIELDS = ["benefits", "bestValue", "status"];
const needsOptions = (item) => OPTION_FIELDS.some((k) => item[k] !== undefined);
// A plan marked Best value unmarks the branch's other plans; one archived or switched off loses the mark
async function settleBestValue(db, gymId, itemId, fields) {
  if (fields.bestValue === true) await db.query("UPDATE gym_catalog_items SET best_value = 0 WHERE gym_id = ? AND kind = 'plan' AND id <> ?", [gymId, itemId]);
  if (fields.status && fields.status !== "active") await db.query("UPDATE gym_catalog_items SET best_value = 0 WHERE id = ? AND gym_id = ?", [itemId, gymId]);
}

async function addItem(pool, gymId, userId, item) {
  if (needsOptions(item) && !(await hasPlanOptions(pool))) throw Object.assign(new Error("plan options missing"), { code: "ER_BAD_FIELD_ERROR", sqlMessage: "Unknown column 'status'" });
  const withDetails = item.details !== undefined;
  const withOptions = await hasPlanOptions(pool);
  await inTransaction(pool, async (db) => {
    // The branch locked: the item limit and the next place in the order hold under two saves at once
    await db.query("SELECT id FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_catalog_items WHERE gym_id = ?", [gymId]);
    if (n >= rules.limits.catalog) throw new ValidationError(`A branch can keep up to ${rules.limits.catalog} items. Delete one first.`);
    if (item.bestValue && item.status && item.status !== "active") throw new ValidationError("Only an active plan can be the best value.");
    const columns = ["gym_id", "kind", "name", "duration", "duration_unit", "price", "stock", "created_by"];
    const values = [gymId, item.kind, item.name, item.duration ?? null, item.unit ?? null, item.price, item.stock ?? null, userId];
    if (withDetails) columns.push("details"), values.push(item.details);
    if (withOptions) {
      const [[{ last }]] = await db.query("SELECT COALESCE(MAX(sort_order), 0) AS last FROM gym_catalog_items WHERE gym_id = ? AND kind = ?", [gymId, item.kind]);
      columns.push("benefits", "best_value", "sort_order", "status");
      values.push(item.benefits ? JSON.stringify(item.benefits) : null, item.bestValue ? 1 : 0, Number(last) > 0 ? Number(last) + 1 : 0, item.status ?? "active");
    }
    const [inserted] = await db.query(`INSERT INTO gym_catalog_items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, values);
    if (withOptions) await settleBestValue(db, gymId, inserted.insertId, item);
  });
  return catalog(pool, gymId);
}

async function editItem(pool, gymId, itemId, fields) {
  if (needsOptions(fields) && !(await hasPlanOptions(pool))) throw Object.assign(new Error("plan options missing"), { code: "ER_BAD_FIELD_ERROR", sqlMessage: "Unknown column 'status'" });
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query(`SELECT kind${(await hasPlanOptions(db)) ? ", status" : ""} FROM gym_catalog_items WHERE id = ? AND gym_id = ? FOR UPDATE`, [itemId, gymId]);
    if (!row) throw new NotFoundError("That item isn't in your catalogue.");
    if (fields.unit !== undefined && !["plan", "pt"].includes(row.kind)) throw new ValidationError("Only plans and PT packages have a duration.");
    if (fields.stock !== undefined && row.kind !== "product") throw new ValidationError("Only products have stock.");
    if (fields.details !== undefined && !["plan", "pt"].includes(row.kind)) throw new ValidationError("Only plans and PT packages have details.");
    if (fields.benefits !== undefined && !["plan", "pt"].includes(row.kind)) throw new ValidationError("Only plans and PT packages have benefits.");
    if (fields.bestValue !== undefined && row.kind !== "plan") throw new ValidationError("Only a membership plan can be the best value.");
    if (fields.bestValue === true && (fields.status ?? row.status ?? "active") !== "active") throw new ValidationError("Only an active plan can be the best value.");
    // Column names only from this list
    const columns = { name: "name", duration: "duration", unit: "duration_unit", price: "price", stock: "stock", details: "details", benefits: "benefits", bestValue: "best_value", status: "status" };
    const value = (k) => (k === "benefits" ? JSON.stringify(fields[k]) : k === "bestValue" ? (fields[k] ? 1 : 0) : fields[k]);
    const keys = Object.keys(fields);
    await db.query(`UPDATE gym_catalog_items SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ? AND gym_id = ?`, [...keys.map(value), itemId, gymId]);
    await settleBestValue(db, gymId, itemId, fields);
  });
  return catalog(pool, gymId);
}

/** PUT /catalog/order { kind, ids }: the order of one kind's items, as the gym wants them shown */
async function orderItems(pool, gymId, body) {
  await inTransaction(pool, async (db) => {
    const kind = typeof body?.kind === "string" ? body.kind : "";
    const [rows] = await db.query("SELECT id FROM gym_catalog_items WHERE gym_id = ? AND kind = ? FOR UPDATE", [gymId, kind]);
    const ids = rules.catalogOrder(body, rows.map((r) => r.id));
    for (const [index, id] of ids.entries()) await db.query("UPDATE gym_catalog_items SET sort_order = ? WHERE id = ? AND gym_id = ?", [index + 1, id, gymId]);
  });
  return catalog(pool, gymId);
}

// Also says which image file the item had (removedImage), for the route to delete after the row is gone
async function deleteItem(pool, gymId, itemId) {
  const removedImage = await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT image_key FROM gym_catalog_items WHERE id = ? AND gym_id = ? FOR UPDATE", [itemId, gymId]);
    if (!row) throw new NotFoundError("That item isn't in your catalogue.");
    await db.query("DELETE FROM gym_catalog_items WHERE id = ? AND gym_id = ?", [itemId, gymId]);
    return row.image_key ?? null;
  });
  return { ...(await catalog(pool, gymId)), removedImage };
}

module.exports = {
  homeTiles,
  saveHomeTiles,
  catalog,
  payment,
  addItem,
  editItem,
  orderItems,
  deleteItem,
  hasPlanOptions,
  activeOnly,
  staffGym,
  gymInfo,
  nextMemberCode,
  branches,
  addBranch,
  switchBranch,
  dashboard,
  members,
  member,
  admit,
  renew,
  collectDue,
  personalTraining,
  service,
  sale,
  sellToMember,
  editMember,
  addEnquiry,
  enquiries,
  editEnquiry,
  addContact,
  payments,
  wallet,
  updateDetails,
  paymentOf,
  memberOf,
  memberSearch,
  inTransaction,
  memberRow,
  PAYMENT_COLUMNS,
  MEMBER_COLUMNS,
  DAY,
};
