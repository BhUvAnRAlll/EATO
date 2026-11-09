// Gym registration and approval (Gym Hub ecosystem phase 1, the user's brief of 2026-11-09): pure
// rules, unit-tested. A member registers a gym from the app (a draft), fills in the business, the
// place, the gym and its documents, and submits it; a justFit admin reviews it and approves, rejects,
// asks for more documents or changes, and later may suspend and reactivate the branch. Only an
// approved, published branch reaches members (Discover); a suspended one is closed to its portal and
// to check-ins.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");
const { onlyKeys, requiredText } = require("./rules");
const profileRules = require("./profileRules");

const STATUSES = ["draft", "submitted", "pending_review", "approved", "rejected", "suspended"];
const BUSINESS_TYPES = ["individual", "partnership", "private_limited", "llp", "other"];
const DOCUMENT_KINDS = ["registration", "address", "other"];
// What an application needs before it can be submitted (platform settings may change it later)
const REQUIRED_DOCUMENTS = ["address"];
const MAX_DOCUMENTS = 8;
const NOTE_MAX = 300;
// Applications a member may have open (draft, submitted or in review) at once
const OPEN_STATUSES = ["draft", "submitted", "pending_review"];
// The applicant may change the application only while it is theirs to change
const EDITABLE = ["draft", "rejected"];

// The Super Admin's actions: which states each starts from, where it leads, and whether a reason is
// required. submit is the applicant's.
const ACTIONS = {
  submit: { from: ["draft", "rejected"], to: "submitted", note: "none", admin: false },
  start_review: { from: ["submitted"], to: "pending_review", note: "none", admin: true },
  approve: { from: ["submitted", "pending_review"], to: "approved", note: "optional", admin: true },
  reject: { from: ["submitted", "pending_review"], to: "rejected", note: "required", admin: true },
  request_documents: { from: ["submitted", "pending_review"], to: "draft", note: "required", admin: true },
  request_changes: { from: ["submitted", "pending_review"], to: "draft", note: "required", admin: true },
  suspend: { from: ["approved"], to: "suspended", note: "required", admin: true },
  reactivate: { from: ["suspended"], to: "approved", note: "optional", admin: true },
};
const ADMIN_ACTIONS = Object.keys(ACTIONS).filter((a) => ACTIONS[a].admin);

const LABEL = {
  draft: "Draft",
  submitted: "Submitted",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};
const ACTION_WORDS = {
  create: "Started the application",
  submit: "Submitted for review",
  start_review: "Review started",
  approve: "Approved",
  reject: "Rejected",
  request_documents: "More documents requested",
  request_changes: "Changes requested",
  suspend: "Suspended",
  reactivate: "Reactivated",
};
const NOTE_PROMPT = {
  reject: "Say why it was rejected.",
  request_documents: "Say which documents are needed.",
  request_changes: "Say what needs to change.",
  suspend: "Say why the gym is suspended.",
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PINCODE = /^[1-9]\d{5}$/;

// Why `action` can't happen from `status`, or null when it can
function transitionProblem(action, status) {
  const rule = ACTIONS[action];
  if (!rule) return "That isn't something we can do to a gym.";
  if (rule.from.includes(status)) return null;
  return `This gym is ${LABEL[status]?.toLowerCase() ?? status}, so it can't be ${ACTION_WORDS[action].toLowerCase()} now.`;
}

// A Super Admin's decision: { action, note }; the note is required where the action needs a reason
function decisionBody(body) {
  onlyKeys(body, ["action", "note"]);
  if (!ADMIN_ACTIONS.includes(body.action)) throw new ValidationError("Pick what to do with this gym.");
  const note = profileRules.optionalText(body.note, NOTE_MAX, "reason");
  if (ACTIONS[body.action].note === "required" && !note) throw new ValidationError(NOTE_PROMPT[body.action]);
  if (note && note.length < 5 && ACTIONS[body.action].note === "required") throw new ValidationError("Write a little more so the gym knows what to do.");
  return { action: body.action, note };
}

function optionalPhone(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return normalizePhone(value);
}

function optionalName(value, label, max) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return requiredText(value, label, max);
}

function state(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return requiredText(value, "state", 40);
}

function pincode(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !PINCODE.test(value.trim())) throw new ValidationError("Enter a 6-digit pincode.");
  return value.trim();
}

function address(value) {
  const text = profileRules.optionalText(value, 160, "address");
  if (text && CONTROL.test(text)) throw new ValidationError("The address has characters we can't show.");
  return text;
}

// Inside India, as the attendance map takes it; both or neither
function place(lat, lng) {
  if ((lat === null || lat === undefined) && (lng === null || lng === undefined)) return { latitude: null, longitude: null };
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new ValidationError("Pick the gym's place on the map again.");
  if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) throw new ValidationError("Pick a place in India.");
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
}

const FIELDS = ["gymName", "branch", "legalName", "businessType", "contactName", "contactPhone", "contactEmail", "address", "area", "city", "state", "pincode", "latitude", "longitude", "about", "facilities", "hours"];

/**
 * POST /api/gym-registration (creating) or PATCH …/:id: the application's fields. Creating needs
 * the gym's name, its area and city (a branch row needs them); everything else may come later and
 * is checked as a whole when it is submitted (missing below).
 */
