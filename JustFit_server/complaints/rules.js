// Complaints about gyms (Gym Hub ecosystem, the brief's section 7): pure, unit-tested. A member reports
// a branch with a category and what happened; justFit admins investigate, assign, keep internal
// notes, and resolve or dismiss it with words the reporter reads.
const { ValidationError } = require("../profile");
const { cleanText } = require("../gym/rules");

const CATEGORIES = ["safety", "billing", "staff", "facility", "false_info", "other"];
const CATEGORY_LABEL = { safety: "Safety", billing: "Fees or billing", staff: "Staff behaviour", facility: "Facilities or hygiene", false_info: "Wrong information", other: "Something else" };
const STATUSES = ["open", "investigating", "resolved", "dismissed"];
const STATUS_LABEL = { open: "Open", investigating: "Investigating", resolved: "Resolved", dismissed: "Dismissed" };
const CLOSED = ["resolved", "dismissed"];
const LIST_FILTERS = ["active", "all", ...STATUSES];

const plain = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
};
function words(value, label, min, max) {
  if (typeof value !== "string" || value.length > max * 2) throw new ValidationError(`Write ${label}.`);
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < min) throw new ValidationError(`Write ${label}.`);
  if (text.length > max) throw new ValidationError(`Keep it to ${max} characters.`);
  return text;
}

/** POST /api/complaints { gymId, category, details } */
function reportBody(body) {
  plain(body);
  if (Object.keys(body).some((k) => !["gymId", "category", "details"].includes(k))) throw new ValidationError("That request has fields we don't use.");
  if (!Number.isInteger(body.gymId) || body.gymId < 1) throw new ValidationError("Pick the gym.");
  if (!CATEGORIES.includes(body.category)) throw new ValidationError("Pick what the problem is about.");
  return { gymId: body.gymId, category: body.category, details: words(body.details, "what happened (at least 20 characters)", 20, 1000) };
}

/** POST /api/admin/portal/complaints/:id/notes { note } */
function noteBody(body) {
  plain(body);
  if (Object.keys(body).some((k) => k !== "note")) throw new ValidationError("That request has fields we don't use.");
  return { note: words(body.note, "the note", 3, 1000) };
}

/** POST /api/admin/portal/complaints/:id/status { status, resolution? } */
function statusBody(body) {
  plain(body);
  if (Object.keys(body).some((k) => !["status", "resolution"].includes(k))) throw new ValidationError("That request has fields we don't use.");
  if (!STATUSES.includes(body.status)) throw new ValidationError("Pick a status from the list.");
  const resolution = body.resolution === undefined || body.resolution === null || body.resolution === "" ? null : words(body.resolution, "what the member is told", 5, 500);
  if (CLOSED.includes(body.status) && !resolution) throw new ValidationError("Write what the member is told when the complaint closes.");
  return { status: body.status, resolution };
}

/** Why the complaint can't move to `to`, or null */
function moveProblem(from, to) {
  if (from === to) return `It is already ${STATUS_LABEL[to].toLowerCase()}.`;
  if (to === "open" && !CLOSED.includes(from)) return "Only a closed complaint can be opened again.";
  return null;
}

/** GET /api/admin/portal/complaints?status=&page= */
function listQuery(query = {}) {
  const status = query.status ?? "active";
  if (!LIST_FILTERS.includes(status)) throw new ValidationError("Pick a status from the list.");
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new ValidationError("That page doesn't exist.");
  return { status, page };
}

/** The statuses a filter shows */
const statusesFor = (filter) => (filter === "all" ? STATUSES : filter === "active" ? ["open", "investigating"] : [filter]);

module.exports = { CATEGORIES, CATEGORY_LABEL, STATUSES, STATUS_LABEL, CLOSED, LIST_FILTERS, reportBody, noteBody, statusBody, moveProblem, listQuery, statusesFor };
