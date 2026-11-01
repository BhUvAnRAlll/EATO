// Super Admin › Users: every account, searchable and filtered by kind, and one account in
// detail (when they joined, meals logged, workouts finished, orders).
// Only justFit admins reach this (requireAdmin); nothing here trusts a role sent by the app.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");

const LIST_LIMIT = 200;
const FILTERS = ["all", "members", "admins"];

// What kind of account this is, for the list's label and filters: admins by their role,
// everyone else a member
const KIND_SQL = "IF(u.role = 'admin', 'admin', 'member')";

const nameOf = (row) => (row.full_name && row.full_name.trim()) || "justFit member";

function listQuery(query) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, members or admins.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > 80) throw new ValidationError("Search for at most 80 characters.");
  return { filter, search };
}

async function listUsers(pool, { filter, search }) {
  const params = [];
  let where = "WHERE 1 = 1";
  if (search) {
    // A search matches a name or an email; LIKE wildcards in the text are matched literally
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where += " AND (u.full_name LIKE ? OR u.email LIKE ?)";
    params.push(like, like);
  }
  if (filter !== "all") {
    where += ` AND ${KIND_SQL} = ?`;
    params.push({ members: "member", admins: "admin" }[filter]);
  }
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, ${KIND_SQL} AS kind FROM users u ${where}
     ORDER BY u.full_name IS NULL, u.full_name, u.id LIMIT ?`,
    [...params, LIST_LIMIT],
  );
  return rows.map((r) => ({ id: r.id, name: nameOf(r), kind: r.kind }));
}

async function userDetail(pool, userId) {
  const [[user]] = await pool.query(`SELECT u.id, u.full_name, u.created_at, ${KIND_SQL} AS kind FROM users u WHERE u.id = ?`, [userId]);
  if (!user) throw new NotFoundError("That account doesn't exist.");
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM macro_meal_logs WHERE user_id = ?) AS meals,
       (SELECT COUNT(*) FROM workout_logs WHERE user_id = ? AND status = 'completed') AS workouts,
       (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS orders`,
    [userId, userId, userId],
  );
  return {
    id: user.id,
    name: nameOf(user),
    kind: user.kind,
    joinedAt: user.created_at ? new Date(user.created_at).toISOString() : null,
    counts: { meals: Number(counts.meals), workouts: Number(counts.workouts), orders: Number(counts.orders) },
  };
}

module.exports = { listQuery, listUsers, userDetail, LIST_LIMIT };
