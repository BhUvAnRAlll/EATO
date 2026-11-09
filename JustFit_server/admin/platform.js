// Super Admin › the gym platform (Gym Hub ecosystem, section 7): the numbers across every gym
// (registrations by status, members, memberships, staff, attendance, growth and cities), every gym's
// team in one list, suspending and reactivating an account, and moving a branch to a new owner.
// Only justFit admins reach this (requireAdmin). Every write is audited; nothing here is reachable
// by a gym or a member.
const { NotFoundError, ConflictError } = require("../errors");
const { audit } = require("./overview");
const rules = require("./platformRules");
const gymRules = require("../gym/rules");
const rolePresets = require("../gym/rolePresets");
const staffRules = require("../gym/staffRules");
const sessions = require("../auth/sessions");
const gymStatus = require("../gym/gymStatus");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;

async function inTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await work(conn);
    await conn.commit();
    return out;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/** GET /api/admin/portal/gym-analytics?days= */
async function analytics(pool, { days }, today = gymRules.todayInIndia()) {
  const since = gymRules.addDays(today, -days + 1);
  const withStatus = await gymStatus.hasRegistration(pool);
  const [[byStatus], [[people]], [newGyms], [newMembers], [visits], [cities]] = await Promise.all([
    withStatus ? pool.query("SELECT status, COUNT(*) AS n FROM gyms GROUP BY status") : pool.query("SELECT 'approved' AS status, COUNT(*) AS n FROM gyms"),
    pool.query(
      `SELECT (SELECT COUNT(*) FROM gym_brands) AS brands,
         (SELECT COUNT(*) FROM gym_members) AS memberships,
         (SELECT COUNT(*) FROM gym_members WHERE expires_on >= ?) AS active_memberships,
         (SELECT COUNT(*) FROM gym_members WHERE expires_on < ?) AS expired_memberships,
         (SELECT COUNT(DISTINCT phone) FROM gym_members) AS members,
         (SELECT COUNT(DISTINCT user_id) FROM gym_staff) AS staff,
         (SELECT COUNT(*) FROM gym_attendance) AS visits,
         (SELECT COUNT(*) FROM gym_attendance WHERE status = 'inside' AND on_date = ?) AS inside_now,
         (SELECT COUNT(*) FROM gym_attendance WHERE on_date = ?) AS visits_today`,
      [today, today, today, today],
    ),
    pool.query(`SELECT ${DAY("created_at")} AS day, COUNT(*) AS n FROM gyms WHERE created_at >= ? GROUP BY day`, [since]),
    pool.query(`SELECT ${DAY("joined_on")} AS day, COUNT(*) AS n FROM gym_members WHERE joined_on >= ? GROUP BY day`, [since]),
    pool.query(`SELECT ${DAY("on_date")} AS day, COUNT(*) AS n FROM gym_attendance WHERE on_date >= ? GROUP BY day`, [since]),
    pool.query(
      `SELECT g.city, COUNT(DISTINCT g.id) AS gyms, COUNT(m.id) AS memberships
       FROM gyms g LEFT JOIN gym_members m ON m.gym_id = g.id GROUP BY g.city ORDER BY gyms DESC, memberships DESC LIMIT 12`,
    ),
  ]);
  const status = Object.fromEntries(["draft", "submitted", "pending_review", "approved", "rejected", "suspended"].map((s) => [s, 0]));
  for (const r of byStatus) status[r.status] = Number(r.n);
  const n = (v) => Number(v ?? 0);
  return {
    today,
    days,
    gyms: { branches: Object.values(status).reduce((a, b) => a + b, 0), brands: n(people.brands), ...status, pendingApproval: status.submitted + status.pending_review },
    members: n(people.members),
    staff: n(people.staff),
    memberships: { total: n(people.memberships), active: n(people.active_memberships), expired: n(people.expired_memberships) },
    attendance: { total: n(people.visits), today: n(people.visits_today), insideNow: n(people.inside_now) },
    series: {
      newGyms: rules.series(newGyms, today, days, gymRules.addDays),
      newMemberships: rules.series(newMembers, today, days, gymRules.addDays),
      visits: rules.series(visits, today, days, gymRules.addDays),
    },
    cities: cities.map((c) => ({ city: c.city, gyms: n(c.gyms), memberships: n(c.memberships) })),
  };
}

