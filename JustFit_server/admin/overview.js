// The Super Admin portal's Overview: platform-wide counts (the last seven days for activity) and
// the audit log of admin actions. Only justFit admins reach this (requireAdmin checks the role
// on every request).

const ACTIVITY_LIMIT = 10;

/**
 * One line in the audit log, written in the same transaction as the action when there is one.
 * `summary` is shown as written ("Published promotion “Diwali offer”"), so it never holds anything private.
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

const iso = (value) => (value ? new Date(value).toISOString() : null);

async function overview(pool) {
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL 7 DAY) AS new_users,
       (SELECT COUNT(*) FROM workout_logs WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL 7 DAY) AS workouts,
       (SELECT COUNT(*) FROM macro_meal_logs WHERE logged_at >= NOW() - INTERVAL 7 DAY) AS meals`,
  );
  const [activity] = await pool.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.summary, a.created_at, u.full_name AS admin_name
     FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC, a.id LIMIT ?`,
    [ACTIVITY_LIMIT],
  );
  const n = (v) => Number(v);
  return {
    counts: { users: n(counts.users), newUsers: n(counts.new_users), workouts: n(counts.workouts), meals: n(counts.meals) },
    activity: activity.map((a) => ({ id: a.id, action: a.action, targetType: a.target_type, targetId: a.target_id, summary: a.summary, by: a.admin_name || "An admin", at: iso(a.created_at) })),
  };
}

// A count from a table a later migration adds: null until that migration has run
async function countOrNull(pool, sql) {
  try {
    const [[row]] = await pool.query(sql);
    return Number(row.n);
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return null;
    throw error;
  }
}

/**
 * The Overview's "Needs attention" and "Today": open member complaints about gyms, open meal
 * issues, and today's meal orders (open, delayed, revenue) from the meal-operations dashboard.
 * Each part is null before its migration. Read only.
 */
async function attention(pool, today) {
  const kitchens = require("../kitchens/service");
  const [complaints, issues, meals] = await Promise.all([
    countOrNull(pool, "SELECT COUNT(*) AS n FROM complaints WHERE status IN ('open', 'investigating')"),
    countOrNull(pool, "SELECT COUNT(*) AS n FROM meal_issues WHERE status IN ('open', 'in_progress')"),
    kitchens.dashboard(pool, { day: today, today }).then(
      (d) => ({ orders: d.orders.total - d.orders.steps.cancelled, open: d.orders.open, delayed: d.orders.delayed, revenue: d.revenue.amount }),
      (error) => {
        if (error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR") return null;
        throw error;
      },
    ),
  ]);
  return { openComplaints: complaints, openIssues: issues, meals };
}

module.exports = { audit, recordAdminAction, overview, attention };
