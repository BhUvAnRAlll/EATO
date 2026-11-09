// Pause Membership (2026-11-07): the member's side (Profile › Gym membership in the justFit app,
// /api/membership) and the gym's side (/api/gym/pauses and a member's ⋯ › Pause Membership).
// A member is matched to gym_members by the account's verified phone, never by an id the app
// sends; staff work on their own branch's rows only. Every write locks the member's row and runs
// in one transaction; approving adds the pause's days to expires_on.
const { NotFoundError, ConflictError, ForbiddenError } = require("../errors");
const { getAccount } = require("../auth");
const { audit } = require("../admin/overview");
const service = require("./service");
const standing = require("./standing");
const standingRules = require("./standingRules");
const rules = require("./rules");
const pauseRules = require("./pauseRules");

const { DAY, inTransaction } = service;
const PAUSE_COLUMNS = `p.id, p.member_id, p.gym_id, p.requested_by, p.status, ${DAY("p.pause_from")} AS pause_from, ${DAY("p.pause_until")} AS pause_until, p.days, p.reason,
  p.decision_note, p.extended_days, DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(p.decided_at, '%Y-%m-%dT%H:%i:%sZ') AS decided_at`;

const pauseOf = (r) => ({
  id: r.id,
  status: r.status,
  by: r.requested_by,
  from: r.pause_from,
  until: r.pause_until,
  days: r.days,
  reason: r.reason,
  note: r.decision_note ?? null,
  extendedDays: r.extended_days ?? null,
  requestedAt: r.created_at,
  decidedAt: r.decided_at ?? null,
});

// The member's open pause (pending, or approved and not over), or null
async function openPause(db, memberId, today, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT ${PAUSE_COLUMNS} FROM gym_membership_pauses p WHERE p.member_id = ? AND p.status IN ('pending', 'approved') ORDER BY p.id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [memberId],
  );
  const pause = rows[0] ? pauseOf(rows[0]) : null;
  return pauseRules.isOpen(pause, today) ? pause : null;
}

// Approved and running today, for QR attendance. Before the migration (no table) there is none.
async function currentPause(db, memberId, today) {
  try {
    const pause = await openPause(db, memberId, today);
    return pauseRules.pausedOn(pause, today) ? pause : null;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return null;
    throw error;
  }
}

// ─── Members: Profile › Gym membership in the app ───────────────────────────────────────────

const MEMBERSHIP_COLUMNS = `m.id, m.member_code, m.full_name, m.plan_months, m.plan_days, ${DAY("m.joined_on")} AS joined_on, ${DAY("m.expires_on")} AS expires_on, m.due_amount, ${DAY("m.due_by")} AS due_by,
  m.pt_label, ${DAY("m.pt_from")} AS pt_from, ${DAY("m.pt_until")} AS pt_until, g.id AS gym_id, g.name AS branch, g.area, g.city, b.name AS brand`;
const MEMBERSHIP_FROM = "FROM gym_members m JOIN gyms g ON g.id = m.gym_id JOIN gym_brands b ON b.id = g.brand_id";

async function membershipOf(db, row, today) {
  const open = await openPause(db, row.id, today);
  const [history] = await db.query(`SELECT ${PAUSE_COLUMNS} FROM gym_membership_pauses p WHERE p.member_id = ? ORDER BY p.id DESC LIMIT 5`, [row.id]);
  const expiresOn = row.expires_on;
  const state = await standing.standingOf(db, row.id);
  const problem = standingRules.inactiveProblem(state.standing, row.brand) ?? pauseRules.pauseProblem({ expiresOn }, open, today, today);
  const eligible = await standing.eligibilityOf(db, row.gym_id, row.id, today);
  return {
    id: row.id,
    gym: { name: row.brand, branch: row.branch, area: row.area, city: row.city },
    code: row.member_code,
    name: row.full_name,
    planLength: row.plan_days ? { duration: row.plan_days, unit: "days" } : { duration: row.plan_months, unit: "months" },
    joinedOn: row.joined_on,
    expiresOn,
    daysLeft: Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000),
    status: expiresOn < today ? "expired" : expiresOn === today ? "expiring" : "active",
    due: row.due_amount,
    dueBy: row.due_amount > 0 ? row.due_by ?? null : null,
    pt: row.pt_until ? { label: row.pt_label, from: row.pt_from, until: row.pt_until, active: row.pt_until >= today } : null,
    pause: open,
    pausedNow: pauseRules.pausedOn(open, today),
    history: history.map(pauseOf),
    canPause: problem === null,
    pauseProblem: problem,
    limits: { maxDays: Math.min(pauseRules.MAX_PAUSE_DAYS, eligible.maxDaysNow || eligible.policy.maxDaysEach), maxStartAheadDays: pauseRules.MAX_START_AHEAD_DAYS },
    // Membership state (suspended or cancelled by the gym) and what the gym's pause policy leaves
    standing: state.standing,
    standingNote: state.note,
    pauseAllowance: { pausesLeft: eligible.pausesLeft, daysLeft: eligible.daysLeft, used: eligible.used, policy: eligible.policy },
  };
}

