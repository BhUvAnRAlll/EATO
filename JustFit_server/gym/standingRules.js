// Membership states and the gym's pause policy (Gym Hub ecosystem, the user's brief of 2026-11-09):
// pure rules, unit-tested.
//   standing: a membership is active, or suspended or cancelled by the gym with a reason. Only an
//     active one checks in or asks for a pause; the plan's dates don't change, so reactivating
//     brings it back as it was.
//   pause policy: a branch's limits on members' pause requests, counted over the last 12 months
//     (approved and waiting requests): how many pauses, how many days, the longest single pause.
//     Staff pausing a membership themselves aren't held to it.
const { ValidationError } = require("../profile");
const { onlyKeys, cleanText } = require("./rules");
const pauseRules = require("./pauseRules");

const STANDINGS = ["active", "suspended", "cancelled"];
const STANDING_LABEL = { active: "Active", suspended: "Suspended", cancelled: "Cancelled" };
const NOTE_MAX = 200;
// Which state each change may come from
const MOVES = { suspended: ["active"], cancelled: ["active", "suspended"], active: ["suspended", "cancelled"] };

const POLICY_DEFAULT = { maxPerYear: null, maxDaysPerYear: null, maxDaysEach: pauseRules.MAX_PAUSE_DAYS };
const POLICY_WINDOW_DAYS = 365;

/** POST /api/gym/members/:id/standing { standing, note }: a reason is needed to suspend or cancel */
function standingBody(body) {
  onlyKeys(body, ["standing", "note"]);
  if (!STANDINGS.includes(body.standing)) throw new ValidationError("Pick active, suspended or cancelled.");
  let note = null;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    if (typeof body.note !== "string" || body.note.length > NOTE_MAX * 2) throw new ValidationError(`Keep the reason to ${NOTE_MAX} characters.`);
    note = cleanText(body.note, NOTE_MAX + 1) || null;
    if (note && note.length > NOTE_MAX) throw new ValidationError(`Keep the reason to ${NOTE_MAX} characters.`);
  }
  if (body.standing !== "active" && (!note || note.length < 5)) throw new ValidationError(`Say why the membership is ${body.standing}.`);
  return { standing: body.standing, note };
}

/** Why the membership can't move to `to` from `from`, or null */
function moveProblem(from, to) {
  if (from === to) return `This membership is already ${STANDING_LABEL[to].toLowerCase()}.`;
  if (!MOVES[to]?.includes(from)) return `A ${STANDING_LABEL[from].toLowerCase()} membership can't be ${to === "active" ? "reactivated" : to} now.`;
  return null;
}

/** The reason a member can't check in or ask for a pause, or null when active */
function inactiveProblem(standing, gymName = "the gym") {
  if (standing === "suspended") return `This membership is suspended by ${gymName}. Please ask the front desk.`;
  if (standing === "cancelled") return `This membership was cancelled by ${gymName}. Please ask the front desk.`;
  return null;
}

/** The stored policy, with the defaults for anything not set */
function readPolicy(stored) {
  let p = stored;
  try {
    if (typeof p === "string") p = JSON.parse(p);
  } catch {
    p = null;
  }
  const ok = (v, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : null);
  return {
    maxPerYear: ok(p?.maxPerYear, 12),
    maxDaysPerYear: ok(p?.maxDaysPerYear, 365),
    maxDaysEach: ok(p?.maxDaysEach, pauseRules.MAX_PAUSE_DAYS) ?? POLICY_DEFAULT.maxDaysEach,
  };
}

/** PUT /api/gym/pause-policy { maxPerYear, maxDaysPerYear, maxDaysEach }: null clears a limit */
function policyBody(body) {
  onlyKeys(body, ["maxPerYear", "maxDaysPerYear", "maxDaysEach"]);
  const out = {};
  const check = (key, max, words) => {
    if (body[key] === undefined) return;
    if (body[key] === null) { out[key] = null; return; }
    if (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > max) throw new ValidationError(`${words} is 1 to ${max}.`);
    out[key] = body[key];
  };
  check("maxPerYear", 12, "Pauses a year");
  check("maxDaysPerYear", 365, "Pause days a year");
  check("maxDaysEach", pauseRules.MAX_PAUSE_DAYS, "The longest pause");
  if (Object.keys(out).length === 0) throw new ValidationError("Change at least one limit.");
  const merged = { ...POLICY_DEFAULT, ...out };
  if (merged.maxDaysPerYear !== null && merged.maxDaysEach > merged.maxDaysPerYear) throw new ValidationError("The longest pause can't be more than the days a year.");
  return out;
}

/** What is left this 12 months: usage = { count, days } of approved and waiting pauses */
function eligibility(policy, usage) {
  return {
    policy,
    used: usage,
    pausesLeft: policy.maxPerYear === null ? null : Math.max(0, policy.maxPerYear - usage.count),
    daysLeft: policy.maxDaysPerYear === null ? null : Math.max(0, policy.maxDaysPerYear - usage.days),
    maxDaysNow: Math.max(0, Math.min(policy.maxDaysEach, policy.maxDaysPerYear === null ? policy.maxDaysEach : policy.maxDaysPerYear - usage.days)),
  };
}

/** Why a member's new request of `days` breaks the policy, or null */
function policyProblem(policy, usage, days) {
  const e = eligibility(policy, usage);
  if (e.pausesLeft === 0) return `This gym allows ${policy.maxPerYear} ${policy.maxPerYear === 1 ? "pause" : "pauses"} in 12 months, and you've used them.`;
  if (e.daysLeft === 0) return `This gym allows ${policy.maxDaysPerYear} pause days in 12 months, and you've used them.`;
  if (days > policy.maxDaysEach) return `This gym allows pauses of up to ${policy.maxDaysEach} days.`;
  if (e.daysLeft !== null && days > e.daysLeft) return `You have ${e.daysLeft} pause ${e.daysLeft === 1 ? "day" : "days"} left in these 12 months.`;
  return null;
}

module.exports = { STANDINGS, STANDING_LABEL, MOVES, POLICY_DEFAULT, POLICY_WINDOW_DAYS, standingBody, moveProblem, inactiveProblem, readPolicy, policyBody, eligibility, policyProblem };
