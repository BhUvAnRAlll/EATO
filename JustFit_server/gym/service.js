// The gym admin portal's data: one gym's members, payments, enquiries and check-ins. Every
// function takes the gym id the route worked out from the signed-in staff account (gym_staff),
// never one from the request, and every query is scoped to it, so a gym admin only ever sees and
// changes their own gym. Writes that touch a member lock its row and run in one transaction.
const { NotFoundError, ConflictError } = require("../errors");
const { ValidationError } = require("../profile");
const { toE164 } = require("../auth/phone");
const rules = require("./rules");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const MEMBER_LIST_LIMIT = 200;

// The gym a staff account works at, or null
async function staffGym(pool, userId) {
  const [[row]] = await pool.query(
    "SELECT g.id, g.name, g.area, g.city FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ?",
    [userId],
  );
  return row ?? null;
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

const memberOf = (r, today) => ({
  id: r.id,
  name: r.full_name,
  phone: toE164(r.phone),
  planMonths: r.plan_months,
  joinedOn: r.joined_on,
  expiresOn: r.expires_on,
  due: r.due_amount,
  status: r.expires_on < today ? "expired" : r.expires_on === today ? "expiring" : "active",
  inToday: Boolean(r.in_today),
});
const MEMBER_COLUMNS = `m.id, m.full_name, m.phone, m.plan_months, ${DAY("m.joined_on")} AS joined_on, ${DAY("m.expires_on")} AS expires_on, m.due_amount,
  EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date = ?) AS in_today`;

// Home: today's revenue by method, today's counts, what needs attention, the latest payments
async function dashboard(pool, gym, today) {
  const [[money]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN method = 'online' THEN amount END), 0) AS online,
       COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0) AS cash,
       COALESCE(SUM(kind = 'admission'), 0) AS admissions,
       COALESCE(SUM(kind = 'renewal'), 0) AS renewals,
       COALESCE(SUM(kind = 'due'), 0) AS due_paid
     FROM gym_payments WHERE gym_id = ? AND paid_on = ?`,
    [gym.id, today],
  );
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_enquiries WHERE gym_id = ? AND enquired_on = ?) AS enquiries,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND due_amount > 0) AS due_members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on = ?) AS expiring,
       (SELECT COUNT(*) FROM gym_attendance WHERE gym_id = ? AND on_date = ?) AS attendance`,
    [gym.id, today, gym.id, gym.id, today, gym.id, today],
  );
  const [recent] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? ORDER BY id DESC LIMIT 5`, [gym.id]);
  return {
    gym: { name: gym.name, area: gym.area, city: gym.city },
    today,
    revenue: { online: Number(money.online), cash: Number(money.cash) },
    stats: { admission: Number(money.admissions), renewal: Number(money.renewals), enquiry: counts.enquiries, duePaid: Number(money.due_paid) },
    alerts: { dueMembers: counts.due_members, expiringToday: counts.expiring, attendance: counts.attendance },
    recent: recent.map(paymentOf),
  };
}

async function members(pool, gymId, { filter, search }, today) {
  const params = [today, gymId];
  let where = "WHERE m.gym_id = ?";
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = search.replace(/[\s+-]/g, "");
    if (/^\d{3,12}$/.test(digits)) {
      where += " AND (m.full_name LIKE ? OR m.phone LIKE ?)";
      params.push(like, `%${digits.slice(-10)}%`);
    } else {
      where += " AND m.full_name LIKE ?";
      params.push(like);
    }
  }
  if (filter === "due") where += " AND m.due_amount > 0";
  if (filter === "expiring") { where += " AND m.expires_on = ?"; params.push(today); }
  if (filter === "expired") { where += " AND m.expires_on < ?"; params.push(today); }
  if (filter === "in_today") { where += " AND EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date = ?)"; params.push(today); }
  const [rows] = await pool.query(`SELECT ${MEMBER_COLUMNS} FROM gym_members m ${where} ORDER BY m.full_name, m.id LIMIT ?`, [...params, MEMBER_LIST_LIMIT]);
  return { members: rows.map((r) => memberOf(r, today)) };
}

async function memberRow(db, gymId, memberId, today, { lock = false } = {}) {
  const [[row]] = await db.query(`SELECT ${MEMBER_COLUMNS} FROM gym_members m WHERE m.id = ? AND m.gym_id = ?${lock ? " FOR UPDATE" : ""}`, [today, memberId, gymId]);
  if (!row) throw new NotFoundError("That member isn't at your gym.");
  return row;
}

async function member(pool, gymId, memberId, today) {
  const row = await memberRow(pool, gymId, memberId, today);
  const [payments] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? AND member_id = ? ORDER BY id DESC LIMIT 20`, [gymId, memberId]);
  const [[visits]] = await pool.query(
    `SELECT COUNT(*) AS month, ${DAY("MAX(on_date)")} AS last FROM gym_attendance WHERE gym_id = ? AND member_id = ? AND on_date >= ?`,
    [gymId, memberId, `${today.slice(0, 8)}01`],
  );
  return { member: { ...memberOf(row, today), visitsThisMonth: visits.month, lastVisit: visits.last ?? null }, payments: payments.map(paymentOf) };
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

async function addPayment(db, gymId, userId, { memberId = null, kind, title, detail, method, amount }, today) {
  const [result] = await db.query(
    "INSERT INTO gym_payments (gym_id, member_id, kind, title, detail, method, amount, paid_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [gymId, memberId, kind, title, detail, method, amount, today, userId],
  );
  return result.insertId;
}

