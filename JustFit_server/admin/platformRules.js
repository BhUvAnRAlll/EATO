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

/** POST /api/admin/portal/gyms/:gymId/feature { featured } */
function featureBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((k) => k !== "featured") || typeof body.featured !== "boolean") throw new ValidationError("Feature the gym or stop featuring it.");
  return { featured: body.featured };
}

// Report exports (GET /api/admin/portal/gym-report?kind=&format=): every branch, or every gym team
const REPORT_KINDS = ["gyms", "staff"];
const REPORT_FORMATS = ["xlsx", "csv"];
function reportQuery(query = {}) {
  if (Object.keys(query).some((k) => !["kind", "format"].includes(k))) throw new ValidationError("That request has fields we don't use.");
  const kind = query.kind ?? "gyms";
  const format = query.format ?? "xlsx";
  if (!REPORT_KINDS.includes(kind)) throw new ValidationError("Pick the gyms or the staff report.");
  if (!REPORT_FORMATS.includes(format)) throw new ValidationError("Pick Excel or CSV.");
  return { kind, format };
}

// A CSV cell: quoted when needed, and a leading = + - @ (a spreadsheet formula) neutralised
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
/** The whole CSV, with a byte-order mark so Excel reads ₹ and Indian names right */
function toCsv(header, rows) {
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", pending_review: "In review", approved: "Approved", rejected: "Rejected", suspended: "Suspended" };
const GYM_HEADER = ["Gym", "Branch", "Area", "City", "State", "Status", "On Discover", "Featured", "Added on", "Memberships", "Active memberships", "Visits (30 days)", "Team"];
/** One branch as the report's row; numbers stay numbers */
function gymRow(r) {
  const status = r.status ?? "approved";
  return [
    r.brand, r.branch, r.area, r.city, r.state ?? null, STATUS_LABEL[status] ?? status,
    status === "approved" && r.published ? "Yes" : "No", r.featured ? "Yes" : "No", r.added_on ?? null,
    Number(r.memberships ?? 0), Number(r.active ?? 0), Number(r.visits ?? 0), Number(r.team ?? 0),
  ];
}
const STAFF_HEADER = ["Name", "Phone", "Role", "Gym", "Branch", "City", "Added on", "Suspended"];
function staffRow(s) {
  return [s.name ?? "No name yet", s.phone ?? null, s.roleLabel, s.gym.name, s.gym.branch, s.gym.city, s.addedOn ?? null, s.suspended ? "Yes" : "No"];
}

module.exports = { reportQuery, toCsv, csvCell, gymRow, staffRow, GYM_HEADER, STAFF_HEADER, featureBody, PERIODS, STAFF_ROLES, analyticsQuery, staffQuery, suspendBody, suspendProblem, transferBody, transferProblem, series };