const PAGE = 50;
/** GET /api/admin/portal/gym-staff: every gym's team, with each person's role there */
async function staffDirectory(pool, { role, search, page }) {
  const where = [];
  const params = [];
  if (role !== "all") { where.push("s.kind = ?"); params.push(role); }
  if (search) {
    where.push("(u.full_name LIKE ? OR b.name LIKE ? OR g.name LIKE ?)");
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT s.user_id, s.kind, s.permissions, ${DAY("s.added_at")} AS added_on, u.full_name, u.verified_phone, u.role,
       g.id AS gym_id, g.name AS branch, g.city, b.name AS brand
     FROM gym_staff s JOIN users u ON u.id = s.user_id JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY b.name, g.name, FIELD(s.kind, 'owner', 'staff', 'trainer'), u.full_name LIMIT ? OFFSET ?`,
    [...params, PAGE + 1, (page - 1) * PAGE],
  );
  const suspended = new Set();
  if (rows.length && (await sessions.hasSuspensions(pool))) {
    const [s] = await pool.query("SELECT user_id FROM account_suspensions WHERE user_id IN (?)", [[...new Set(rows.map((r) => r.user_id))]]);
    for (const r of s) suspended.add(r.user_id);
  }
  return {
    page,
    nextPage: rows.length > PAGE ? page + 1 : null,
    staff: rows.slice(0, PAGE).map((r) => {
      const options = r.kind === "staff" ? (r.permissions === null ? null : staffRules.optionsOf(r)) : null;
      const roleId = rolePresets.roleOf(r.kind, options);
      return {
        userId: r.user_id, name: r.full_name?.trim() || null, phone: staffRules.maskPhone(r.verified_phone),
        kind: r.kind, role: roleId, roleLabel: rolePresets.ROLE_LABEL[roleId],
        gym: { id: r.gym_id, name: r.brand, branch: r.branch, city: r.city }, addedOn: r.added_on, suspended: suspended.has(r.user_id),
      };
    }),
  };
}

/** POST /api/admin/portal/users/:userId/suspend: the account's sessions end and sign-in is refused */
async function suspend(pool, adminId, userId, { reason }) {
  await inTransaction(pool, async (db) => {
    const [[target]] = await db.query("SELECT id, role, full_name FROM users WHERE id = ? FOR UPDATE", [userId]);
    const problem = rules.suspendProblem(target, adminId);
    if (problem) throw target ? new ConflictError(problem) : new NotFoundError(problem);
    const [done] = await db.query("INSERT IGNORE INTO account_suspensions (user_id, reason, suspended_by) VALUES (?, ?, ?)", [userId, reason, adminId]);
    if (done.affectedRows === 0) throw new ConflictError("That account is already suspended.");
    await db.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [userId]);
    await audit(db, adminId, "user.suspend", "user", userId, `Suspended ${target.full_name?.trim() || "an account"}: ${reason}`);
  });
  return suspensionOf(pool, userId);
}

/** POST /api/admin/portal/users/:userId/reactivate */
async function reactivate(pool, adminId, userId) {
  await inTransaction(pool, async (db) => {
    const [[target]] = await db.query("SELECT id, full_name FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!target) throw new NotFoundError("That account doesn't exist.");
    const [done] = await db.query("DELETE FROM account_suspensions WHERE user_id = ?", [userId]);
    if (done.affectedRows === 0) throw new ConflictError("That account isn't suspended.");
    await audit(db, adminId, "user.reactivate", "user", userId, `Reactivated ${target.full_name?.trim() || "an account"}`);
  });
  return suspensionOf(pool, userId);
}

/** The account's suspension (null when active), for its page */
async function suspensionOf(pool, userId) {
  if (!(await sessions.hasSuspensions(pool))) return { suspension: null };
  const [[row]] = await pool.query("SELECT reason, suspended_at FROM account_suspensions WHERE user_id = ?", [userId]);
  return { suspension: row ? { reason: row.reason, at: new Date(row.suspended_at).toISOString() } : null };
}

/** The gyms an account belongs to: memberships (by its phone) and team rows, for its page */
async function gymLinksOf(pool, userId) {
  const [[user]] = await pool.query("SELECT verified_phone FROM users WHERE id = ?", [userId]);
  if (!user) throw new NotFoundError("That account doesn't exist.");
  const [[members], [team]] = await Promise.all([
    user.verified_phone
      ? pool.query(`SELECT m.id, m.member_code, ${DAY("m.expires_on")} AS expires_on, g.name AS branch, b.name AS brand FROM gym_members m JOIN gyms g ON g.id = m.gym_id JOIN gym_brands b ON b.id = g.brand_id WHERE m.phone = ? ORDER BY m.expires_on DESC`, [user.verified_phone])
      : [[]],
    pool.query("SELECT s.kind, s.permissions, g.id AS gym_id, g.name AS branch, b.name AS brand FROM gym_staff s JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id WHERE s.user_id = ?", [userId]),
  ]);
  const today = gymRules.todayInIndia();
  return {
    memberships: members.map((m) => ({ id: m.id, code: m.member_code, gym: `${m.brand} ${m.branch}`, expiresOn: m.expires_on, active: m.expires_on >= today })),
    teams: team.map((t) => {
      const roleId = rolePresets.roleOf(t.kind, t.kind === "staff" ? (t.permissions === null ? null : staffRules.optionsOf(t)) : null);
      return { gymId: t.gym_id, gym: `${t.brand} ${t.branch}`, role: roleId, roleLabel: rolePresets.ROLE_LABEL[roleId] };
    }),
    ...(await suspensionOf(pool, userId)),
  };
}

/**
 * POST /api/admin/portal/gyms/:gymId/transfer: the branch gets a new owner (gym admin) by sign-in
 * number; the old owners leave this branch (and become members again when it was their last one).
 * One transaction, audited with the reason.
 */
async function transferOwner(pool, adminId, gymId, { phone, reason }) {
  return inTransaction(pool, async (db) => {
    const [[gym]] = await db.query("SELECT g.id, g.brand_id, g.name AS branch, b.name AS brand FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ? FOR UPDATE", [gymId]);
    if (!gym) throw new NotFoundError("That gym doesn't exist.");
    const [[account]] = await db.query("SELECT id, role, full_name FROM users WHERE verified_phone = ? FOR UPDATE", [phone]);
    const [links] = account ? await db.query("SELECT s.gym_id, s.kind, g.brand_id FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ? FOR UPDATE", [account.id]) : [[]];
    const problem = rules.transferProblem(account, links.map((l) => ({ gymId: l.gym_id, brandId: l.brand_id, kind: l.kind })), gym.brand_id);
    if (problem) throw new ConflictError(problem);
    const [owners] = await db.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND kind = 'owner' FOR UPDATE", [gymId]);
    if (owners.some((o) => o.user_id === account.id)) throw new ConflictError("That account already owns this branch.");
    // The new owner: an existing team row here becomes the owner's; otherwise a new one
    if (links.some((l) => l.gym_id === gymId)) await db.query("UPDATE gym_staff SET kind = 'owner', permissions = NULL WHERE user_id = ? AND gym_id = ?", [account.id, gymId]);
    else await db.query("INSERT INTO gym_staff (user_id, gym_id, kind) VALUES (?, ?, 'owner')", [account.id, gymId]);
    if (account.role !== "gym_admin") await db.query("UPDATE users SET role = 'gym_admin' WHERE id = ?", [account.id]);
    for (const o of owners) {
      await db.query("DELETE FROM gym_staff WHERE user_id = ? AND gym_id = ?", [o.user_id, gymId]);
      const [[{ left }]] = await db.query("SELECT COUNT(*) AS \`left\` FROM gym_staff WHERE user_id = ?", [o.user_id]);
      if (Number(left) === 0) await db.query("UPDATE users SET role = 'user' WHERE id = ? AND role = 'gym_admin'", [o.user_id]);
    }
    await audit(db, adminId, "gym.owner_transfer", "gym", gymId, `Moved “${gym.brand}”, ${gym.branch} branch, to a new owner: ${reason}`);
    return { owners: 1, removed: owners.length };
  });
}

module.exports = { analytics, staffDirectory, suspend, reactivate, suspensionOf, gymLinksOf, transferOwner };
