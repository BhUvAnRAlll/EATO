// Activity log (2026-11-09, the user's request): every add, edit and delete made in the gym
// portal, by Staff or the gym admin, read by the gym admin on ☰ › Activity. `recorder` sits in the
// gym router after the caller and their branch are known: for a write it reads the record as it
// was (its name and fields, from an allowlisted query scoped to the branch), lets the route run,
// and when the route answers with success it reads the record again and writes one row before the
// answer is sent. Which route is which change is in activityRules.js. Recording never fails a
// request: before the migration (2026-12-14-gym-activity-log.sql), or on any error, the change
// stands and the log skips it (the error is logged without personal data).
const { describeError } = require("../logging");
const rules = require("./activityRules");

// The record behind a route's id, read the same way before and after: [sql, id parser]. Every
// query is scoped to the caller's branch, so a log row never names another gym's record.
const SNAPSHOTS = {
  member: "SELECT id, full_name, member_code, phone, gender, dob, email, height_cm, weight_kg, address, notes, pt_trainer_id, photo_key, plan_name, expires_on FROM gym_members WHERE id = ? AND gym_id = ?",
  pause: "SELECT p.id, m.full_name, m.member_code FROM gym_membership_pauses p JOIN gym_members m ON m.id = p.member_id WHERE p.id = ? AND p.gym_id = ?",
  enquiry: "SELECT id, full_name, phone, note, status, follow_up_on, interest, source, referred_by_phone, member_id FROM gym_enquiries WHERE id = ? AND gym_id = ?",
  catalog: "SELECT id, kind, name, duration, price, stock, image_key FROM gym_catalog_items WHERE id = ? AND gym_id = ?",
  expense: "SELECT id, category, title, paid_to, method, amount, spent_on, note, bill_key FROM gym_expenses WHERE id = ? AND gym_id = ?",
  payment: "SELECT id, title, detail, amount, method FROM gym_payments WHERE id = ? AND gym_id = ?",
  template: "SELECT id, name FROM gym_added_templates WHERE id = ? AND gym_id = ?",
  team: "SELECT u.id, u.full_name, u.verified_phone FROM gym_staff s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.gym_id = ?",
  invite: "SELECT id, phone FROM gym_staff_invites WHERE id = ? AND gym_id = ?",
};
// Numeric ids for every table but the team's (account ids are text)
const numericId = (id) => (/^[0-9]{1,10}$/.test(String(id)) ? Number(id) : null);

async function snapshot(pool, gymId, target, id) {
  if (!target || id === null || id === undefined) return null;
  const key = target === "team" ? (/^[A-Za-z0-9_]{1,64}$/.test(id) ? id : null) : numericId(id);
  if (key === null) return null;
  try {
    const [[row]] = await pool.query(SNAPSHOTS[target], [key, gymId]);
    return row ?? null;
  } catch {
    return null; // a column or table a migration hasn't added yet: the log reads "Something"
  }
}

// The catalogue item a member's sale or service names (its name for the line)
async function itemName(pool, gymId, itemId) {
  const id = numericId(itemId);
  if (id === null) return null;
  try {
    const [[row]] = await pool.query("SELECT name FROM gym_catalog_items WHERE id = ? AND gym_id = ?", [id, gymId]);
    return row?.name ?? null;
  } catch {
    return null;
  }
}

async function write(pool, gym, userId, row, targetId) {
  await pool.query(
    "INSERT INTO gym_activity_log (gym_id, actor_id, actor_kind, action, target_type, target_id, target_label, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [gym.id, userId, gym.kind === "owner" ? "owner" : "staff", row.action, row.type, targetId === null || targetId === undefined ? null : String(targetId).slice(0, 64), row.label, row.detail],
  );
}

