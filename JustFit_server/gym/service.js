// The gym admin portal's data: one gym's members, payments, enquiries and check-ins. Every
// function takes the gym id the route worked out from the signed-in staff account (gym_staff),
// never one from the request, and every query is scoped to it, so a gym admin only ever sees and
// changes their own gym. Writes that touch a member lock its row and run in one transaction.
const { NotFoundError, ConflictError } = require("../errors");
const { ValidationError } = require("../profile");
const { toE164 } = require("../auth/phone");
const rules = require("./rules");
const { audit } = require("../admin/overview");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const MEMBER_LIST_LIMIT = 200;

// The branch a staff account is working at (the one they last switched to), or null
async function staffGym(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT g.id, g.name AS branch, g.area, g.city, b.id AS brand_id, b.name AS brand,
       (SELECT COUNT(*) FROM gym_staff x WHERE x.user_id = s.user_id) AS branch_count
     FROM gym_staff s JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id
     WHERE s.user_id = ? ORDER BY s.selected_at IS NULL, s.selected_at DESC, s.added_at, g.id LIMIT 1`,
    [userId],
  );
  return row ?? null;
}

const gymInfo = (gym) => ({ name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city, branchCount: gym.branch_count });

// Every branch the account is linked to, and which one is open
async function branches(pool, gym, userId) {
  const [rows] = await pool.query(
    "SELECT g.id, g.name, g.area, g.city FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ? ORDER BY g.name, g.id",
    [userId],
  );
  return { currentId: gym.id, gym: gym.brand, branches: rows.map((r) => ({ id: r.id, branch: r.name, area: r.area, city: r.city })) };
}

// Opens another of the account's branches; a branch they aren't linked to reads as missing
async function switchBranch(pool, userId, branchId) {
  const [result] = await pool.query("UPDATE gym_staff SET selected_at = NOW(3) WHERE user_id = ? AND gym_id = ?", [userId, branchId]);
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

const memberOf = (r, today) => ({
  id: r.id,
  code: r.member_code,
  gender: r.gender ?? null,
  email: r.email ?? null,
  heightCm: r.height_cm ?? null,
  weightKg: r.weight_kg === null || r.weight_kg === undefined ? null : Number(r.weight_kg),
  address: r.address ?? null,
  notes: r.notes ?? null,
  name: r.full_name,
  phone: toE164(r.phone),
  dob: r.dob ?? null,
  birthdayToday: Boolean(r.dob) && r.dob.slice(5) === today.slice(5),
  planLength: r.plan_days ? { duration: r.plan_days, unit: "days" } : { duration: r.plan_months, unit: "months" },
  joinedOn: r.joined_on,
  expiresOn: r.expires_on,
  due: r.due_amount,
  dueBy: r.due_amount > 0 ? r.due_by ?? null : null,
  // Days left on the plan: 0 on its last day, negative once it has ended
  daysLeft: Math.round((Date.parse(`${r.expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000),
  pt: r.pt_until ? { label: r.pt_label, from: r.pt_from, until: r.pt_until, active: r.pt_until >= today } : null,
  overdue: r.due_amount > 0 && Boolean(r.due_by) && r.due_by < today,
  status: r.expires_on < today ? "expired" : r.expires_on === today ? "expiring" : "active",
  inToday: Boolean(r.in_today),
});
const MEMBER_COLUMNS = `m.id, m.member_code, m.gender, m.email, m.height_cm, m.weight_kg, m.address, m.notes, m.full_name, m.phone, ${DAY("m.dob")} AS dob, m.plan_months, m.plan_days, ${DAY("m.joined_on")} AS joined_on, ${DAY("m.expires_on")} AS expires_on, m.due_amount, ${DAY("m.due_by")} AS due_by, m.pt_label, ${DAY("m.pt_from")} AS pt_from, ${DAY("m.pt_until")} AS pt_until,
  EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date = ?) AS in_today`;

