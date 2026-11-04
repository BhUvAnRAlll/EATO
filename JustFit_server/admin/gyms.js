// Super Admin › Gyms: every gym on justFit with today's numbers, a new gym, one gym in detail
// (money, members, dues, attendance, enquiries, its staff and latest payments) and linking or
// unlinking its gym_admin accounts. Only justFit admins reach this (requireAdmin). Linking never
// changes a role: an account gets gym_admin only through npm run set-role.
const { NotFoundError, ConflictError } = require("../errors");
const { ValidationError } = require("../profile");
const { toE164 } = require("../auth/phone");
const { audit } = require("./overview");
const gymService = require("../gym/service");

const gymOf = (r) => ({ id: r.id, name: r.name, area: r.area, city: r.city, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null });

async function list(pool, today) {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.area, g.city, g.created_at,
       (SELECT COUNT(*) FROM gym_staff s WHERE s.gym_id = g.id) AS staff,
       (SELECT COUNT(*) FROM gym_members m WHERE m.gym_id = g.id) AS members,
       (SELECT COUNT(*) FROM gym_members m WHERE m.gym_id = g.id AND m.expires_on >= ?) AS active,
       (SELECT COALESCE(SUM(p.amount), 0) FROM gym_payments p WHERE p.gym_id = g.id AND p.paid_on = ?) AS revenue_today,
       (SELECT COUNT(*) FROM gym_attendance a WHERE a.gym_id = g.id AND a.on_date = ?) AS attendance_today
     FROM gyms g ORDER BY g.name, g.id`,
    [today, today, today],
  );
  return {
    gyms: rows.map((r) => ({ ...gymOf(r), staff: r.staff, members: r.members, active: r.active, revenueToday: Number(r.revenue_today), attendanceToday: r.attendance_today })),
  };
}

async function gymRow(db, gymId) {
  const [[row]] = await db.query("SELECT id, name, area, city, created_at FROM gyms WHERE id = ?", [gymId]);
  if (!row) throw new NotFoundError("That gym doesn't exist.");
  return row;
}

async function detail(pool, gymId, today) {
  const gym = await gymRow(pool, gymId);
  const monthStart = `${today.slice(0, 8)}01`;
  const [[money]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN paid_on = ? AND method = 'online' THEN amount END), 0) AS today_online,
       COALESCE(SUM(CASE WHEN paid_on = ? AND method = 'cash' THEN amount END), 0) AS today_cash,
       COALESCE(SUM(amount), 0) AS month_total,
       COALESCE(SUM(kind = 'admission'), 0) AS month_admissions,
       COALESCE(SUM(kind = 'renewal'), 0) AS month_renewals
     FROM gym_payments WHERE gym_id = ? AND paid_on BETWEEN ? AND ?`,
    [today, today, gymId, monthStart, today],
  );
  const [[people]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ?) AS members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND expires_on >= ?) AS active,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND due_amount > 0) AS due_members,
       (SELECT COALESCE(SUM(due_amount), 0) FROM gym_members WHERE gym_id = ?) AS due_total,
       (SELECT COUNT(*) FROM gym_attendance WHERE gym_id = ? AND on_date = ?) AS attendance_today,
       (SELECT COUNT(*) FROM gym_enquiries WHERE gym_id = ? AND enquired_on >= ?) AS enquiries_month`,
    [gymId, gymId, today, gymId, gymId, gymId, today, gymId, monthStart],
  );
  const [staff] = await pool.query(
    "SELECT u.id, u.full_name, u.verified_phone FROM gym_staff s JOIN users u ON u.id = s.user_id WHERE s.gym_id = ? ORDER BY s.added_at, u.id",
    [gymId],
  );
  const [recent] = await pool.query(`SELECT ${gymService.PAYMENT_COLUMNS} FROM gym_payments WHERE gym_id = ? ORDER BY id DESC LIMIT 10`, [gymId]);
  const n = Number;
  return {
    gym: gymOf(gym),
    stats: {
      todayOnline: n(money.today_online),
      todayCash: n(money.today_cash),
      monthRevenue: n(money.month_total),
      monthAdmissions: n(money.month_admissions),
      monthRenewals: n(money.month_renewals),
      members: people.members,
      active: people.active,
      dueMembers: people.due_members,
      dueTotal: n(people.due_total),
      attendanceToday: people.attendance_today,
      enquiriesMonth: people.enquiries_month,
    },
    staff: staff.map((s) => ({ id: s.id, name: (s.full_name && s.full_name.trim()) || "Gym admin", phone: toE164(s.verified_phone) })),
    recent: recent.map(gymService.paymentOf),
  };
}

async function create(pool, adminId, fields) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query("INSERT INTO gyms (name, area, city, created_by) VALUES (?, ?, ?, ?)", [fields.name, fields.area, fields.city, adminId]);
    await audit(connection, adminId, "gym.create", "gym", result.insertId, `Created the gym “${fields.name}”, ${fields.area}`);
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function update(pool, adminId, gymId, fields) {
  const before = await gymRow(pool, gymId);
  const columns = { name: "name", area: "area", city: "city" };
  const keys = Object.keys(fields);
  await pool.query(`UPDATE gyms SET ${keys.map((k) => `${columns[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => fields[k]), gymId]);
  await audit(pool, adminId, "gym.edit", "gym", gymId, `Edited the gym “${fields.name ?? before.name}”`);
}

// Links a gym_admin account (found by its sign-in number) to the gym
async function linkStaff(pool, adminId, gymId, phone) {
  const gym = await gymRow(pool, gymId);
  const [[user]] = await pool.query("SELECT id, role FROM users WHERE verified_phone = ?", [phone]);
  if (!user) throw new NotFoundError("No account has signed in with that number yet. Ask them to sign in to justFit once.");
  if (user.role !== "gym_admin") throw new ValidationError("That account isn't a gym admin yet. Give it the gym_admin role first (npm run set-role).");
  const [[current]] = await pool.query("SELECT g.id, g.name FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ?", [user.id]);
  if (current && current.id === gymId) throw new ConflictError("That account already works at this gym.");
  if (current) throw new ConflictError(`That account already works at “${current.name}”. Remove it there first.`);
  await pool.query("INSERT INTO gym_staff (user_id, gym_id) VALUES (?, ?)", [user.id, gymId]);
  await audit(pool, adminId, "gym.staff_add", "gym", gymId, `Added a gym admin to “${gym.name}”`);
}

async function unlinkStaff(pool, adminId, gymId, userId) {
  const gym = await gymRow(pool, gymId);
  const [result] = await pool.query("DELETE FROM gym_staff WHERE user_id = ? AND gym_id = ?", [userId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That account doesn't work at this gym.");
  await audit(pool, adminId, "gym.staff_remove", "gym", gymId, `Removed a gym admin from “${gym.name}”`);
}

// The Overview's gym line: how many gyms, and their takings today (null before the migration)
async function overviewCounts(pool, today) {
  try {
    const [[row]] = await pool.query(
      "SELECT (SELECT COUNT(*) FROM gyms) AS gyms, (SELECT COALESCE(SUM(amount), 0) FROM gym_payments WHERE paid_on = ?) AS revenue_today",
      [today],
    );
    return { gyms: Number(row.gyms), gymRevenueToday: Number(row.revenue_today) };
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return { gyms: null, gymRevenueToday: null };
    throw error;
  }
}

module.exports = { list, detail, create, update, linkStaff, unlinkStaff, overviewCounts };
