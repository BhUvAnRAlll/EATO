// In-app notifications (Gym Hub ecosystem, section 9): writing them for people, and each person
// reading, marking and muting their own. Writing never fails the action that caused it: an error
// (or the table missing before migration 2027-01-04) is logged and ignored. Every read is the
// caller's own rows (req.userId); nothing here returns another person's notification.
const rules = require("./rules");
const platformSettings = require("../platform/settings");

// The member notices a branch doesn't send (none before migration 2027-01-26)
async function branchTurnedOff(db, gymId) {
  try {
    const [[row]] = await db.query("SELECT member_notifications FROM gyms WHERE id = ?", [gymId]);
    return rules.readMemberOff(row?.member_notifications ?? null);
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return [];
    throw error;
  }
}

/** A branch's member notices: each with whether it is sent */
async function memberSettings(pool, gymId) {
  const off = await branchTurnedOff(pool, gymId);
  return { notices: rules.MEMBER_KINDS.map((k) => ({ ...k, on: !off.includes(k.kind) })) };
}

/** Saves which member notices the branch doesn't send (503 before the migration, like other gym settings) */
async function saveMemberSettings(pool, gymId, { off }) {
  await pool.query("UPDATE gyms SET member_notifications = ? WHERE id = ?", [JSON.stringify(off), gymId]);
  return memberSettings(pool, gymId);
}

/**
 * Writes one notification for each person; the same dedupe key for the same person is written once
 * (INSERT IGNORE on the unique key). → how many were written. Who decides (2026-11-10): a member's
 * gym notices follow their branch's choice (`gymId`, gyms.member_notifications) and a member's
 * complaint answer the Super Admin's (platform settings); members don't mute anything themselves.
 * The gym team and admins still mute their own categories.
 */
async function notify(db, userIds, notification, { gymId = null } = {}) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const n = rules.build(notification);
    const forMembers = rules.MEMBER_KIND_IDS.includes(n.kind) || rules.PLATFORM_MEMBER_KINDS.includes(n.kind);
    if (rules.MEMBER_KIND_IDS.includes(n.kind) && gymId && (await branchTurnedOff(db, gymId)).includes(n.kind)) return 0;
    if (rules.PLATFORM_MEMBER_KINDS.includes(n.kind) && !(await platformSettings.get(db)).memberComplaintUpdates) return 0;
    let to = ids;
    if (!forMembers) {
      const [prefs] = await db.query("SELECT user_id, muted FROM notification_preferences WHERE user_id IN (?)", [ids]);
      const mutedBy = new Map(prefs.map((p) => [p.user_id, rules.readMuted(p.muted)]));
      to = ids.filter((id) => !(mutedBy.get(id) ?? []).includes(n.category));
    }
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

module.exports = { notify, list, markRead, preferences, savePreferences, memberSettings, saveMemberSettings };
