// Membership states and the gym's pause policy (Gym Hub ecosystem, 2026-11-09): reads and writes for
// gym/standingRules.js. Before migration 2027-01-01 every membership counts as active and the
// policy is justFit's default, so check-ins and pauses keep working; changing either answers 503.
const { ConflictError, ForbiddenError, NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { audit } = require("../admin/overview");
const rules = require("./standingRules");
const platformSettings = require("../platform/settings");
const { inTransaction } = require("./service");
const { addDays } = require("./rules");
const { hasStanding } = require("./gymStatus");

/** { standing, note, at } of one membership; active before the migration */
async function standingOf(db, memberId, { lock = false } = {}) {
  if (!(await hasStanding(db))) return { standing: "active", note: null, at: null };
  const [[row]] = await db.query(`SELECT standing, standing_note, standing_at FROM gym_members WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [memberId]);
  return row ? { standing: row.standing, note: row.standing_note, at: row.standing_at ? new Date(row.standing_at).toISOString() : null } : { standing: "active", note: null, at: null };
}

/** 403 unless the membership is active (check-ins and pause requests) */
async function refuseInactive(db, memberId, gymName) {
  const { standing } = await standingOf(db, memberId);
  const problem = rules.inactiveProblem(standing, gymName);
  if (problem) throw new ForbiddenError(problem);
}

/** POST /api/gym/members/:id/standing: suspend, cancel or reactivate one member of this branch */
async function setStanding(pool, gym, userId, memberId, { standing, note }) {
  if (!(await hasStanding(pool))) {
    const error = new Error("missing migration");
    error.code = "ER_BAD_FIELD_ERROR";
    throw error;
  }
  return inTransaction(pool, async (db) => {
    const [[member]] = await db.query("SELECT id, full_name, member_code, standing FROM gym_members WHERE id = ? AND gym_id = ? FOR UPDATE", [memberId, gym.id]);
    if (!member) throw new NotFoundError("That member isn't at your gym.");
    const problem = rules.moveProblem(member.standing, standing);
    if (problem) throw new ConflictError(problem);
    await db.query("UPDATE gym_members SET standing = ?, standing_note = ?, standing_at = NOW(), standing_by = ? WHERE id = ? AND gym_id = ?", [standing, note, userId, memberId, gym.id]);
    const verb = standing === "active" ? "Reactivated" : standing === "suspended" ? "Suspended" : "Cancelled";
    await audit(db, userId, `gym.member_${standing === "active" ? "reactivate" : standing === "suspended" ? "suspend" : "cancel"}`, "gym", gym.id, `${verb} the membership of ${member.full_name} (${member.member_code}) at ${gym.brand} ${gym.branch}`);
    return { standing, note, previous: member.standing };
  });
}

/** The branch's pause policy (defaults before the migration or when never set) */
async function policyOf(db, gymId) {
  try {
    const [[row]] = await db.query("SELECT pause_policy FROM gyms WHERE id = ?", [gymId]);
    // The branch's own policy, else justFit's default (platform settings)
    if (row?.pause_policy) return rules.readPolicy(row.pause_policy);
    return (await platformSettings.get(db)).pausePolicy;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return (await platformSettings.get(db)).pausePolicy;
    throw error;
  }
}

/** Approved and waiting pauses that started in the last 12 months: { count, days } */
async function usage(db, memberId, today) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(days), 0) AS days FROM gym_membership_pauses WHERE member_id = ? AND status IN ('pending', 'approved') AND pause_from > ?",
    [memberId, addDays(today, -rules.POLICY_WINDOW_DAYS)],
  );
  return { count: Number(row.n), days: Number(row.days) };
}

/** A member's eligibility for another pause request */
async function eligibilityOf(db, gymId, memberId, today) {
  const [policy, used] = await Promise.all([policyOf(db, gymId), usage(db, memberId, today)]);
  return rules.eligibility(policy, used);
}

/** PUT /api/gym/pause-policy: merges the change into the branch's policy */
async function savePolicy(pool, gym, userId, fields) {
  const current = await policyOf(pool, gym.id);
  const next = { ...current, ...fields };
  if (next.maxDaysPerYear !== null && next.maxDaysEach > next.maxDaysPerYear) throw new ValidationError("The longest pause can't be more than the days a year.");
  await pool.query("UPDATE gyms SET pause_policy = ? WHERE id = ?", [JSON.stringify(next), gym.id]);
  await audit(pool, userId, "gym.edit", "gym", gym.id, `Changed the pause policy of ${gym.brand}’s ${gym.branch} branch`);
  return { policy: next };
}

module.exports = { hasStanding, standingOf, refuseInactive, setStanding, policyOf, usage, eligibilityOf, savePolicy };