// Every membership on the account's verified number, at every gym
async function myMemberships(pool, userId, today) {
  const account = await getAccount(userId, pool);
  if (!account.phone) return { today, memberships: [] };
  const [rows] = await pool.query(`SELECT ${MEMBERSHIP_COLUMNS} ${MEMBERSHIP_FROM} WHERE m.phone = ? ORDER BY m.expires_on DESC, m.id DESC`, [account.phone]);
  const memberships = [];
  for (const row of rows) memberships.push(await membershipOf(pool, row, today));
  return { today, memberships };
}

// One of the caller's memberships (by phone) for Gym Hub's membership page; another member's id,
// or one not on their number, reads as missing
async function oneMembership(pool, userId, memberId, today) {
  const account = await getAccount(userId, pool);
  if (!account.phone) throw new NotFoundError("That membership isn't on your number.");
  const [[row]] = await pool.query(`SELECT ${MEMBERSHIP_COLUMNS} ${MEMBERSHIP_FROM} WHERE m.id = ? AND m.phone = ?`, [memberId, account.phone]);
  if (!row) throw new NotFoundError("That membership isn't on your number.");
  return { row, membership: await membershipOf(pool, row, today) };
}

// The caller's own membership row (by phone), locked for a write
async function ownMembership(db, userId, memberId) {
  const account = await getAccount(userId, db);
  if (!account.phone) throw new ForbiddenError("We couldn't match your account to a gym membership. Ask the front desk to check the mobile number on your membership.");
  const [[row]] = await db.query(`SELECT ${MEMBERSHIP_COLUMNS} ${MEMBERSHIP_FROM} WHERE m.id = ? AND m.phone = ? FOR UPDATE`, [memberId, account.phone]);
  if (!row) throw new NotFoundError("That membership isn't on your number.");
  return row;
}

// Option A: the member asks; the gym's staff approve or reject (status pending until then)
async function requestPause(pool, userId, memberId, body, today) {
  return inTransaction(pool, async (db) => {
    const row = await ownMembership(db, userId, memberId);
    await standing.refuseInactive(db, row.id, row.brand);
    const open = await openPause(db, row.id, today, { lock: true });
    const problem = pauseRules.pauseProblem({ expiresOn: row.expires_on }, open, body.from, today);
    if (problem) throw new ConflictError(problem);
    // The gym's pause policy (gym/standingRules.js): pauses and days in 12 months, the longest pause
    const eligible = await standing.eligibilityOf(db, row.gym_id, row.id, today);
    const policyProblem = standingRules.policyProblem(eligible.policy, eligible.used, body.days);
    if (policyProblem) throw new ConflictError(policyProblem);
    await db.query(
      "INSERT INTO gym_membership_pauses (gym_id, member_id, requested_by, status, pause_from, pause_until, days, reason, requester_id) VALUES (?, ?, 'member', 'pending', ?, ?, ?, ?, ?)",
      [row.gym_id, row.id, body.from, body.until, body.days, body.reason, userId],
    );
    return membershipOf(db, row, today);
  });
}

// A member takes back a request the gym hasn't answered yet
async function cancelPause(pool, userId, memberId, pauseId, today) {
  return inTransaction(pool, async (db) => {
    const row = await ownMembership(db, userId, memberId);
    const [[pause]] = await db.query(`SELECT ${PAUSE_COLUMNS} FROM gym_membership_pauses p WHERE p.id = ? AND p.member_id = ? FOR UPDATE`, [pauseId, row.id]);
    if (!pause) throw new NotFoundError("That pause request doesn't exist.");
    if (pause.status !== "pending") throw new ConflictError(pause.status === "approved" ? "The gym already approved this pause. Ask the front desk to change it." : "This request is no longer open.");
    await db.query("UPDATE gym_membership_pauses SET status = 'cancelled' WHERE id = ?", [pause.id]);
    return membershipOf(db, row, today);
  });
}

// ─── Staff: the requests list, approving, rejecting and pausing themselves ──────────────────

