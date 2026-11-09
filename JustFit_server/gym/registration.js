// Gym registration and approval (Gym Hub ecosystem phase 1, the user's brief of 2026-11-09).
//
// The applicant's side (/api/gym-registration, any signed-in member): start an application (a new
// gym brand and its first branch, status draft), fill in the business, the place, the gym, its
// logo, photos and documents, and submit it. Only the account that started it reads or changes it
// (gym_brands.applicant_id), and only while it is a draft or was rejected.
//
// The Super Admin's side (admin/routes.js): read an application with its documents and history, and
// decide: start the review, approve, reject, ask for documents or changes, suspend, reactivate.
// Approving makes the applicant the branch's gym admin (role gym_admin and a gym_staff owner row) in
// the same transaction; the state change, the history row and the audit row are written together.
//
// Documents are private files on the server's disk (GYM_DOCUMENT_DIR, default
// uploads/gym-documents, git-ignored) under names the server made; they are read only through the
// applicant's and the Super Admin's signed-in routes and never reach a member.
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { NotFoundError, ConflictError, ForbiddenError } = require("../errors");
const { ValidationError } = require("../profile");
const { audit } = require("../admin/overview");
const { decodeBase64, sniffMediaType } = require("../bodyComposition/upload");
const { toE164 } = require("../auth/phone");
const rules = require("./registrationRules");
const profileRules = require("./profileRules");
const { inTransaction } = require("./service");
const gymProfile = require("./gymProfile");
const logos = require("./logos");

// ─── Document files ───────────────────────────────────────────────────────────────────────────

const documentDir = (env = process.env) => env.GYM_DOCUMENT_DIR || path.join(__dirname, "..", "uploads", "gym-documents");
const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MEDIA_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;
const isKey = (key) => typeof key === "string" && KEY.test(key);

