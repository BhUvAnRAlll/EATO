// Super Admin › Gyms: every gym with its plan, owner and status; one gym in detail (counts,
// owner, plan, suspension); and creating a gym, which starts a 14-day trial and makes the chosen
// account its owner. Only justFit admins reach this (requireAdmin). Plans are labels only: no
// payment is taken anywhere.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");
const { text, optionalText, rejectUnknownKeys, requireObject, id: uuid } = require("../community/validate");
const gymValidate = require("../gyms/validate");
const { newCode } = require("../gyms/gyms");
const { provisionAgent } = require("../whatsapp/provision");
const { audit } = require("./overview");

const TRIAL_DAYS = 14;
const LIST_LIMIT = 500;
const PLAN_NAMES = { starter: "Starter", pro: "Pro", elite: "Elite" };

const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const nameOf = (row, key = "full_name") => (row[key] && row[key].trim()) || "justFit member";

// Runs `work` in one transaction
async function inTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// ---- list and detail ----------------------------------------------------------------

function searchQuery(query) {
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > 80) throw new ValidationError("Search for at most 80 characters.");
  return search;
}

async function listGyms(pool, search) {
  const params = [];
  let where = "";
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where = "WHERE g.name LIKE ? OR g.location LIKE ?";
    params.push(like, like);
  }
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.location, g.plan, g.status, g.trial_ends_at, g.member_count, u.full_name AS owner_name, o.user_id AS owner_id
     FROM gyms g
     LEFT JOIN gym_members o ON o.gym_id = g.id AND o.role = 'owner' AND o.status = 'active'
     LEFT JOIN users u ON u.id = o.user_id
     ${where}
     ORDER BY g.name LIMIT ?`,
    [...params, LIST_LIMIT],
  );
  return rows.map((g) => ({
    id: g.id, name: g.name, location: g.location, plan: g.plan, status: g.status, trialEndsOn: day(g.trial_ends_at),
    memberCount: Number(g.member_count), owner: g.owner_id ? { id: g.owner_id, name: nameOf(g, "owner_name") } : null,
  }));
}

async function gymDetail(pool, gymId) {
  const [[g]] = await pool.query(
    "SELECT id, name, location, address, invite_code, visibility, member_approval, plan, status, trial_ends_at, suspended_at FROM gyms WHERE id = ?",
    [gymId],
  );
  if (!g) throw new NotFoundError("That gym doesn't exist.");
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'active') AS members,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'active' AND role IN ('owner', 'admin')) AS staff,
       (SELECT COUNT(*) FROM community_posts WHERE gym_id = ? AND deleted_at IS NULL AND review_status = 'published') AS posts,
       (SELECT COUNT(*) FROM gym_events WHERE gym_id = ? AND event_date >= CURDATE()) AS upcoming,
       (SELECT COUNT(DISTINCT r.post_id) FROM community_reports r JOIN community_posts p ON p.id = r.post_id WHERE p.gym_id = ? AND r.status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'pending') AS join_requests`,
    Array(6).fill(gymId),
  );
  const [[owner]] = await pool.query(
    "SELECT u.id, u.full_name FROM gym_members m JOIN users u ON u.id = m.user_id WHERE m.gym_id = ? AND m.role = 'owner' AND m.status = 'active'",
    [gymId],
  );
  const n = (v) => Number(v);
  return {
    id: g.id, name: g.name, location: g.location, address: g.address, inviteCode: g.invite_code, visibility: g.visibility,
    memberApproval: Boolean(g.member_approval), plan: g.plan, status: g.status, trialEndsOn: day(g.trial_ends_at),
    counts: { members: n(counts.members), staff: n(counts.staff), posts: n(counts.posts), upcomingEvents: n(counts.upcoming), openReports: n(counts.open_reports), joinRequests: n(counts.join_requests) },
    owner: owner ? { id: owner.id, name: nameOf(owner) } : null,
  };
}

// ---- create -------------------------------------------------------------------------

const OWNER_ID = /^[A-Za-z0-9_]{1,64}$/;

