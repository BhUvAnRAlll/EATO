// Notices a gym sends its members: Notify members (owner portal), renewal reminders, and the
// automatic "checked in" / "renewed" notes. Each goes to recipients worked out here on the server
// from gym_members (only active members; pending, suspended and community-suspended people are
// never included) and lands in their notification bell (community/notifications.js).
//
// Sending is for the gym's owner and admins (ownerAccess), and rate limited per sender so a
// mistake or a compromised account can't flood members.
const { ValidationError } = require("../profile");
const { memberSummary } = require("../community/members");
const { createRateLimiter, tooManyRequestsMessage } = require("../rateLimit");
const { ownerAccess } = require("./owner");
const rules = require("./rules");

const LIMITS = { title: 60, body: 240, chosen: 500 };
const AUDIENCES = ["everyone", "in_gym", "renewal_due", "inactive", "staff", "chosen"];
const TARGETS = ["gym", "events", "my_qr", "session", "none"];
const RENEWAL_DUE_DAYS = 14;
const INACTIVE_DAYS = 14;

const sendLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }); // per sender, per hour

const tooMany = (seconds) => {
  const error = new ValidationError(tooManyRequestsMessage(seconds));
  error.status = 429;
  return error;
};

// The gym's active members who may receive notices (not suspended from the community)
const ACTIVE_MEMBERS = `SELECT m.user_id, m.role FROM gym_members m
  WHERE m.gym_id = ? AND m.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = m.user_id AND cp.status = 'suspended')`;

// Who each audience reaches, as user ids (chosen: only the given ids that are active members)
async function audienceIds(db, gymId, audience, chosen = []) {
  const [members] = await db.query(ACTIVE_MEMBERS, [gymId]);
  const ids = new Set(members.map((m) => m.user_id));
  if (audience === "everyone") return [...ids];
  if (audience === "staff") return members.filter((m) => m.role !== "member").map((m) => m.user_id);
  if (audience === "chosen") return [...new Set(chosen)].filter((id) => ids.has(id));
  if (audience === "in_gym") {
    const [rows] = await db.query("SELECT user_id FROM gym_visits WHERE gym_id = ? AND checked_out_at IS NULL", [gymId]);
    return rows.map((r) => r.user_id).filter((id) => ids.has(id));
  }
  if (audience === "inactive") {
    const [rows] = await db.query("SELECT DISTINCT user_id FROM gym_visits WHERE gym_id = ? AND checked_in_at >= NOW() - INTERVAL ? DAY", [gymId, INACTIVE_DAYS]);
    const visited = new Set(rows.map((r) => r.user_id));
    return members.filter((m) => m.role === "member" && !visited.has(m.user_id)).map((m) => m.user_id);
  }
  // renewal_due: the latest package ends within 14 days or has ended
  const [plans] = await db.query(
    `SELECT p.user_id, DATEDIFF(p.ends_on, CURDATE()) AS days_left FROM gym_member_plans p
     WHERE p.gym_id = ? AND p.status <> 'cancelled'
     ORDER BY p.user_id, p.ends_on IS NULL DESC, p.ends_on DESC, p.created_at DESC`,
    [gymId],
  );
  const latest = new Map();
  for (const p of plans) if (!latest.has(p.user_id)) latest.set(p.user_id, p.days_left === null ? null : Number(p.days_left));
  return [...latest].filter(([id, days]) => ids.has(id) && days !== null && days <= RENEWAL_DUE_DAYS).map(([id]) => id);
}

// Live counts for the Send to list
async function audiences(pool, staffId, gymId) {
  await ownerAccess(pool, gymId, staffId);
  const counts = {};
  for (const audience of AUDIENCES.filter((a) => a !== "chosen")) counts[audience] = (await audienceIds(pool, gymId, audience)).length;
  return { counts };
}

function validateNotice(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Write a title and a message.");
  const extra = Object.keys(body).filter((k) => !["title", "body", "target", "audience", "userIds", "test"].includes(k));
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!title) throw new ValidationError("Add a title.");
  if (title.length > LIMITS.title) throw new ValidationError(`Keep the title to ${LIMITS.title} characters.`);
  if (!message) throw new ValidationError("Add a message.");
  if (message.length > LIMITS.body) throw new ValidationError(`Keep the message to ${LIMITS.body} characters.`);
  const target = body.target ?? "gym";
  if (!TARGETS.includes(target)) throw new ValidationError("Choose what tapping it opens.");
  const test = body.test === true;
  if (body.test !== undefined && typeof body.test !== "boolean") throw new ValidationError("test must be true or false.");
  const audience = test ? "test" : body.audience;
  if (!test && !AUDIENCES.includes(audience)) throw new ValidationError("Choose who to send it to.");
  let userIds = [];
  if (audience === "chosen") {
    if (!Array.isArray(body.userIds) || body.userIds.length === 0) throw new ValidationError("Pick at least one person.");
    if (body.userIds.length > LIMITS.chosen) throw new ValidationError(`Pick up to ${LIMITS.chosen} people.`);
    if (!body.userIds.every((id) => typeof id === "string" && /^user_[A-Za-z0-9]{10,64}$/.test(id))) throw new ValidationError("One of the people isn't valid.");
    userIds = body.userIds;
  } else if (body.userIds !== undefined) throw new ValidationError("Only Choose people takes a list of people.");
  return { title, body: message, target, audience, userIds };
}

