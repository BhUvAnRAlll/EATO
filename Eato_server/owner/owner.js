// The gym owner portal's data: which gyms the caller runs, the Home dashboard, and members'
// package renewals. Every function takes the verified caller's id and checks, for that gym,
// that they are its active owner or admin (gym_members), or an EATO platform admin (the Clerk
// role, read live) opening it to help. Gym trainers and members are refused.
//
// Renewals are recorded only: no payment is taken (gym_member_plans holds each member's package).
const { ValidationError } = require("../profile");
const { memberSummary, currentRole } = require("../community/members");
const { NotFoundError, ForbiddenError } = require("../community/posts");
const { mediaUrl } = require("../community/media");
const perms = require("../gyms/permissions");
const rules = require("./rules");

const GONE = "That gym doesn't exist.";
const STAFF_ONLY = "Only this gym's owner and admins can open the owner portal.";

// Runs fn(connection) in one transaction
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

const todayOf = async (db) => (await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today"))[0][0].today;

// The gym and how the caller may act on it: "owner" / "admin" from gym_members, or "platform"
// for an EATO admin. A gym the caller can't see answers like a missing one (404).
async function ownerAccess(db, gymId, userId) {
  const [[gym]] = await db.query("SELECT id, name, logo_media_id, plan, visibility FROM gyms WHERE id = ?", [gymId]);
  if (!gym) throw new NotFoundError(GONE);
  const [[membership]] = await db.query("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, userId]);
  if (perms.canManage(membership)) return { gym, as: membership.role };
  if ((await currentRole(userId)) === "admin") return { gym, as: "platform" };
  if (!perms.canSeeGym(gym, membership)) throw new NotFoundError(GONE);
  throw new ForbiddenError(STAFF_ONLY);
}

const gymCard = (row, as) => ({ id: row.id, name: row.name, logoUrl: mediaUrl(row.logo_media_id), plan: row.plan, as });

// The gyms the caller runs (owner first), for the portal's gym switcher and the entry button.
// `platformAdmin` tells the app it may also open any gym from Admin › Gyms.
async function managedGyms(pool, userId) {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.logo_media_id, g.plan, m.role FROM gym_members m JOIN gyms g ON g.id = m.gym_id
     WHERE m.user_id = ? AND m.status = 'active' AND m.role IN ('owner', 'admin')
     ORDER BY FIELD(m.role, 'owner', 'admin'), g.name`,
    [userId],
  );
  return { gyms: rows.map((row) => gymCard(row, row.role)) };
}

// Each active member's latest package (by end date; one without an end date counts as latest)
async function latestPlans(db, gymId) {
  const [rows] = await db.query(
    `SELECT p.user_id, p.id, p.plan_name, p.status, DATE_FORMAT(p.ends_on, '%Y-%m-%d') AS ends_on,
            DATEDIFF(p.ends_on, CURDATE()) AS days_left
     FROM gym_member_plans p JOIN gym_members m ON m.gym_id = p.gym_id AND m.user_id = p.user_id AND m.status = 'active'
     WHERE p.gym_id = ? AND p.status <> 'cancelled'
     ORDER BY p.user_id, p.ends_on IS NULL DESC, p.ends_on DESC, p.created_at DESC`,
    [gymId],
  );
  const latest = new Map();
  for (const row of rows) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
  return latest;
}

// ---- Home dashboard ---------------------------------------------------------------------

async function summary(pool, userId, gymId) {
  const { gym, as } = await ownerAccess(pool, gymId, userId);
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'active') AS members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'pending') AS join_requests,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'active' AND role = 'trainer') AS trainers,
       (SELECT COUNT(*) FROM gym_events WHERE gym_id = ? AND event_date >= CURDATE()) AS upcoming_events,
       (SELECT COUNT(*) FROM community_posts WHERE gym_id = ? AND deleted_at IS NULL AND review_status = 'published'
          AND created_at >= NOW() - INTERVAL 7 DAY) AS posts_this_week,
       (SELECT COUNT(*) FROM community_posts WHERE gym_id = ? AND deleted_at IS NULL AND review_status = 'pending') AS posts_to_review,
       (SELECT COUNT(DISTINCT r.post_id) FROM community_reports r JOIN community_posts p ON p.id = r.post_id
          WHERE p.gym_id = ? AND p.deleted_at IS NULL AND r.status = 'open') AS reported_posts,
       (SELECT COUNT(*) FROM gym_invitations WHERE gym_id = ? AND status = 'pending' AND expires_at > NOW()) AS invitations_pending`,
    Array(8).fill(gymId),
  );

  let expired = 0;
  let endingThisWeek = 0;
  for (const plan of (await latestPlans(pool, gymId)).values()) {
    const flag = rules.renewalFlag(plan.days_left);
    if (flag === "expired") expired += 1;
    if (flag === "this_week") endingThisWeek += 1;
  }

  const months = rules.lastMonths(new Date());
  const [joins] = await pool.query(
    `SELECT DATE_FORMAT(joined_at, '%Y-%m') AS month, COUNT(*) AS joined FROM gym_members
     WHERE gym_id = ? AND status = 'active' AND role <> 'owner' AND joined_at >= ?
     GROUP BY month`,
    [gymId, `${months[0]}-01`],
  );
  const joinedBy = new Map(joins.map((row) => [row.month, Number(row.joined)]));

  const [team] = await pool.query(
    `SELECT m.user_id, u.full_name, tp.title,
            (SELECT COUNT(*) FROM trainer_connections c WHERE c.trainer_id = m.user_id AND c.status = 'connected') AS clients
     FROM gym_members m JOIN users u ON u.id = m.user_id LEFT JOIN trainer_profiles tp ON tp.user_id = m.user_id
     WHERE m.gym_id = ? AND m.status = 'active' AND m.role = 'trainer'
     ORDER BY u.full_name, m.user_id LIMIT 20`,
    [gymId],
  );

  const [[next]] = await pool.query(
    `SELECT id, title, DATE_FORMAT(event_date, '%Y-%m-%d') AS date, TIME_FORMAT(start_time, '%H:%i') AS start_time,
            TIME_FORMAT(end_time, '%H:%i') AS end_time, location, attendee_count, max_attendees
     FROM gym_events WHERE gym_id = ? AND (event_date > CURDATE() OR (event_date = CURDATE() AND end_time > CURTIME()))
     ORDER BY event_date, start_time, id LIMIT 1`,
    [gymId],
  );

  const n = (value) => Number(value);
  return {
    gym: gymCard(gym, as),
    stats: {
      members: n(counts.members),
      joinRequests: n(counts.join_requests),
      upcomingEvents: n(counts.upcoming_events),
      trainers: n(counts.trainers),
      postsThisWeek: n(counts.posts_this_week),
      plan: gym.plan,
    },
    attention: {
      joinRequests: n(counts.join_requests),
      postsToReview: n(counts.posts_to_review),
      reportedPosts: n(counts.reported_posts),
      membershipsExpired: expired,
      membershipsEndingThisWeek: endingThisWeek,
      invitationsPending: n(counts.invitations_pending),
    },
    newMembers: months.map((month) => ({ month, count: joinedBy.get(month) ?? 0 })),
    coachingTeam: team.map((row) => ({ member: memberSummary(row), title: row.title ?? null, clients: n(row.clients) })),
    nextEvent: next
      ? { id: next.id, title: next.title, date: next.date, startTime: next.start_time, endTime: next.end_time,
          location: next.location, attendeeCount: next.attendee_count, maxAttendees: next.max_attendees }
      : null,
  };
}

// ---- renewals ---------------------------------------------------------------------------

const planToApi = (plan) =>
  plan ? { id: plan.id, name: plan.plan_name, status: plan.status, endsOn: plan.ends_on, daysLeft: plan.days_left === null ? null : Number(plan.days_left) } : null;

// Every active member (not the owner) with their latest package, soonest to end first
async function renewals(pool, userId, gymId) {
  await ownerAccess(pool, gymId, userId);
  const [members] = await pool.query(
    `SELECT m.user_id, m.role, u.full_name FROM gym_members m JOIN users u ON u.id = m.user_id
     WHERE m.gym_id = ? AND m.status = 'active' AND m.role <> 'owner' LIMIT 1000`,
    [gymId],
  );
  const plans = await latestPlans(pool, gymId);
  const rows = members.map((row) => {
    const plan = planToApi(plans.get(row.user_id) ?? null);
    return { member: memberSummary(row), role: row.role, plan, daysLeft: plan ? plan.daysLeft : null, flag: rules.renewalFlag(plan ? plan.daysLeft : null) };
  });
  return { members: rows.sort(rules.byDaysLeft) };
}

function validateRenewal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Choose how long to renew for.");
  const extra = Object.keys(body).filter((key) => key !== "months");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  if (body.months !== 1 && body.months !== 3) throw new ValidationError("Renew for 1 or 3 months.");
  return { months: body.months };
}