const planText = (months) => `${months} ${months === 1 ? "Month" : "Months"}`;

// A new member: their plan starts today; what they didn't pay is owed
async function admit(pool, gymId, userId, body, today) {
  try {
    const memberId = await inTransaction(pool, async (db) => {
      const [result] = await db.query(
        "INSERT INTO gym_members (gym_id, full_name, phone, plan_months, joined_on, expires_on, due_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [gymId, body.name, body.phone, body.months, today, rules.planEnd(today, body.months), body.due, userId],
      );
      await addPayment(db, gymId, userId, { memberId: result.insertId, kind: "admission", title: body.name, detail: planText(body.months), method: body.method, amount: body.paid }, today);
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
    if (due > rules.limits.amount) throw new ValidationError("That would make the amount owed more than ₹10,00,000.");
    await db.query("UPDATE gym_members SET plan_months = ?, expires_on = ?, due_amount = ? WHERE id = ? AND gym_id = ?", [body.months, rules.renewedUntil(row.expires_on, today, body.months), due, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "renewal", title: row.full_name, detail: planText(body.months), method: body.method, amount: body.paid }, today);
  });
  return member(pool, gymId, memberId, today);
}

// Part or all of what a member owes
async function collectDue(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    if (row.due_amount === 0) throw new ValidationError("This member doesn't owe anything.");
    if (body.amount > row.due_amount) throw new ValidationError(`That's more than they owe (₹${row.due_amount.toLocaleString("en-IN")}).`);
    await db.query("UPDATE gym_members SET due_amount = due_amount - ? WHERE id = ? AND gym_id = ?", [body.amount, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "due", title: row.full_name, detail: "Due payment", method: body.method, amount: body.amount }, today);
  });
  return member(pool, gymId, memberId, today);
}

async function sale(pool, gymId, userId, body, today) {
  const id = await addPayment(pool, gymId, userId, { kind: "sale", title: body.item, detail: body.detail, method: body.method, amount: body.amount }, today);
  const [[row]] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE id = ? AND gym_id = ?`, [id, gymId]);
  return { payment: paymentOf(row) };
}

async function editMember(pool, gymId, memberId, body, today) {
  await memberRow(pool, gymId, memberId, today);
  const sets = [];
  const params = [];
  if (body.name !== undefined) { sets.push("full_name = ?"); params.push(body.name); }
  if (body.phone !== undefined) { sets.push("phone = ?"); params.push(body.phone); }
  try {
    await pool.query(`UPDATE gym_members SET ${sets.join(", ")} WHERE id = ? AND gym_id = ?`, [...params, memberId, gymId]);
  } catch (error) {
    if (duplicatePhone(error)) throw new ConflictError(SAME_PHONE);
    throw error;
  }
  return member(pool, gymId, memberId, today);
}

// Today's check-in; a second one the same day changes nothing
async function checkIn(pool, gymId, userId, memberId, today) {
  await memberRow(pool, gymId, memberId, today);
  let alreadyIn = false;
  try {
    await pool.query("INSERT INTO gym_attendance (gym_id, member_id, on_date, created_by) VALUES (?, ?, ?, ?)", [gymId, memberId, today, userId]);
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    alreadyIn = true;
  }
  return { ...(await member(pool, gymId, memberId, today)), alreadyIn };
}

async function addEnquiry(pool, gymId, userId, body, today) {
  const [result] = await pool.query(
    "INSERT INTO gym_enquiries (gym_id, full_name, phone, note, enquired_on, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    [gymId, body.name, body.phone, body.note, today, userId],
  );
  return { enquiry: { id: result.insertId, name: body.name, phone: toE164(body.phone), note: body.note, enquiredOn: today } };
}

async function enquiries(pool, gymId) {
  const [rows] = await pool.query(
    `SELECT id, full_name, phone, note, ${DAY("enquired_on")} AS enquired_on FROM gym_enquiries WHERE gym_id = ? ORDER BY id DESC LIMIT 100`,
    [gymId],
  );
  return { enquiries: rows.map((r) => ({ id: r.id, name: r.full_name, phone: toE164(r.phone), note: r.note, enquiredOn: r.enquired_on })) };
}

// Every payment, newest first, a page at a time
async function payments(pool, gymId, { kind, before, today: todayOnly }, today) {
  const params = [gymId];
  let where = "WHERE gym_id = ?";
  if (kind) { where += " AND kind = ?"; params.push(kind); }
  if (todayOnly) { where += " AND paid_on = ?"; params.push(today); }
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
         COALESCE(SUM(CASE WHEN kind = 'sale' THEN amount END), 0) AS sale
       FROM gym_payments WHERE gym_id = ? AND paid_on BETWEEN ? AND ?`,
      [gymId, from, today],
    );
    const n = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
    return { online: n.online, cash: n.cash, total: n.online + n.cash, byKind: { admission: n.admission, renewal: n.renewal, due: n.due, sale: n.sale } };
  };
  const [[owed]] = await pool.query("SELECT COALESCE(SUM(due_amount), 0) AS total, COUNT(NULLIF(due_amount, 0)) AS members FROM gym_members WHERE gym_id = ?", [gymId]);
  return { today: await sums(today), month: await sums(monthStart), owed: { total: Number(owed.total), members: owed.members } };
}

module.exports = {
  staffGym,
  dashboard,
  members,
  member,
  admit,
  renew,
  collectDue,
  sale,
  editMember,
  checkIn,
  addEnquiry,
  enquiries,
  payments,
  wallet,
  paymentOf,
  PAYMENT_COLUMNS,
  DAY,
};