const LIST_LIMIT = 100;
const listItem = (r, today) => ({
  ...pauseOf(r),
  member: {
    id: r.member_id,
    code: r.member_code,
    name: r.full_name,
    photoUrl: r.photo_key ? `/api/gym/members/${r.member_id}/photo?v=${r.photo_key.slice(0, 8)}` : null,
    expiresOn: r.expires_on,
    status: r.expires_on < today ? "expired" : r.expires_on === today ? "expiring" : "active",
  },
  // Where the plan would end if this request is approved (what it ends on once it was)
  wouldEndOn: r.status === "pending" ? pauseRules.extendedUntil(r.expires_on, r.days) : null,
});
const LIST_COLUMNS = `${PAUSE_COLUMNS}, m.member_code, m.full_name, m.photo_key, ${DAY("m.expires_on")} AS expires_on`;

async function list(pool, gymId, { view }, today) {
  const where = view === "pending" ? "AND p.status = 'pending'" : "";
  const [rows] = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM gym_membership_pauses p JOIN gym_members m ON m.id = p.member_id WHERE p.gym_id = ? ${where} ORDER BY (p.status = 'pending') DESC, p.id DESC LIMIT ?`,
    [gymId, LIST_LIMIT],
  );
  const [[counts]] = await pool.query("SELECT COUNT(*) AS pending FROM gym_membership_pauses WHERE gym_id = ? AND status = 'pending'", [gymId]);
  return { today, view, counts: { pending: counts.pending }, pauses: rows.map((r) => listItem(r, today)) };
}

async function pauseRow(db, gymId, pauseId, today, { lock = false } = {}) {
  const [[row]] = await db.query(`SELECT ${LIST_COLUMNS} FROM gym_membership_pauses p JOIN gym_members m ON m.id = p.member_id WHERE p.id = ? AND p.gym_id = ?${lock ? " FOR UPDATE" : ""}`, [pauseId, gymId]);
  if (!row) throw new NotFoundError("That pause request isn't at your gym.");
  return row;
}

// Approve (the plan's end moves out by the pause's days) or reject a member's request
async function decide(pool, gym, userId, pauseId, approve, { note }, today) {
  await inTransaction(pool, async (db) => {
    const pause = await pauseRow(db, gym.id, pauseId, today, { lock: true });
    const problem = pauseRules.decisionProblem(pause);
    if (problem) throw new ConflictError(problem);
    const member = await service.memberRow(db, gym.id, pause.member_id, today, { lock: true });
    if (approve) {
      await db.query("UPDATE gym_members SET expires_on = ? WHERE id = ? AND gym_id = ?", [pauseRules.extendedUntil(member.expires_on, pause.days), member.id, gym.id]);
      await db.query("UPDATE gym_membership_pauses SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_note = ?, extended_days = ? WHERE id = ?", [userId, note, pause.days, pause.id]);
    } else {
      await db.query("UPDATE gym_membership_pauses SET status = 'rejected', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?", [userId, note, pause.id]);
    }
    await audit(db, userId, approve ? "gym.pause_approve" : "gym.pause_reject", "gym", gym.id, `${approve ? "Approved" : "Rejected"} the ${pause.days}-day pause of ${member.full_name} (${member.member_code}), ${pause.pause_from} to ${pause.pause_until}, at ${gym.brand} ${gym.branch}`);
  });
  const row = await pauseRow(pool, gym.id, pauseId, today);
  return { pause: listItem(row, today) };
}

// Option B: staff pause the membership themselves, approved at once
async function staffPause(pool, gym, userId, memberId, body, today) {
  await inTransaction(pool, async (db) => {
    const member = await service.memberRow(db, gym.id, memberId, today, { lock: true });
    await standing.refuseInactive(db, member.id, gym.brand);
    const open = await openPause(db, member.id, today, { lock: true });
    const problem = pauseRules.pauseProblem({ expiresOn: member.expires_on }, open, body.from, today);
    if (problem) throw new ConflictError(problem);
    await db.query(
      "INSERT INTO gym_membership_pauses (gym_id, member_id, requested_by, status, pause_from, pause_until, days, reason, requester_id, decided_by, decided_at, extended_days) VALUES (?, ?, 'staff', 'approved', ?, ?, ?, ?, ?, ?, NOW(), ?)",
      [gym.id, member.id, body.from, body.until, body.days, body.reason, userId, userId, body.days],
    );
    await db.query("UPDATE gym_members SET expires_on = ? WHERE id = ? AND gym_id = ?", [pauseRules.extendedUntil(member.expires_on, body.days), member.id, gym.id]);
    await audit(db, userId, "gym.pause_add", "gym", gym.id, `Paused the membership of ${member.full_name} (${member.member_code}) for ${body.days} days, ${body.from} to ${body.until}, at ${gym.brand} ${gym.branch}`);
  });
  return service.member(pool, gym.id, memberId, today);
}

module.exports = { PAUSE_COLUMNS, myMemberships, oneMembership, requestPause, cancelPause, list, decide, staffPause, currentPause, openPause, pauseOf };
