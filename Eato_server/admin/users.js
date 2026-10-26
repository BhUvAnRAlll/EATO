// Super Admin › Users: every account, searchable and filtered by kind, and one account in
// detail (posts, reports against them, gyms, and for trainers their profile and verification).
// Only JustFit admins reach this (requireAdmin); nothing here trusts a role sent by the app.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");
const { audit } = require("./overview");

const LIST_LIMIT = 200;
const FILTERS = ["all", "members", "trainers", "owners", "suspended"];

// What kind of account this is, for the list's label and filters: admins and trainers by their
// role, gym owners by owning a gym (active), everyone else a member
const KIND_SQL = `CASE
  WHEN u.role = 'admin' THEN 'admin'
  WHEN u.role = 'trainer' THEN 'trainer'
  WHEN EXISTS (SELECT 1 FROM gym_members gm WHERE gm.user_id = u.id AND gm.role = 'owner' AND gm.status = 'active') THEN 'owner'
  ELSE 'member' END`;

const nameOf = (row) => (row.full_name && row.full_name.trim()) || "JustFit member";

function listQuery(query) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, members, trainers, owners or suspended.");
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
              COALESCE(cp.status = 'suspended', FALSE) AS suspended,
              (u.role = 'trainer' AND tp.user_id IS NOT NULL AND tp.verified_at IS NULL) AS unverified
       FROM users u
       LEFT JOIN community_profiles cp ON cp.user_id = u.id
       LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
       ${where}
     ) t
     ${filter === "all" ? "" : filter === "suspended" ? "WHERE t.suspended" : "WHERE t.kind = ?"}
     ORDER BY t.full_name IS NULL, t.full_name, t.id LIMIT ?`,
    [...params, ...(filter === "all" || filter === "suspended" ? [] : [{ members: "member", trainers: "trainer", owners: "owner" }[filter]]), LIST_LIMIT],
  );
  return rows.map((r) => ({ id: r.id, name: nameOf(r), kind: r.kind, suspended: Boolean(r.suspended), unverified: Boolean(r.unverified) }));
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
  let trainer = null;
  if (user.role === "trainer") {
    const [[tp]] = await pool.query(
      `SELECT tp.title, tp.years_experience, tp.accepting_clients, tp.qualifications, tp.verified_at,
              (SELECT COUNT(*) FROM trainer_connections c WHERE c.trainer_id = tp.user_id AND c.status = 'connected') AS clients
       FROM trainer_profiles tp WHERE tp.user_id = ?`,
      [userId],
    );
    if (tp) {
      const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
      trainer = {
        title: tp.title, yearsExperience: tp.years_experience, acceptingClients: Boolean(tp.accepting_clients),
        activeClients: Number(tp.clients), qualifications: list(tp.qualifications), verified: tp.verified_at !== null,
      };
    }
  }
  return {
    id: user.id,
    name: nameOf(user),
    kind: user.kind,
    suspended: counts.community_status === "suspended",
    counts: { posts: Number(counts.posts), reported: Number(counts.reported), removed: Number(counts.removed) },
    trainer,
    gyms: gyms.map((g) => ({ id: g.id, name: g.name, role: g.role })),
  };
}

function verifiedBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the request as { verified }.");
  const unknown = Object.keys(body).filter((key) => key !== "verified");
  if (unknown.length > 0) throw new ValidationError(`Unexpected field: ${unknown[0]}.`);
  if (typeof body.verified !== "boolean") throw new ValidationError("Verified must be true or false.");
  return body.verified;
}

/** The Verified trainer switch: sets or clears the trainer's verification, and logs it. */
async function setVerified(pool, adminId, userId, verified) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      "SELECT u.full_name, tp.verified_at FROM users u JOIN trainer_profiles tp ON tp.user_id = u.id WHERE u.id = ? AND u.role = 'trainer' FOR UPDATE",
      [userId],
    );
    if (!row) throw new ValidationError("Only a trainer with a profile can be verified.");
    if ((row.verified_at !== null) !== verified) {
      if (verified) await conn.query("UPDATE trainer_profiles SET verified_at = NOW(), verified_by = ? WHERE user_id = ?", [adminId, userId]);
      else await conn.query("UPDATE trainer_profiles SET verified_at = NULL, verified_by = NULL WHERE user_id = ?", [userId]);
      await audit(conn, adminId, verified ? "trainer.verify" : "trainer.unverify", "user", userId, `${verified ? "Verified" : "Removed verification from"} ${nameOf(row)}`);
    }
    await conn.commit();
    return { userId, verified };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { listQuery, listUsers, userDetail, verifiedBody, setVerified, LIST_LIMIT };
