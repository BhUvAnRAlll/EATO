// Super Admin › Users: every account, searchable and filtered by kind, and one account in
// detail (posts, reports against them, gyms).
// Only justFit admins reach this (requireAdmin); nothing here trusts a role sent by the app.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");

const LIST_LIMIT = 200;
const FILTERS = ["all", "members", "owners", "suspended"];

// What kind of account this is, for the list's label and filters: admins by their role, gym
// owners by owning a gym (active), everyone else a member
const KIND_SQL = `CASE
  WHEN u.role = 'admin' THEN 'admin'
  WHEN EXISTS (SELECT 1 FROM gym_members gm WHERE gm.user_id = u.id AND gm.role = 'owner' AND gm.status = 'active') THEN 'owner'
  ELSE 'member' END`;

const nameOf = (row) => (row.full_name && row.full_name.trim()) || "justFit member";

function listQuery(query) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, members, owners or suspended.");
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
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT u.id, u.full_name, ${KIND_SQL} AS kind,
              COALESCE(cp.status = 'suspended', FALSE) AS suspended
       FROM users u
       LEFT JOIN community_profiles cp ON cp.user_id = u.id
       ${where}
     ) t
     ${filter === "all" ? "" : filter === "suspended" ? "WHERE t.suspended" : "WHERE t.kind = ?"}
     ORDER BY t.full_name IS NULL, t.full_name, t.id LIMIT ?`,
    [...params, ...(filter === "all" || filter === "suspended" ? [] : [{ members: "member", owners: "owner" }[filter]]), LIST_LIMIT],
  );
  return rows.map((r) => ({ id: r.id, name: nameOf(r), kind: r.kind, suspended: Boolean(r.suspended) }));
}

async function userDetail(pool, userId) {
  const [[user]] = await pool.query(`SELECT u.id, u.full_name, u.role, ${KIND_SQL} AS kind FROM users u WHERE u.id = ?`, [userId]);
  if (!user) throw new NotFoundError("That account doesn't exist.");
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM community_posts WHERE user_id = ? AND deleted_at IS NULL) AS posts,
       (SELECT COUNT(*) FROM community_reports r JOIN community_posts p ON p.id = r.post_id WHERE p.user_id = ?) AS reported,
       (SELECT COUNT(DISTINCT p.id) FROM community_posts p JOIN community_reports r ON r.post_id = p.id WHERE p.user_id = ? AND p.deleted_at IS NOT NULL AND r.status = 'reviewed') AS removed,
       (SELECT status FROM community_profiles WHERE user_id = ?) AS community_status`,
    [userId, userId, userId, userId],
  );
  const [gyms] = await pool.query(
    "SELECT g.id, g.name, gm.role FROM gym_members gm JOIN gyms g ON g.id = gm.gym_id WHERE gm.user_id = ? AND gm.status = 'active' ORDER BY g.name",
    [userId],
  );
  return {
    id: user.id,
    name: nameOf(user),
    kind: user.kind,
    suspended: counts.community_status === "suspended",
    counts: { posts: Number(counts.posts), reported: Number(counts.reported), removed: Number(counts.removed) },
    gyms: gyms.map((g) => ({ id: g.id, name: g.name, role: g.role })),
  };
}

module.exports = { listQuery, listUsers, userDetail, LIST_LIMIT };
