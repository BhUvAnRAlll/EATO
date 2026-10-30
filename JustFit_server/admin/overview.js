// The Super Admin portal's Overview: platform-wide counts, the to-do list (each item opens the
// screen that resolves it), and the audit log of admin actions. Only justFit admins reach this
// (requireAdmin checks the role on every request); nothing here is scoped to a gym.

const TODO_LIMIT = 5; // gyms on trial listed by name
const ACTIVITY_LIMIT = 10;

/**
 * One line in the audit log, written in the same transaction as the action when there is one.
 * `summary` is shown as written ("Suspended Marcus Johnson"), so it never holds anything private.
 */
async function audit(db, adminId, action, targetType, targetId, summary) {
  await db.query("INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, summary) VALUES (?, ?, ?, ?, ?)", [
    adminId, action, targetType, targetId === null || targetId === undefined ? null : String(targetId), summary.slice(0, 200),
  ]);
}

/**
 * Logs an admin action after it succeeded. The action has already happened, so a failed log
 * write (for example before the admin migration has run) is reported, never thrown back.
 */
async function recordAdminAction(pool, req, action, targetType, targetId, summary) {
  try {
    await audit(pool, req.userId, action, targetType, targetId, summary);
  } catch (error) {
    require("../logging").logRequestError(req, error);
  }
}

// A member's display name for a summary line
async function nameOf(pool, userId) {
  const [[row]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [userId]);
  return (row?.full_name && row.full_name.trim()) || "a member";
}

const iso = (value) => (value ? new Date(value).toISOString() : null);
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

async function overview(pool) {
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM gyms) AS gyms,
       (SELECT COUNT(*) FROM gym_members WHERE status = 'active') AS gym_members,
       (SELECT COUNT(DISTINCT COALESCE(post_id, comment_id, story_id)) FROM community_reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM community_profiles WHERE status = 'suspended') AS suspended`,
  );
  const [trials] = await pool.query("SELECT id, name, trial_ends_at FROM gyms WHERE status = 'trial' ORDER BY trial_ends_at, name LIMIT ?", [TODO_LIMIT]);
  const [activity] = await pool.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.summary, a.created_at, u.full_name AS admin_name
     FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC, a.id LIMIT ?`,
    [ACTIVITY_LIMIT],
  );
  const n = (v) => Number(v);
  return {
    counts: {
      users: n(counts.users), gyms: n(counts.gyms), gymMembers: n(counts.gym_members),
      openReports: n(counts.open_reports), suspended: n(counts.suspended),
    },
    todo: {
      reportedPosts: n(counts.open_reports),
      gymsOnTrial: trials.map((g) => ({ id: g.id, name: g.name, trialEndsOn: day(g.trial_ends_at) })),
    },
    activity: activity.map((a) => ({ id: a.id, action: a.action, targetType: a.target_type, targetId: a.target_id, summary: a.summary, by: a.admin_name || "An admin", at: iso(a.created_at) })),
  };
}

module.exports = { audit, recordAdminAction, nameOf, overview };