// Saves a notice and its recipients in one go; returns its id
async function insertNotice(db, gymId, senderId, { kind, title, body, target, audience }, recipients) {
  const [[{ id }]] = await db.query("SELECT UUID() AS id");
  await db.query(
    "INSERT INTO gym_notices (id, gym_id, sent_by, kind, title, body, target, audience, reach) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, gymId, senderId, kind, title, body, target, audience, recipients.length],
  );
  if (recipients.length > 0) await db.query("INSERT IGNORE INTO gym_notice_recipients (notice_id, user_id) VALUES ?", [recipients.map((userId) => [id, userId])]);
  return id;
}

async function inTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Notify members: to an audience, or only to the sender (test)
async function send(pool, staffId, gymId, notice) {
  await ownerAccess(pool, gymId, staffId);
  const budget = sendLimiter.check(staffId);
  if (!budget.ok) throw tooMany(budget.retryAfterSeconds);
  const recipients = notice.audience === "test" ? [staffId] : await audienceIds(pool, gymId, notice.audience, notice.userIds);
  if (recipients.length === 0) throw new ValidationError("Nobody is in that group right now.");
  // A test reaches the sender even when they aren't a member (an EATO admin helping out)
  const [[known]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", [staffId]);
  if (notice.audience === "test" && Number(known.n) === 0) throw new ValidationError("Your account isn't set up to receive notices yet.");
  const id = await inTransaction(pool, (connection) => insertNotice(connection, gymId, staffId, { kind: "message", ...notice }, recipients));
  return { notice: { id, title: notice.title, body: notice.body, target: notice.target, audience: notice.audience, reach: recipients.length } };
}

// The gym's sent notices (Notify members and reminders), newest first
async function sent(pool, staffId, gymId) {
  await ownerAccess(pool, gymId, staffId);
  const [rows] = await pool.query(
    `SELECT n.id, n.kind, n.title, n.body, n.target, n.audience, n.reach, n.created_at, u.full_name, n.sent_by
     FROM gym_notices n LEFT JOIN users u ON u.id = n.sent_by
     WHERE n.gym_id = ? AND n.kind IN ('message', 'reminder') ORDER BY n.created_at DESC, n.id LIMIT 50`,
    [gymId],
  );
  return {
    notices: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, target: r.target, audience: r.audience, reach: r.reach,
      sentAt: new Date(r.created_at).toISOString(), sentBy: r.sent_by ? memberSummary({ user_id: r.sent_by, full_name: r.full_name }).name : null,
    })),
  };
}

// An automatic note to one member (check-in, renewal) or a reminder; never fails the action that
// caused it (the visit or renewal is already saved)
async function notifyMember(db, gymId, senderId, userId, kind, title, body, target) {
  try {
    await insertNotice(db, gymId, senderId, { kind, title: title.slice(0, LIMITS.title), body: body.slice(0, LIMITS.body), target, audience: "chosen" }, [userId]);
  } catch (error) {
    console.error("gym notice not saved", error?.code ?? "");
  }
}

// Renewal reminders: one member, or everyone expired or ending this week
const reminderText = (gymName) => ({ title: "Renewal reminder", body: `Your ${gymName} membership is ending soon or has ended. Visit the front desk to renew.` });

async function remindOne(pool, staffId, gymId, memberId) {
  const { gym } = await ownerAccess(pool, gymId, staffId);
  const budget = sendLimiter.check(staffId);
  if (!budget.ok) throw tooMany(budget.retryAfterSeconds);
  const [active] = await pool.query(`${ACTIVE_MEMBERS} AND m.user_id = ?`, [gymId, memberId]);
  if (active.length === 0) throw new ValidationError("That person isn't an active member of this gym.");
  const text = reminderText(gym.name);
  await insertNotice(pool, gymId, staffId, { kind: "reminder", ...text, target: "gym", audience: "chosen" }, [memberId]);
  return { reach: 1 };
}

async function remindDue(pool, staffId, gymId) {
  const { gym } = await ownerAccess(pool, gymId, staffId);
  const budget = sendLimiter.check(staffId);
  if (!budget.ok) throw tooMany(budget.retryAfterSeconds);
  // Expired or ending within a week (Renewals' "Remind everyone due")
  const due = [];
  const [plans] = await pool.query(
    `SELECT p.user_id, DATEDIFF(p.ends_on, CURDATE()) AS days_left FROM gym_member_plans p
     WHERE p.gym_id = ? AND p.status <> 'cancelled' ORDER BY p.user_id, p.ends_on IS NULL DESC, p.ends_on DESC, p.created_at DESC`,
    [gymId],
  );
  const [members] = await pool.query(ACTIVE_MEMBERS, [gymId]);
  const active = new Set(members.map((m) => m.user_id));
  const seen = new Set();
  for (const p of plans) {
    if (seen.has(p.user_id)) continue;
    seen.add(p.user_id);
    const flag = rules.renewalFlag(p.days_left === null ? null : Number(p.days_left));
    if (active.has(p.user_id) && (flag === "expired" || flag === "this_week")) due.push(p.user_id);
  }
  if (due.length === 0) throw new ValidationError("Nobody is due for renewal this week.");
  const text = reminderText(gym.name);
  await insertNotice(pool, gymId, staffId, { kind: "reminder", ...text, target: "gym", audience: "renewal_due" }, due);
  return { reach: due.length };
}

module.exports = { LIMITS, AUDIENCES, TARGETS, audienceIds, audiences, validateNotice, send, sent, notifyMember, remindOne, remindDue };
