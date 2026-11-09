// In-app notifications (Gym Hub ecosystem, section 9): writing them for people, and each person
// reading, marking and muting their own. Writing never fails the action that caused it: an error
// (or the table missing before migration 2027-01-04) is logged and ignored. Every read is the
// caller's own rows (req.userId); nothing here returns another person's notification.
const rules = require("./rules");

/**
 * Writes one notification for each person who hasn't muted its category; the same dedupe key for the
 * same person is written once (INSERT IGNORE on the unique key). → how many were written.
 */
async function notify(db, userIds, notification) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const n = rules.build(notification);
    const [prefs] = await db.query("SELECT user_id, muted FROM notification_preferences WHERE user_id IN (?)", [ids]);
    const mutedBy = new Map(prefs.map((p) => [p.user_id, rules.readMuted(p.muted)]));
    const to = ids.filter((id) => !(mutedBy.get(id) ?? []).includes(n.category));
    if (to.length === 0) return 0;
    const [result] = await db.query(
      "INSERT IGNORE INTO notifications (user_id, category, kind, title, body, link, dedupe_key) VALUES ?",
      [to.map((id) => [id, n.category, n.kind, n.title, n.body, n.link, n.key])],
    );
    return result.affectedRows;
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") console.error(`Notification not written: ${error?.code ?? error?.message ?? "unknown"}`);
    return 0;
  }
}

/** GET /api/notifications: the newest first, 30 a page, with the unread count */
async function list(pool, userId, { page }) {
  const [[rows], [[{ unread }]]] = await Promise.all([
    pool.query(
      "SELECT id, category, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
      [userId, rules.PAGE + 1, (page - 1) * rules.PAGE],
    ),
    pool.query("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL", [userId]),
  ]);
  return {
    page,
    nextPage: rows.length > rules.PAGE ? page + 1 : null,
    unread: Number(unread),
    notifications: rows.slice(0, rules.PAGE).map((r) => ({
      id: Number(r.id), category: r.category, kind: r.kind, title: r.title, body: r.body, link: rules.safeLink(r.link),
      read: r.read_at !== null, at: new Date(r.created_at).toISOString(),
    })),
  };
}

/** POST /api/notifications/read: the caller's own, by id or all */
async function markRead(pool, userId, { ids, all }) {
  if (all) await pool.query("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL", [userId]);
  else await pool.query("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND id IN (?) AND read_at IS NULL", [userId, ids]);
  const [[{ unread }]] = await pool.query("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL", [userId]);
  return { unread: Number(unread) };
}

/** GET /api/notifications/preferences */
async function preferences(pool, userId) {
  const [[row]] = await pool.query("SELECT muted FROM notification_preferences WHERE user_id = ?", [userId]);
  return { muted: rules.readMuted(row?.muted ?? null), categories: rules.CATEGORIES.map((id) => ({ id, label: rules.CATEGORY_LABEL[id] })) };
}

/** PUT /api/notifications/preferences */
async function savePreferences(pool, userId, { muted }) {
  await pool.query("INSERT INTO notification_preferences (user_id, muted) VALUES (?, ?) ON DUPLICATE KEY UPDATE muted = VALUES(muted)", [userId, JSON.stringify(muted)]);
  return preferences(pool, userId);
}

module.exports = { notify, list, markRead, preferences, savePreferences };
