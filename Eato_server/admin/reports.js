// Super Admin › Reports: members' reports grouped by what they're about (a post, a comment or a
// story), with every reason and who gave it. Open groups can be removed (the content is
// deleted) or dismissed (it stays); either closes all of the group's reports at once and is
// logged. Gym posts' reports also reach the gym's Review tab; whichever side acts first
// closes them for both. Only JustFit admins reach this (requireAdmin).
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");
const { id: uuid, requireObject, rejectUnknownKeys } = require("../community/validate");
const { audit } = require("./overview");

const ROW_LIMIT = 500; // report rows read per list (grouped below)
const GROUP_LIMIT = 100;
const TYPES = ["post", "comment", "story"];
const ACTIONS = ["remove", "dismiss"];

const nameOf = (name) => (name && name.trim()) || "JustFit member";
const iso = (value) => (value ? new Date(value).toISOString() : null);

function listQuery(query) {
  const status = query.status === undefined || query.status === "" ? "open" : query.status;
  if (status !== "open" && status !== "resolved") throw new ValidationError("Show open or resolved reports.");
  return status;
}

// The reports, newest groups first. Open: every open report. Resolved: reports whose content
// has no open report left.
async function listGroups(pool, status) {
  const target = "COALESCE(r.post_id, r.comment_id, r.story_id)";
  const where = status === "open"
    ? "r.status = 'open'"
    : `r.status <> 'open' AND NOT EXISTS (SELECT 1 FROM community_reports o WHERE o.status = 'open' AND COALESCE(o.post_id, o.comment_id, o.story_id) = ${target})`;
  const [rows] = await pool.query(
    `SELECT r.id, r.post_id, r.comment_id, r.story_id, r.reason, r.status, r.created_at, ru.full_name AS reporter_name,
            COALESCE(p.user_id, c.user_id, s.user_id) AS author_id,
            COALESCE(pu.full_name, cu.full_name, su.full_name) AS author_name,
            COALESCE(p.body, c.body, s.caption) AS body,
            COALESCE(p.created_at, c.created_at, s.created_at) AS posted_at,
            COALESCE(p.deleted_at, c.deleted_at, s.deleted_at) AS deleted_at,
            COALESCE(p.media_id, s.media_id) AS media_id,
            g.name AS gym_name,
            EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = COALESCE(p.user_id, c.user_id, s.user_id) AND cp.status = 'suspended') AS author_suspended
     FROM community_reports r
     JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN community_posts p ON p.id = r.post_id LEFT JOIN users pu ON pu.id = p.user_id
     LEFT JOIN gyms g ON g.id = p.gym_id
     LEFT JOIN community_comments c ON c.id = r.comment_id LEFT JOIN users cu ON cu.id = c.user_id
     LEFT JOIN community_stories s ON s.id = r.story_id LEFT JOIN users su ON su.id = s.user_id
     WHERE ${where}
     ORDER BY r.created_at DESC, r.id LIMIT ?`,
    [ROW_LIMIT],
  );
  const groups = new Map();
  for (const row of rows) {
    const type = row.post_id ? "post" : row.comment_id ? "comment" : "story";
    const key = `${type}:${row.post_id ?? row.comment_id ?? row.story_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        type,
        id: row.post_id ?? row.comment_id ?? row.story_id,
        author: { id: row.author_id, name: nameOf(row.author_name) },
        authorSuspended: Boolean(row.author_suspended),
        where: type === "post" ? (row.gym_name ?? "Main feed") : type === "comment" ? "A comment" : "A story",
        body: row.body,
        postedAt: iso(row.posted_at),
        deleted: row.deleted_at !== null,
        // The photo, through the admin-only evidence route (works after a deletion too)
        imageUrl: row.media_id ? `/api/community/reports/${row.id}/media` : null,
        reports: [],
      });
    }
    groups.get(key).reports.push({ id: row.id, reason: row.reason, reporter: nameOf(row.reporter_name), status: row.status, at: iso(row.created_at) });
  }
  return [...groups.values()].slice(0, GROUP_LIMIT).map((g) => ({
    ...g,
    count: g.reports.length,
    outcome: status === "open" ? null : g.reports.some((r) => r.status === "reviewed") || g.deleted ? "removed" : "dismissed",
  }));
}

function resolveBody(body) {
  requireObject(body, "resolution");
  rejectUnknownKeys(body, ["type", "id", "action"], "The resolution");
  if (!TYPES.includes(body.type)) throw new ValidationError("Say whether it's a post, comment or story.");
  if (!ACTIONS.includes(body.action)) throw new ValidationError("Choose remove or dismiss.");
  return { type: body.type, id: uuid(body.id, "The reported item"), action: body.action };
}

const COLUMN = { post: "post_id", comment: "comment_id", story: "story_id" };
const NOUN = { post: "post", comment: "comment", story: "story" };

/**
 * Remove (delete the content, close its reports as reviewed) or dismiss (keep it, close them as
 * dismissed), in one transaction, logged. Nothing open on that content is a 404.
 */
async function resolveGroup(pool, adminId, { type, id, action }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const column = COLUMN[type]; // from a fixed list, never the request
    const [open] = await conn.query(`SELECT id FROM community_reports WHERE ${column} = ? AND status = 'open' FOR UPDATE`, [id]);
    if (open.length === 0) throw new NotFoundError("Those reports are already resolved.");
    let authorName = "a member";
    if (type === "post") {
      const [[p]] = await conn.query("SELECT u.full_name FROM community_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? FOR UPDATE", [id]);
      authorName = nameOf(p?.full_name);
      if (action === "remove") await conn.query("UPDATE community_posts SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ?", [id]);
    } else if (type === "comment") {
      const [[c]] = await conn.query("SELECT c.post_id, c.deleted_at, u.full_name FROM community_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ? FOR UPDATE", [id]);
      authorName = nameOf(c?.full_name);
      if (action === "remove" && c && c.deleted_at === null) {
        await conn.query("UPDATE community_comments SET deleted_at = NOW() WHERE id = ?", [id]);
        await conn.query("UPDATE community_posts SET comment_count = GREATEST(comment_count, 1) - 1 WHERE id = ?", [c.post_id]);
      }
    } else {
      const [[s]] = await conn.query("SELECT u.full_name FROM community_stories s JOIN users u ON u.id = s.user_id WHERE s.id = ? FOR UPDATE", [id]);
      authorName = nameOf(s?.full_name);
      if (action === "remove") await conn.query("UPDATE community_stories SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ?", [id]);
    }
    const status = action === "remove" ? "reviewed" : "dismissed";
    await conn.query(`UPDATE community_reports SET status = ? WHERE ${column} = ? AND status = 'open'`, [status, id]);
    const n = open.length;
    await audit(conn, adminId, action === "remove" ? "report.remove" : "report.dismiss", type === "post" ? "post" : "report", id,
      action === "remove" ? `Removed ${authorName}'s ${NOUN[type]} (${n} ${n === 1 ? "report" : "reports"})` : `Dismissed ${n === 1 ? "a report" : `${n} reports`} on ${authorName}'s ${NOUN[type]}`);
    await conn.commit();
    return { type, id, action, resolved: n };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { listQuery, listGroups, resolveBody, resolveGroup };