// Express middleware for the gym router (after requireGymStaff and requireArea)
function recorder(getPool) {
  return async (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const found = rules.routeOf(req.method, req.path);
    if (!found || !found.entry) return next();
    const { entry, id } = found;
    const pool = getPool(req);
    const gym = req.gym;
    const userId = req.userId;
    const before = await snapshot(pool, gym.id, entry.target, id);
    const send = res.json.bind(res);
    let done = false;
    res.json = (answer) => {
      if (done || res.statusCode < 200 || res.statusCode >= 300) return send(answer);
      done = true;
      (async () => {
        try {
          // The record now (null once deleted): what an edit changed, and a renewal's new end date
          const after = await snapshot(pool, gym.id, entry.target, id);
          const item = req.body && req.body.itemId !== undefined ? await itemName(pool, gym.id, req.body.itemId) : null;
          const ctx = { id, body: req.body ?? {}, answer, before, after, extra: { item } };
          const targetId = id ?? answer?.member?.id ?? answer?.enquiry?.id ?? answer?.expense?.id ?? null;
          await write(pool, gym, userId, rules.rowFor(entry, ctx), targetId);
        } catch (error) {
          if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) console.error("[gym activity] not recorded", describeError(error));
        }
        send(answer);
      })();
      return res;
    };
    next();
  };
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

// ☰ › Activity: one India day of this branch's log, newest first, 50 a page, with who was
// active that day and the counts of each kind. Rows older than a year are deleted first.
async function list(pool, gym, callerId, query) {
  await pool.query("DELETE FROM gym_activity_log WHERE gym_id = ? AND created_at < NOW() - INTERVAL ? DAY", [gym.id, rules.KEEP_DAYS]);
  // The India day as UTC bounds (India is UTC+5:30 all year)
  const start = new Date(Date.parse(`${query.day}T00:00:00+05:30`));
  const end = new Date(start.getTime() + 86400000);
  const where = ["l.gym_id = ?", "l.created_at >= ?", "l.created_at < ?"];
  const params = [gym.id, start, end];
  if (query.person !== "all") {
    where.push("l.actor_id = ?");
    params.push(query.person);
  }
  const [counted] = await pool.query(`SELECT l.action, COUNT(*) AS n FROM gym_activity_log l WHERE ${where.join(" AND ")} GROUP BY l.action`, params);
  if (query.action !== "all") {
    where.push("l.action = ?");
    params.push(query.action);
  }
  const offset = (query.page - 1) * rules.PAGE_SIZE;
  const [rows] = await pool.query(
    `SELECT l.id, l.actor_id, l.actor_kind, l.action, l.target_type, l.target_label, l.detail, l.created_at, u.full_name
       FROM gym_activity_log l LEFT JOIN users u ON u.id = l.actor_id
      WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
    [...params, rules.PAGE_SIZE + 1, offset],
  );
  // Everyone who did something that day (for the person chips), whatever the filters
  const [people] = await pool.query(
    `SELECT l.actor_id, MAX(l.actor_kind) AS actor_kind, MAX(u.full_name) AS full_name, COUNT(*) AS n
       FROM gym_activity_log l LEFT JOIN users u ON u.id = l.actor_id
      WHERE l.gym_id = ? AND l.created_at >= ? AND l.created_at < ? AND l.actor_id IS NOT NULL
      GROUP BY l.actor_id ORDER BY n DESC, l.actor_id`,
    [gym.id, start, end],
  );
  const counts = { all: 0, create: 0, edit: 0, delete: 0 };
  for (const c of counted) {
    counts[c.action] = c.n;
    counts.all += c.n;
  }
  const nameOf = (id, fullName) => (id === callerId ? "You" : (fullName && fullName.trim()) || (id ? "Name not added yet" : "A former team member"));
  return {
    day: query.day,
    counts,
    people: people.map((p) => ({ id: p.actor_id, name: nameOf(p.actor_id, p.full_name), kind: p.actor_kind, you: p.actor_id === callerId })),
    entries: rows.slice(0, rules.PAGE_SIZE).map((r) => ({
      id: Number(r.id),
      at: iso(r.created_at),
      by: { id: r.actor_id, name: nameOf(r.actor_id, r.full_name), kind: r.actor_kind, you: r.actor_id === callerId },
      action: r.action,
      type: r.target_type,
      label: r.target_label,
      detail: r.detail,
    })),
    page: query.page,
    nextPage: rows.length > rules.PAGE_SIZE ? query.page + 1 : null,
  };
}

module.exports = { recorder, list, snapshot };
