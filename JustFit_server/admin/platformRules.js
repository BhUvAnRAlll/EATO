// Super Admin › the gym platform (Gym Hub ecosystem, the user's brief of 2026-11-09, section 7): pure,
// unit-tested. Analytics periods, the staff directory's filters, account suspension and gym
// ownership transfer bodies, and the day-by-day series the charts draw.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");
const { cleanText } = require("../gym/rules");

const PERIODS = [7, 30, 90];
const STAFF_ROLES = ["all", "owner", "staff", "trainer"];
const REASON_MAX = 200;

/** GET /api/admin/portal/gym-analytics?days=7|30|90 */
function analyticsQuery(query = {}) {
  const days = query.days === undefined ? 30 : Number(query.days);
  if (!PERIODS.includes(days)) throw new ValidationError("Pick 7, 30 or 90 days.");
  return { days };
}

/** GET /api/admin/portal/gym-staff?role=&search=&page= */
function staffQuery(query = {}) {
  const role = query.role ?? "all";
  if (!STAFF_ROLES.includes(role)) throw new ValidationError("Pick owners, staff or trainers.");
  const search = typeof query.search === "string" ? cleanText(query.search, 60) : "";
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new ValidationError("That page doesn't exist.");
  return { role, search, page };
}

function reason(value, what) {
  if (typeof value !== "string" || value.length > REASON_MAX * 2) throw new ValidationError(`Say why the ${what}.`);
  const text = cleanText(value, REASON_MAX + 1);
  if (text.length < 5) throw new ValidationError(`Say why the ${what}.`);
  if (text.length > REASON_MAX) throw new ValidationError(`Keep the reason to ${REASON_MAX} characters.`);
  return text;
}

/** POST /api/admin/portal/users/:userId/suspend { reason } */
function suspendBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((k) => k !== "reason")) throw new ValidationError("That request has fields we don't use.");
  return { reason: reason(body.reason, "account is suspended") };
}

/** Why this account can't be suspended by this admin, or null */
function suspendProblem(target, adminId) {
  if (!target) return "That account doesn't exist.";
  if (target.id === adminId) return "You can't suspend your own account.";
  if (target.role === "admin") return "A justFit admin can't be suspended here. Change their role first.";
  return null;
}

/** POST /api/admin/portal/gyms/:gymId/transfer { phone, reason } */
function transferBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((k) => !["phone", "reason"].includes(k))) throw new ValidationError("That request has fields we don't use.");
  return { phone: normalizePhone(body.phone), reason: reason(body.reason, "gym changes owner") };
}

/** Why this account can't become the branch's owner, or null. links: its gym_staff rows with brand ids */
function transferProblem(account, links, brandId) {
  if (!account) return "No account has signed in with that number yet. Ask them to sign in to justFit once.";
  if (account.role === "admin") return "A justFit admin can't own a gym.";
  if (account.role === "trainer") return "That account is a trainer. Remove it from its gym first.";
  if (links.some((l) => l.brandId !== brandId)) return "That account works at another gym. Remove it there first.";
  return null;
}

/** Day-by-day counts for the last `days` days ending today: rows [{ day, n }] → [{ date, value }] */
function series(rows, today, days, addDays) {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    return { date, value: byDay.get(date) ?? 0 };
  });
}

module.exports = { PERIODS, STAFF_ROLES, analyticsQuery, staffQuery, suspendBody, suspendProblem, transferBody, transferProblem, series };