function applicationBody(body, { creating }) {
  onlyKeys(body, FIELDS);
  const out = {};
  const has = (key) => body[key] !== undefined;
  if (creating || has("gymName")) out.gymName = requiredText(body.gymName, "gym's name", 80);
  if (creating || has("branch")) out.branch = body.branch === undefined || body.branch === null || body.branch === "" ? "Main" : requiredText(body.branch, "branch name", 80);
  if (creating || has("area")) out.area = requiredText(body.area, "area", 80);
  if (creating || has("city")) out.city = requiredText(body.city, "city", 60);
  if (has("legalName")) out.legalName = optionalName(body.legalName, "business name", 120);
  if (has("businessType")) {
    if (body.businessType !== null && !BUSINESS_TYPES.includes(body.businessType)) throw new ValidationError("Pick the type of business from the list.");
    out.businessType = body.businessType;
  }
  if (has("contactName")) out.contactName = optionalName(body.contactName, "contact person's name", 80);
  if (has("contactPhone")) out.contactPhone = optionalPhone(body.contactPhone);
  if (has("contactEmail")) out.contactEmail = profileRules.email(body.contactEmail);
  if (has("address")) out.address = address(body.address);
  if (has("state")) out.state = state(body.state);
  if (has("pincode")) out.pincode = pincode(body.pincode);
  if (has("latitude") || has("longitude")) Object.assign(out, place(body.latitude, body.longitude));
  if (has("about")) out.about = profileRules.optionalText(body.about, profileRules.ABOUT_MAX, "description");
  if (has("facilities")) out.facilities = profileRules.facilities(body.facilities);
  if (has("hours")) out.hours = profileRules.openingHours(body.hours);
  if (Object.keys(out).length === 0) throw new ValidationError("Change at least one detail.");
  return out;
}

/**
 * What is still missing before an application can be submitted, as short lines for the app's
 * checklist. app: the application as read (readApplication), documents: its document kinds.
 */
function missing(app, documentKinds) {
  const out = [];
  if (!app.businessType) out.push({ key: "business", text: "The type of business" });
  if (!app.contactName) out.push({ key: "business", text: "A contact person" });
  if (!app.contactPhone) out.push({ key: "business", text: "A contact mobile number" });
  if (!app.address) out.push({ key: "location", text: "The full address" });
  if (!app.state) out.push({ key: "location", text: "The state" });
  if (!app.pincode) out.push({ key: "location", text: "The pincode" });
  if (!app.about) out.push({ key: "gym", text: "A short description of the gym" });
  if (!app.hours) out.push({ key: "gym", text: "Opening hours" });
  for (const kind of REQUIRED_DOCUMENTS) if (!documentKinds.includes(kind)) out.push({ key: "documents", text: kind === "address" ? "An address proof" : "A registration document" });
  return out;
}

// The kind of document from the request: one of the three
function documentKind(value) {
  if (!DOCUMENT_KINDS.includes(value)) throw new ValidationError("Pick what the document is.");
  return value;
}

/**
 * POST …/documents { kind, data, mediaType }: a photo (JPEG, PNG, WebP) or a PDF, from its real
 * bytes, up to 5 MB. → { ok, kind, bytes, mediaType } or { ok: false, status, error }
 */
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
function checkDocument(body, { decodeBase64, sniffMediaType }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Send the document as { kind, data, mediaType }." };
  for (const key of Object.keys(body)) if (!["kind", "data", "mediaType"].includes(key)) return { ok: false, status: 400, error: `Unexpected field: ${key}.` };
  if (!DOCUMENT_KINDS.includes(body.kind)) return { ok: false, status: 400, error: "Pick what the document is." };
  if (typeof body.data !== "string" || typeof body.mediaType !== "string") return { ok: false, status: 400, error: "Send the document as { kind, data, mediaType }." };
  const bytes = decodeBase64(body.data);
  if (!bytes) return { ok: false, status: 400, error: "The document couldn't be read." };
  const actual = sniffMediaType(bytes);
  if (!DOCUMENT_TYPES.includes(actual)) return { ok: false, status: 415, error: "Upload a photo (JPEG, PNG or WebP) or a PDF." };
  if (actual !== body.mediaType) return { ok: false, status: 415, error: "The file type doesn't match its contents." };
  if (bytes.length > DOCUMENT_MAX_BYTES) return { ok: false, status: 413, error: "The document is too large (max 5 MB)." };
  return { ok: true, kind: body.kind, bytes, mediaType: actual };
}

// GET /api/admin/portal/gyms?status=: all, review (submitted or pending review) or one status
const LIST_FILTERS = ["all", "review", ...STATUSES];
function listQuery(query) {
  const status = query?.status ?? "all";
  if (typeof status !== "string" || !LIST_FILTERS.includes(status)) throw new ValidationError("Pick a status from the list.");
  return { status };
}
function statusesFor(filter) {
  if (filter === "all") return null;
  if (filter === "review") return ["submitted", "pending_review"];
  return [filter];
}

module.exports = {
  STATUSES, BUSINESS_TYPES, DOCUMENT_KINDS, REQUIRED_DOCUMENTS, MAX_DOCUMENTS, NOTE_MAX, OPEN_STATUSES, EDITABLE, ACTIONS, ADMIN_ACTIONS, LABEL, ACTION_WORDS,
  DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, LIST_FILTERS,
  transitionProblem, decisionBody, applicationBody, missing, documentKind, checkDocument, listQuery, statusesFor,
};