async function saveFile(bytes, mediaType, env = process.env) {
  const dir = documentDir(env);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const key = `${crypto.randomUUID()}.${EXTENSION[mediaType]}`;
  const temp = path.join(dir, `${key}.part`);
  await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
  await fs.rename(temp, path.join(dir, key));
  return key;
}
async function readFile(key, env = process.env) {
  if (!isKey(key)) return null;
  try {
    return { bytes: await fs.readFile(path.join(documentDir(env), key)), mediaType: MEDIA_TYPE[key.split(".").pop()] };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function removeFile(key, env = process.env) {
  if (!isKey(key)) return;
  await fs.unlink(path.join(documentDir(env), key)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

/** Answers with a document: private, never cached, downloaded rather than shown inline when a PDF */
function sendDocument(res, { bytes, mediaType }) {
  res.set({ "Content-Type": mediaType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "Content-Disposition": mediaType === "application/pdf" ? "attachment; filename=\"document.pdf\"" : "inline" });
  res.end(bytes);
}

const checkDocument = (body) => rules.checkDocument(body, { decodeBase64, sniffMediaType });

// ─── Reading an application ───────────────────────────────────────────────────────────────────

const iso = (value) => (value ? new Date(value).toISOString() : null);
const APP_COLUMNS = `g.id, g.brand_id, b.name AS brand, g.name AS branch, g.area, g.city, g.state, g.pincode, g.address, g.latitude, g.longitude,
  g.about, g.facilities, g.opening_hours, g.status, g.status_note, g.status_changed_at, g.submitted_at, g.created_at,
  b.legal_name, b.business_type, b.contact_name, b.contact_phone, b.contact_email, b.applicant_id, b.logo_key`;
const APP_FROM = "FROM gyms g JOIN gym_brands b ON b.id = g.brand_id";

async function documentsOf(db, gymId, urlOf) {
  const [rows] = await db.query("SELECT id, kind, media_type, bytes, created_at FROM gym_documents WHERE gym_id = ? ORDER BY id", [gymId]);
  return rows.map((d) => ({ id: d.id, kind: d.kind, mediaType: d.media_type, bytes: d.bytes, uploadedAt: iso(d.created_at), url: urlOf(gymId, d.id) }));
}

async function photosOf(db, gymId, urlOf) {
  const [rows] = await db.query("SELECT id, image_key FROM gym_photos WHERE gym_id = ? ORDER BY sort_order, id", [gymId]);
  return rows.map((p) => ({ id: p.id, url: urlOf(gymId, p.id, p.image_key) }));
}

/**
 * history: every step, newest first. forAdmin adds who did it (the applicant sees "justFit" for an
 * admin's step and never an admin's name).
 */
async function historyOf(db, gymId, forAdmin) {
  const [rows] = await db.query(
    `SELECT h.action, h.from_status, h.to_status, h.note, h.by_admin, h.created_at, u.full_name
     FROM gym_status_history h LEFT JOIN users u ON u.id = h.by_user WHERE h.gym_id = ? ORDER BY h.id DESC LIMIT 50`,
    [gymId],
  );
  return rows.map((h) => ({
    action: h.action,
    text: rules.ACTION_WORDS[h.action],
    from: h.from_status,
    to: h.to_status,
    note: h.note,
    by: h.by_admin ? (forAdmin ? (h.full_name?.trim() || "justFit admin") : "justFit") : forAdmin ? (h.full_name?.trim() || "Applicant") : "You",
    at: iso(h.created_at),
  }));
}

function applicationOf(row) {
  return {
    id: row.id,
    gymName: row.brand,
    branch: row.branch,
    legalName: row.legal_name,
    businessType: row.business_type,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    address: row.address,
    area: row.area,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    about: row.about,
    facilities: profileRules.readFacilities(row.facilities),
    hours: profileRules.readHours(row.opening_hours),
    status: row.status,
    statusLabel: rules.LABEL[row.status],
    statusNote: row.status_note,
    statusChangedAt: iso(row.status_changed_at),
    submittedAt: iso(row.submitted_at),
    createdAt: iso(row.created_at),
  };
}

const memberUrls = {
  document: (gymId, id) => `/api/gym-registration/${gymId}/documents/${id}`,
  photo: (gymId, id, key) => `/api/gym-registration/${gymId}/photos/${id}?v=${key.slice(0, 8)}`,
  logo: (gymId, key) => (key ? `/api/gym-registration/${gymId}/logo?v=${key.slice(0, 8)}` : null),
};
const adminUrls = {
  document: (gymId, id) => `/api/admin/portal/gyms/${gymId}/documents/${id}`,
  photo: (gymId, id, key) => `/api/admin/portal/gyms/${gymId}/photos/${id}?v=${key.slice(0, 8)}`,
  logo: (gymId, key) => (key ? `/api/admin/portal/gyms/${gymId}/logo?v=${key.slice(0, 8)}` : null),
};

async function fullApplication(db, row, { forAdmin }) {
  const urls = forAdmin ? adminUrls : memberUrls;
  const [documents, photos, history] = await Promise.all([documentsOf(db, row.id, urls.document), photosOf(db, row.id, urls.photo), historyOf(db, row.id, forAdmin)]);
  const app = applicationOf(row);
  return {
    ...app,
    logoUrl: urls.logo(row.id, row.logo_key),
    photos,
    documents,
    history,
    missing: rules.missing(app, documents.map((d) => d.kind)),
    canEdit: rules.EDITABLE.includes(row.status),
    canSubmit: rules.ACTIONS.submit.from.includes(row.status),
  };
}

// The applicant's own application by id; anyone else's is a 404 (never "it exists but isn't yours")
async function ownRow(db, userId, gymId, { lock = false } = {}) {
  const [[row]] = await db.query(`SELECT ${APP_COLUMNS} ${APP_FROM} WHERE g.id = ? AND b.applicant_id = ?${lock ? " FOR UPDATE" : ""}`, [gymId, userId]);
  if (!row) throw new NotFoundError("That application isn't yours or doesn't exist.");
  return row;
}

// ─── The applicant ────────────────────────────────────────────────────────────────────────────

/** GET /api/gym-registration: the member's applications, newest first, the open one in full */
async function mine(pool, userId) {
  const [rows] = await pool.query(`SELECT ${APP_COLUMNS} ${APP_FROM} WHERE b.applicant_id = ? ORDER BY g.id DESC LIMIT 10`, [userId]);
  const [[account]] = await pool.query("SELECT role FROM users WHERE id = ?", [userId]);
  const open = rows.find((r) => rules.OPEN_STATUSES.includes(r.status) || r.status === "rejected") ?? null;
  return {
    canStart: account?.role === "user" && !rows.some((r) => rules.OPEN_STATUSES.includes(r.status)),
    current: open ? await fullApplication(pool, open, { forAdmin: false }) : null,
    applications: rows.map((r) => ({ id: r.id, gymName: r.brand, branch: r.branch, city: r.city, status: r.status, statusLabel: rules.LABEL[r.status], statusNote: r.status_note, submittedAt: iso(r.submitted_at) })),
    businessTypes: rules.BUSINESS_TYPES,
    documentKinds: rules.DOCUMENT_KINDS,
    requiredDocuments: rules.REQUIRED_DOCUMENTS,
  };
}

/** GET /api/gym-registration/:id */
async function one(pool, userId, gymId) {
  return fullApplication(pool, await ownRow(pool, userId, gymId), { forAdmin: false });
}

/**
 * POST /api/gym-registration: a new gym (brand) and its first branch as a draft. Only a member
 * account (not a justFit admin, gym team or trainer) may apply, with one open application at a time;
 * the account is locked so two taps can't start two.
 */
async function start(pool, userId, fields) {
  const id = await inTransaction(pool, async (db) => {
    const [[account]] = await db.query("SELECT role FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!account) throw new NotFoundError("Your account isn't there any more.");
    if (account.role !== "user") throw new ForbiddenError("This account already works with justFit as a team account, so it can't register a gym. Use a member account.");
    const [[{ n }]] = await db.query(
      `SELECT COUNT(*) AS n ${APP_FROM} WHERE b.applicant_id = ? AND g.status IN (?)`,
      [userId, rules.OPEN_STATUSES],
    );
    if (n > 0) throw new ConflictError("You already have a gym application open. Finish or wait for that one first.");
    const [brand] = await db.query(
      "INSERT INTO gym_brands (name, legal_name, business_type, contact_name, contact_phone, contact_email, applicant_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [fields.gymName, fields.legalName ?? null, fields.businessType ?? null, fields.contactName ?? null, fields.contactPhone ?? null, fields.contactEmail ?? null, userId, userId],
    );
    const [branch] = await db.query(
      `INSERT INTO gyms (brand_id, name, area, city, state, pincode, address, latitude, longitude, about, facilities, opening_hours, status, status_changed_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW(), ?)`,
      [
        brand.insertId, fields.branch, fields.area, fields.city, fields.state ?? null, fields.pincode ?? null, fields.address ?? null,
        fields.latitude ?? null, fields.longitude ?? null, fields.about ?? null,
        fields.facilities ? JSON.stringify(fields.facilities) : null, fields.hours ? JSON.stringify(fields.hours) : null, userId,
      ],
    );
    await db.query("INSERT INTO gym_status_history (gym_id, action, from_status, to_status, by_user, by_admin) VALUES (?, 'create', NULL, 'draft', ?, 0)", [branch.insertId, userId]);
    return branch.insertId;
  });
  return one(pool, userId, id);
}

const BRAND_COLUMNS = { gymName: "name", legalName: "legal_name", businessType: "business_type", contactName: "contact_name", contactPhone: "contact_phone", contactEmail: "contact_email" };
const BRANCH_COLUMNS = { branch: "name", area: "area", city: "city", state: "state", pincode: "pincode", address: "address", latitude: "latitude", longitude: "longitude", about: "about", facilities: "facilities", hours: "opening_hours" };
const asColumnValue = (key, value) => (["facilities", "hours"].includes(key) && value !== null ? JSON.stringify(value) : value);

// The application row locked and checked as one the applicant may still change
async function editableRow(db, userId, gymId) {
  const row = await ownRow(db, userId, gymId, { lock: true });
  if (!rules.EDITABLE.includes(row.status)) throw new ConflictError("Your application is with justFit for review, so it can't be changed now.");
  return row;
}

/** PATCH /api/gym-registration/:id: any of the fields, while a draft or rejected */
async function edit(pool, userId, gymId, fields) {
  await inTransaction(pool, async (db) => {
    const row = await editableRow(db, userId, gymId);
    const brandKeys = Object.keys(fields).filter((k) => BRAND_COLUMNS[k]);
    const branchKeys = Object.keys(fields).filter((k) => BRANCH_COLUMNS[k]);
    if (brandKeys.length) await db.query(`UPDATE gym_brands SET ${brandKeys.map((k) => `${BRAND_COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`, [...brandKeys.map((k) => fields[k]), row.brand_id]);
    if (branchKeys.length) await db.query(`UPDATE gyms SET ${branchKeys.map((k) => `${BRANCH_COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`, [...branchKeys.map((k) => asColumnValue(k, fields[k])), gymId]);
  });
  return one(pool, userId, gymId);
}

/** POST /api/gym-registration/:id/submit: everything required is there → submitted */
async function submit(pool, userId, gymId) {
  await inTransaction(pool, async (db) => {
    const row = await ownRow(db, userId, gymId, { lock: true });
    const problem = rules.transitionProblem("submit", row.status);
    if (problem) throw new ConflictError(problem);
    const [docs] = await db.query("SELECT kind FROM gym_documents WHERE gym_id = ?", [gymId]);
    const missing = rules.missing(applicationOf(row), docs.map((d) => d.kind));
    if (missing.length) throw new ValidationError(`Add ${missing.map((m) => m.text.charAt(0).toLowerCase() + m.text.slice(1)).join(", ")} before you submit.`);
    await db.query("UPDATE gyms SET status = 'submitted', status_note = NULL, status_changed_at = NOW(), submitted_at = NOW() WHERE id = ?", [gymId]);
    await db.query("INSERT INTO gym_status_history (gym_id, action, from_status, to_status, by_user, by_admin) VALUES (?, 'submit', ?, 'submitted', ?, 0)", [gymId, row.status, userId]);
  });
  return one(pool, userId, gymId);
}

/**
 * POST …/:id/documents: the file is written first, then the row (the application locked, so two
 * uploads can't pass the limit together); a refusal leaves no file.
 */
async function addDocument(pool, userId, gymId, { kind, bytes, mediaType }, env = process.env) {
  const key = await saveFile(bytes, mediaType, env);
  try {
    await inTransaction(pool, async (db) => {
      await editableRow(db, userId, gymId);
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_documents WHERE gym_id = ?", [gymId]);
      if (n >= rules.MAX_DOCUMENTS) throw new ValidationError(`An application can have up to ${rules.MAX_DOCUMENTS} documents. Remove one first.`);
      await db.query("INSERT INTO gym_documents (gym_id, kind, file_key, media_type, bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)", [gymId, kind, key, mediaType, bytes.length, userId]);
    });
  } catch (error) {
    await removeFile(key, env).catch(() => {});
    throw error;
  }
  return one(pool, userId, gymId);
}

/** DELETE …/:id/documents/:docId: the row first, then the file */
async function removeDocument(pool, userId, gymId, documentId, env = process.env) {
  const key = await inTransaction(pool, async (db) => {
    await editableRow(db, userId, gymId);
    const [[doc]] = await db.query("SELECT file_key FROM gym_documents WHERE id = ? AND gym_id = ? FOR UPDATE", [documentId, gymId]);
    if (!doc) throw new NotFoundError("That document isn't on your application.");
    await db.query("DELETE FROM gym_documents WHERE id = ? AND gym_id = ?", [documentId, gymId]);
    return doc.file_key;
  });
  await removeFile(key, env).catch((error) => console.error(`Gym document cleanup failed: ${error?.code ?? "unknown"}`));
  return one(pool, userId, gymId);
}

/** A document of this branch's application → { bytes, mediaType }; checked by the caller's route */
async function documentFile(pool, gymId, documentId, env = process.env) {
  const [[doc]] = await pool.query("SELECT file_key FROM gym_documents WHERE id = ? AND gym_id = ?", [documentId, gymId]);
  const file = doc ? await readFile(doc.file_key, env) : null;
  if (!file) throw new NotFoundError("That document isn't there any more.");
  return file;
}

// The branch as gymProfile and logos expect it
const gymOfRow = (row) => ({ id: row.id, brand_id: row.brand_id, brand: row.brand, branch: row.branch });

/** PUT …/:id/logo: the gym's logo (the gym admin's own logo module, on the applicant's draft) */
async function setLogo(pool, userId, gymId, logo) {
  const row = await ownRow(pool, userId, gymId);
  if (!rules.EDITABLE.includes(row.status)) throw new ConflictError("Your application is with justFit for review, so it can't be changed now.");
  await logos.setLogo(pool, gymOfRow(row), userId, logo);
  return one(pool, userId, gymId);
}

/** POST …/:id/photos: a gallery photo (the first is the cover), with the profile's limits */
async function addPhoto(pool, userId, gymId, photo, today) {
  const row = await ownRow(pool, userId, gymId);
  if (!rules.EDITABLE.includes(row.status)) throw new ConflictError("Your application is with justFit for review, so it can't be changed now.");
  await gymProfile.addPhoto(pool, gymOfRow(row), userId, photo, today);
  return one(pool, userId, gymId);
}

/** DELETE …/:id/photos/:photoId */
async function removePhoto(pool, userId, gymId, photoId, today) {
  const row = await ownRow(pool, userId, gymId);
  if (!rules.EDITABLE.includes(row.status)) throw new ConflictError("Your application is with justFit for review, so it can't be changed now.");
  await gymProfile.removePhoto(pool, gymOfRow(row), userId, photoId, today);
  return one(pool, userId, gymId);
}

/** The applicant reading their own images and documents: 404 unless the application is theirs */
async function ownDocument(pool, userId, gymId, documentId) {
  await ownRow(pool, userId, gymId);
  return documentFile(pool, gymId, documentId);
}
async function ownPhoto(pool, userId, gymId, photoId) {
  await ownRow(pool, userId, gymId);
  return gymProfile.photoFile(pool, gymId, photoId);
}
async function ownLogo(pool, userId, gymId) {
  const row = await ownRow(pool, userId, gymId);
  return logos.logoFile(pool, row.brand_id);
}

// ─── The Super Admin ──────────────────────────────────────────────────────────────────────────

/** GET /api/admin/portal/gyms/:id/application */
async function forAdmin(pool, gymId) {
  const [[row]] = await pool.query(`SELECT ${APP_COLUMNS}, a.full_name AS applicant_name, a.verified_phone AS applicant_phone ${APP_FROM} LEFT JOIN users a ON a.id = b.applicant_id WHERE g.id = ?`, [gymId]);
  if (!row) throw new NotFoundError("That gym doesn't exist.");
  return {
    ...(await fullApplication(pool, row, { forAdmin: true })),
    applicant: row.applicant_id ? { id: row.applicant_id, name: row.applicant_name?.trim() || "Member", phone: row.applicant_phone ? toE164(row.applicant_phone) : null } : null,
    actions: rules.ADMIN_ACTIONS.filter((a) => rules.ACTIONS[a].from.includes(row.status)),
  };
}

async function adminDocument(pool, gymId, documentId) {
  return documentFile(pool, gymId, documentId);
}
async function adminLogo(pool, gymId) {
  const [[row]] = await pool.query("SELECT brand_id FROM gyms WHERE id = ?", [gymId]);
  if (!row) throw new NotFoundError("That gym doesn't exist.");
  return logos.logoFile(pool, row.brand_id);
}

/**
 * POST /api/admin/portal/gyms/:id/decision { action, note }: one step of the review, with the
 * branch locked so two admins can't decide at once. Approving a member's application makes them
 * the branch's gym admin: their account must still be a member account and work at no gym.
 */
async function decide(pool, adminId, gymId, { action, note }) {
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query(`SELECT g.id, g.status, g.name AS branch, b.name AS brand, b.applicant_id ${APP_FROM} WHERE g.id = ? FOR UPDATE`, [gymId]);
    if (!row) throw new NotFoundError("That gym doesn't exist.");
    const problem = rules.transitionProblem(action, row.status);
    if (problem) throw new ConflictError(problem);
    const to = rules.ACTIONS[action].to;
    if (action === "approve" && row.applicant_id) await makeGymAdmin(db, row.applicant_id, gymId);
    await db.query("UPDATE gyms SET status = ?, status_note = ?, status_changed_at = NOW() WHERE id = ?", [to, note, gymId]);
    await db.query("INSERT INTO gym_status_history (gym_id, action, from_status, to_status, note, by_user, by_admin) VALUES (?, ?, ?, ?, ?, ?, 1)", [gymId, action, row.status, to, note, adminId]);
    await audit(db, adminId, `gym.${action}`.slice(0, 40), "gym", gymId, `${rules.ACTION_WORDS[action]}: “${row.brand}”, ${row.branch} branch`);
  });
  return forAdmin(pool, gymId);
}

// The applicant becomes the branch's gym admin (owner); refused when their account has changed
async function makeGymAdmin(db, userId, gymId) {
  const [[user]] = await db.query("SELECT role FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!user) throw new ConflictError("The account that applied isn't on justFit any more, so nobody would run this gym. Reject it instead.");
  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_staff WHERE user_id = ?", [userId]);
  if (user.role !== "user" || n > 0) throw new ConflictError("The account that applied now works with justFit in another role, so it can't become this gym's admin. Ask them to apply from a member account.");
  await db.query("UPDATE users SET role = 'gym_admin' WHERE id = ?", [userId]);
  await db.query("INSERT INTO gym_staff (user_id, gym_id, kind) VALUES (?, ?, 'owner')", [userId, gymId]);
}

module.exports = {
  documentDir, checkDocument, sendDocument,
  mine, one, start, edit, submit, addDocument, removeDocument, setLogo, addPhoto, removePhoto, ownDocument, ownPhoto, ownLogo,
  forAdmin, adminDocument, adminLogo, decide,
};