function createBody(body) {
  requireObject(body, "gym");
  rejectUnknownKeys(body, ["name", "tagline", "location", "address", "ownerId", "visibility", "memberApproval", "plan"], "The gym");
  if (typeof body.ownerId !== "string" || !OWNER_ID.test(body.ownerId)) throw new ValidationError("Pick the gym's owner.");
  const { limits, VISIBILITY, PLANS } = gymValidate;
  if (body.visibility !== undefined && !VISIBILITY.includes(body.visibility)) throw new ValidationError("Pick public, private or hidden.");
  if (body.plan !== undefined && !PLANS.includes(body.plan)) throw new ValidationError("Pick a plan: starter, pro or elite.");
  if (body.memberApproval !== undefined && typeof body.memberApproval !== "boolean") throw new ValidationError("Approve new members must be on or off.");
  return {
    name: text(body.name, "Gym name", { min: 2, max: limits.name }),
    tagline: optionalText(body.tagline, "Tagline", limits.tagline),
    location: text(body.location, "Area", { min: 2, max: limits.location }),
    address: optionalText(body.address, "Street address", limits.address),
    ownerId: body.ownerId,
    visibility: body.visibility ?? "public",
    memberApproval: body.memberApproval ?? false,
    plan: body.plan ?? "starter",
  };
}

/** A new gym on a 14-day trial, owned by an existing account, with its agent rows provisioned. */
async function createGym(pool, adminId, values) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTransaction(pool, async (conn) => {
        const [[owner]] = await conn.query("SELECT id, full_name FROM users WHERE id = ?", [values.ownerId]);
        if (!owner) throw new ValidationError("That owner doesn't have an justFit account.");
        const gymId = crypto.randomUUID();
        await conn.query(
          `INSERT INTO gyms (id, name, tagline, location, address, invite_code, visibility, member_approval, plan, status, trial_ends_at, member_count, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', DATE_ADD(CURDATE(), INTERVAL ? DAY), 1, ?)`,
          [gymId, values.name, values.tagline, values.location, values.address, newCode(8), values.visibility, values.memberApproval, values.plan, TRIAL_DAYS, adminId],
        );
        await conn.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', NOW())", [gymId, owner.id]);
        await provisionAgent(conn, gymId);
        await audit(conn, adminId, "gym.create", "gym", gymId, `Created gym ${values.name} (${TRIAL_DAYS}-day trial, owner ${nameOf(owner)})`);
        return gymId;
      });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY" && /uq_gyms_name/.test(error.message)) throw new ValidationError("A gym with that name already exists.");
      if (error?.code === "ER_DUP_ENTRY" && attempt < 3) continue; // the random invite code collided
      throw error;
    }
  }
}

// ---- plan and suspension ------------------------------------------------------------

function planBody(body) {
  requireObject(body, "plan");
  rejectUnknownKeys(body, ["plan"], "The plan");
  if (!gymValidate.PLANS.includes(body.plan)) throw new ValidationError("Pick a plan: starter, pro or elite.");
  return body.plan;
}

/** Records a plan change (a label: nothing is charged) */
async function setPlan(pool, adminId, gymId, plan) {
  return inTransaction(pool, async (conn) => {
    const [[g]] = await conn.query("SELECT name, plan FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
    if (!g) throw new NotFoundError("That gym doesn't exist.");
    if (g.plan !== plan) {
      await conn.query("UPDATE gyms SET plan = ? WHERE id = ?", [plan, gymId]);
      await audit(conn, adminId, "gym.plan", "gym", gymId, `Changed ${g.name} to the ${PLAN_NAMES[plan]} plan`);
    }
    return { gymId, plan };
  });
}

/**
 * Suspend: the gym leaves Explore and its posts are hidden from everyone. Reinstate: back to
 * its trial while the trial still has days left, else active.
 */
async function setSuspended(pool, adminId, gymId, suspended) {
  return inTransaction(pool, async (conn) => {
    const [[g]] = await conn.query("SELECT name, status, trial_ends_at FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
    if (!g) throw new NotFoundError("That gym doesn't exist.");
    if (suspended && g.status !== "suspended") {
      await conn.query("UPDATE gyms SET status = 'suspended', suspended_at = NOW() WHERE id = ?", [gymId]);
      await audit(conn, adminId, "gym.suspend", "gym", gymId, `Suspended gym ${g.name}`);
    } else if (!suspended && g.status === "suspended") {
      await conn.query("UPDATE gyms SET status = IF(trial_ends_at IS NOT NULL AND trial_ends_at >= CURDATE(), 'trial', 'active'), suspended_at = NULL WHERE id = ?", [gymId]);
      await audit(conn, adminId, "gym.reinstate", "gym", gymId, `Reinstated gym ${g.name}`);
    }
    const [[after]] = await conn.query("SELECT status FROM gyms WHERE id = ?", [gymId]);
    return { gymId, status: after.status };
  });
}

const gymId = (value) => {
  try {
    return uuid(value, "The gym");
  } catch {
    throw new NotFoundError("That gym doesn't exist.");
  }
};

module.exports = { searchQuery, listGyms, gymDetail, createBody, createGym, planBody, setPlan, setSuspended, gymId, TRIAL_DAYS };