// Home: today's revenue by method, today's counts, what needs attention, the latest payments
async function dashboard(pool, gym, today) {
  const [[money]] = await pool.query(
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
  );
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_enquiries WHERE gym_id = ? AND enquired_on = ?) AS enquiries,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND due_amount > 0) AS due_members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on = ?) AS expiring,
       (SELECT COUNT(*) FROM gym_attendance WHERE gym_id = ? AND on_date = ?) AS attendance,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on BETWEEN ? AND ?) AS expiring_soon,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND DATE_FORMAT(dob, '%m-%d') = ?) AS birthdays`,
    [gym.id, today, gym.id, gym.id, today, gym.id, today, gym.id, rules.addDays(today, 1), rules.addDays(today, 3), gym.id, today.slice(5)],
  );
  const [recent] = await pool.query(`SELECT ${PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? ORDER BY id DESC LIMIT 5`, [gym.id]);
  return {
    gym: gymInfo(gym),
    today,
    revenue: { online: Number(money.online), cash: Number(money.cash) },
    stats: { admission: Number(money.admissions), renewal: Number(money.renewals), enquiry: counts.enquiries, duePaid: Number(money.due_paid), pt: Number(money.pt), product: Number(money.products) },
    alerts: { dueMembers: counts.due_members, expiringToday: counts.expiring, attendance: counts.attendance, expiringSoon: counts.expiring_soon, birthdays: counts.birthdays },
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
      where += " AND (m.full_name LIKE ? OR m.phone LIKE ? OR m.member_code LIKE ?)";
      params.push(like, `%${digits.slice(-10)}%`, `%${digits}`);
    } else {
      where += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)";
      params.push(like, like);
    }
  }
  if (filter === "due") where += " AND m.due_amount > 0";
  if (filter === "overdue") { where += " AND m.due_amount > 0 AND m.due_by < ?"; params.push(today); }
  if (filter === "expiring") { where += " AND m.expires_on = ?"; params.push(today); }
  if (filter === "expiring_soon") { where += " AND m.expires_on BETWEEN ? AND ?"; params.push(rules.addDays(today, 1), rules.addDays(today, 3)); }
  if (filter === "birthday") { where += " AND DATE_FORMAT(m.dob, '%m-%d') = ?"; params.push(today.slice(5)); }
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

// "3 Months", "15 Days"
const planText = ({ duration, unit }) => `${duration} ${unit === "days" ? (duration === 1 ? "Day" : "Days") : duration === 1 ? "Month" : "Months"}`;
// The members row's two length columns: one is set, the other NULL
const planColumns = ({ duration, unit }) => (unit === "days" ? [null, duration] : [duration, null]);

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
      const [result] = await db.query(
        "INSERT INTO gym_members (gym_id, member_code, full_name, phone, dob, gender, email, height_cm, weight_kg, address, notes, plan_months, plan_days, joined_on, expires_on, due_amount, due_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [gymId, code, body.name, body.phone, body.dob, body.gender, body.email, body.heightCm, body.weightKg, body.address, body.notes, ...planColumns(body), body.joinedOn, rules.planEnd(body.joinedOn, body.duration, body.unit), body.due, body.dueBy, userId],
      );
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
    if (due > rules.limits.amount) throw new ValidationError("That would make the amount owed more than ₹10,00,000.");
    // A new amount owed takes the date given; otherwise an earlier one stays
    const dueBy = body.due > 0 ? body.dueBy : due > 0 ? row.due_by : null;
    await db.query("UPDATE gym_members SET plan_months = ?, plan_days = ?, expires_on = ?, due_amount = ?, due_by = ? WHERE id = ? AND gym_id = ?", [...planColumns(body), rules.renewedUntil(row.expires_on, today, body.duration, body.unit), due, dueBy, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "renewal", title: row.full_name, detail: planText(body), method: body.method, amount: body.paid }, today);
  });
  return member(pool, gymId, memberId, today);
}

// Part or all of what a member owes
async function collectDue(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    if (row.due_amount === 0) throw new ValidationError("This member doesn't owe anything.");
    if (body.amount > row.due_amount) throw new ValidationError(`That's more than they owe (₹${row.due_amount.toLocaleString("en-IN")}).`);
    // Paid in full: no date any more; part: the new date if one was given, else the old one
    const left = row.due_amount - body.amount;
    const dueBy = left === 0 ? null : body.dueBy ?? row.due_by;
    await db.query("UPDATE gym_members SET due_amount = ?, due_by = ? WHERE id = ? AND gym_id = ?", [left, dueBy, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "due", title: row.full_name, detail: "Due payment", method: body.method, amount: body.amount }, body.paidOn ?? today);
  });
  return member(pool, gymId, memberId, today);
}