// Extends (or restarts) a member's package by 1 or 3 months; a member with no package gets one
// named after the gym's first tier. Recorded only, no payment.
async function renew(pool, userId, gymId, memberId, { months }) {
  const result = await inTransaction(pool, async (connection) => {
    await ownerAccess(connection, gymId, userId);
    const [[target]] = await connection.query(
      "SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ? FOR UPDATE",
      [gymId, memberId],
    );
    if (!target || target.status !== "active") throw new NotFoundError("That person isn't an active member of this gym.");
    if (target.role === "owner") throw new ValidationError("The owner doesn't have a membership package.");
    const today = await todayOf(connection);
    const [[plan]] = await connection.query(
      `SELECT id, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on FROM gym_member_plans
       WHERE gym_id = ? AND user_id = ? AND status <> 'cancelled'
       ORDER BY ends_on IS NULL DESC, ends_on DESC, created_at DESC LIMIT 1 FOR UPDATE`,
      [gymId, memberId],
    );
    if (plan && plan.ends_on === null) throw new ValidationError("This member's package has no end date, so there's nothing to renew.");
    const endsOn = rules.renewedEnd(plan ? plan.ends_on : null, today, months);
    if (plan) {
      const restart = plan.ends_on < today;
      await connection.query(
        `UPDATE gym_member_plans SET status = 'active', ends_on = ?${restart ? ", starts_on = ?" : ""} WHERE id = ?`,
        restart ? [endsOn, today, plan.id] : [endsOn, plan.id],
      );
      return plan.id;
    }
    const [[gym]] = await connection.query("SELECT membership_tiers FROM gyms WHERE id = ?", [gymId]);
    const tiers = Array.isArray(gym.membership_tiers) ? gym.membership_tiers : [];
    const name = (tiers[0] && typeof tiers[0].name === "string" && tiers[0].name) || "Membership";
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      "INSERT INTO gym_member_plans (id, gym_id, user_id, plan_name, status, starts_on, ends_on, created_by) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
      [id, gymId, memberId, name.slice(0, 80), today, endsOn, userId],
    );
    return id;
  });
  const [[plan]] = await pool.query(
    `SELECT id, plan_name, status, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on, DATEDIFF(ends_on, CURDATE()) AS days_left
     FROM gym_member_plans WHERE id = ?`,
    [result],
  );
  const shaped = planToApi(plan);
  return { plan: shaped, flag: rules.renewalFlag(shaped.daysLeft) };
}

// The caller's own package in a gym (the member's view on the gym page). Only their own row.
async function myPlan(pool, userId, gymId) {
  const [[membership]] = await pool.query("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, userId]);
  if (!membership || membership.status !== "active") return { plan: null, flag: "none" };
  const [[plan]] = await pool.query(
    `SELECT id, plan_name, status, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on, DATEDIFF(ends_on, CURDATE()) AS days_left
     FROM gym_member_plans WHERE gym_id = ? AND user_id = ? AND status <> 'cancelled'
     ORDER BY ends_on IS NULL DESC, ends_on DESC, created_at DESC LIMIT 1`,
    [gymId, userId],
  );
  const shaped = planToApi(plan ?? null);
  return { plan: shaped, flag: rules.renewalFlag(shaped ? shaped.daysLeft : null) };
}

module.exports = { ownerAccess, managedGyms, summary, renewals, validateRenewal, renew, myPlan, STAFF_ONLY };