// Personal training a member paid for
async function personalTraining(pool, gymId, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const row = await memberRow(db, gymId, memberId, today, { lock: true });
    // A new PT period starts the day after a running one ends, or today
    const from = row.pt_until && row.pt_until >= today ? rules.addDays(row.pt_until, 1) : today;
    const until = rules.planEnd(from, body.duration, body.unit);
    await db.query("UPDATE gym_members SET pt_label = ?, pt_from = ?, pt_until = ? WHERE id = ? AND gym_id = ?", [body.package, from, until, memberId, gymId]);
    await addPayment(db, gymId, userId, { memberId, kind: "pt", title: row.full_name, detail: `PT · ${body.package}`, method: body.method, amount: body.amount }, today);
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
    const [[item]] = await db.query("SELECT id, name, price, stock FROM gym_catalog_items WHERE id = ? AND gym_id = ? AND kind = ? FOR UPDATE", [body.itemId, gymId, kind]);
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
    if (owed > rules.limits.amount) throw new ValidationError("That would make the amount owed more than ₹10,00,000.");
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

// The gym admin changes their branch's name or place, or their own name, in one transaction.
// A branch change is written to the admin audit log, so the justFit team can see who changed it.
async function updateDetails(pool, gym, userId, fields) {
  const { adminName, ...branchFields } = fields;
  await inTransaction(pool, async (db) => {
    const keys = Object.keys(branchFields);
    if (keys.length > 0) {
      const columns = { branch: "name", area: "area", city: "city" };
      await db.query(`UPDATE gyms SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => branchFields[k]), gym.id]);
      await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin edited ${gym.brand}’s ${branchFields.branch ?? gym.branch} branch`);
    }
    if (adminName !== undefined) await db.query("UPDATE users SET full_name = ? WHERE id = ?", [adminName, userId]);
  });
  const updated = await staffGym(pool, userId);
  const [[user]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [userId]);
  return { gym: gymInfo(updated), adminName: user.full_name ?? null };
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
  return { today: await sums(today), month: await sums(monthStart), owed: { total: Number(owed.total), members: owed.members } };
}

// ---- Plans / Catalogue: the branch's price list ------------------------------------------

const itemOf = (r) => ({ id: r.id, kind: r.kind, name: r.name, duration: r.duration ?? null, unit: r.duration_unit ?? null, price: r.price, stock: r.stock ?? null });
const KIND_ORDER = "FIELD(kind, 'plan', 'pt', 'service', 'product'), duration_unit = 'months', IF(duration_unit = 'months', duration * 30, duration), price, name, id";

async function catalog(pool, gymId) {
  const [rows] = await pool.query(`SELECT id, kind, name, duration, duration_unit, price, stock FROM gym_catalog_items WHERE gym_id = ? ORDER BY ${KIND_ORDER}`, [gymId]);
  return { items: rows.map(itemOf) };
}

async function addItem(pool, gymId, userId, item) {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM gym_catalog_items WHERE gym_id = ?", [gymId]);
  if (n >= rules.limits.catalog) throw new ValidationError(`A branch can keep up to ${rules.limits.catalog} items. Delete one first.`);
  await pool.query("INSERT INTO gym_catalog_items (gym_id, kind, name, duration, duration_unit, price, stock, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [gymId, item.kind, item.name, item.duration ?? null, item.unit ?? null, item.price, item.stock ?? null, userId]);
  return catalog(pool, gymId);
}

async function editItem(pool, gymId, itemId, fields) {
  const [[row]] = await pool.query("SELECT kind FROM gym_catalog_items WHERE id = ? AND gym_id = ?", [itemId, gymId]);
  if (!row) throw new NotFoundError("That item isn't in your catalogue.");
  if (fields.unit !== undefined && !["plan", "pt"].includes(row.kind)) throw new ValidationError("Only plans and PT packages have a duration.");
  if (fields.stock !== undefined && row.kind !== "product") throw new ValidationError("Only products have stock.");
  // Column names only from this list
  const columns = { name: "name", duration: "duration", unit: "duration_unit", price: "price", stock: "stock" };
  const keys = Object.keys(fields);
  await pool.query(`UPDATE gym_catalog_items SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ? AND gym_id = ?`, [...keys.map((k) => fields[k]), itemId, gymId]);
  return catalog(pool, gymId);
}

async function deleteItem(pool, gymId, itemId) {
  const [result] = await pool.query("DELETE FROM gym_catalog_items WHERE id = ? AND gym_id = ?", [itemId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That item isn't in your catalogue.");
  return catalog(pool, gymId);
}

module.exports = {
  catalog,
  addItem,
  editItem,
  deleteItem,
  staffGym,
  gymInfo,
  nextMemberCode,
  branches,
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
  checkIn,
  addEnquiry,
  enquiries,
  payments,
  wallet,
  updateDetails,
  paymentOf,
  PAYMENT_COLUMNS,
  DAY,
};
