// Body scans kept (2026-11-10, the user's request): every scan's two photos and its report are
// saved after Forma answers, so the Super Admin can see them (Super Admin › Body scans and a
// member's page) and the member can see and delete their own (Profile › My body scans).
// The files go to BODY_SCAN_DIR (default uploads/body-scans, git-ignored; back it up with the
// droplet) under names the server makes; a row keeps only those names, and the photos are read
// back only through signed-in routes: the member's own, or a justFit admin's.
// Keeping a scan never fails the scan itself: the member still gets their report.
// Table: migrations/2027-01-25-body-scans.sql. Before it nothing is kept and the lists answer 503.
const crypto = require("node:crypto");
const path = require("node:path");

const covers = require("../fitness/covers");
const { NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");

const scanDir = (env = process.env) => env.BODY_SCAN_DIR || path.join(__dirname, "..", "uploads", "body-scans");
const files = covers.fileStore(scanDir);

const PAGE_SIZE = 30;
const MIGRATION = "migrations/2027-01-25-body-scans.sql";

class ScansNotReady extends Error {
  constructor() {
    super(`Body scans need the database update ${MIGRATION}.`);
    this.name = "NotReadyError";
    this.status = 503;
  }
}
const notReady = (error) => error?.code === "ER_NO_SUCH_TABLE";

const iso = (value) => (value ? new Date(value).toISOString() : null);
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value ?? null);
const nameOf = (row) => (row.full_name && row.full_name.trim()) || "justFit member";

// A scan's id from a path: a UUID, anything else reads as missing
function scanId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new NotFoundError("That scan doesn't exist.");
  return value;
}
function view(value) {
  if (value !== "front" && value !== "side") throw new NotFoundError("That photo doesn't exist.");
  return value;
}

/**
 * Keeps a finished scan: both photos (checked JPEG/PNG from checkScanRequest), what the scan was
 * given and the report. Answers the new scan's id, or null when it couldn't be kept (before the
 * migration, or a disk or database failure, which is logged without any of the scan's data).
 */
async function keep(pool, userId, { images, inputs }, estimate, env = process.env) {
  const saved = [];
  try {
    for (const side of ["front", "side"]) {
      const image = images[side];
      saved.push(await files.save(Buffer.from(image.base64, "base64"), image.mediaType, env));
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO body_scans (id, user_id, front_key, side_key, sex, age, height_cm, weight_kg, body_fat_percent, report)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, saved[0], saved[1], inputs.sex, inputs.age, inputs.heightCm, inputs.weightKg, estimate.percentBodyFat, JSON.stringify(estimate.report)],
    );
    return id;
  } catch (error) {
    for (const key of saved) await files.remove(key, env).catch(() => {});
    if (!notReady(error)) console.error(`Keeping a body scan failed: ${error?.code ?? "unknown"}`);
    return null;
  }
}

const summary = (row) => ({
  id: row.id,
  at: iso(row.created_at),
  bodyFatPercent: Number(row.body_fat_percent),
  sex: row.sex,
  age: Number(row.age),
  heightCm: Number(row.height_cm),
  weightKg: Number(row.weight_kg),
});

// The fields a list needs, never the report (large) or the file names
const LIST_COLUMNS = "s.id, s.user_id, s.created_at, s.body_fat_percent, s.sex, s.age, s.height_cm, s.weight_kg";

/** One member's scans, newest first (their own Profile, or a member's page for an admin) */
async function forUser(pool, userId) {
  try {
    const [rows] = await pool.query(`SELECT ${LIST_COLUMNS} FROM body_scans s WHERE s.user_id = ? ORDER BY s.created_at DESC, s.id LIMIT 100`, [userId]);
    return rows.map(summary);
  } catch (error) {
    if (notReady(error)) throw new ScansNotReady();
    throw error;
  }
}

/** ?search=&page= for Super Admin › Body scans */
function listQuery(query) {
  for (const key of Object.keys(query)) if (!["search", "page"].includes(key)) throw new ValidationError("The request has a field we don't expect.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > 80) throw new ValidationError("Search for at most 80 characters.");
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new ValidationError("Pick a page from 1.");
  return { search, page };
}

/** Every member's scans, newest first, with who scanned; a search matches the name or the number */
async function listAll(pool, { search, page }) {
  const params = [];
  let where = "";
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = search.replace(/[\s+-]/g, "").replace(/^91(?=\d{10}$)/, "");
    where = /^\d{4,10}$/.test(digits) ? "WHERE (u.full_name LIKE ? OR u.phone LIKE ?)" : "WHERE u.full_name LIKE ?";
    params.push(like);
    if (/^\d{4,10}$/.test(digits)) params.push(`%${digits}%`);
  }
  try {
    const [rows] = await pool.query(
      `SELECT ${LIST_COLUMNS}, u.full_name FROM body_scans s JOIN users u ON u.id = s.user_id ${where}
       ORDER BY s.created_at DESC, s.id LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM body_scans s JOIN users u ON u.id = s.user_id ${where}`, params);
    return {
      scans: rows.slice(0, PAGE_SIZE).map((row) => ({ ...summary(row), member: { id: row.user_id, name: nameOf(row) } })),
      total: Number(total),
      page,
      nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
    };
  } catch (error) {
    if (notReady(error)) throw new ScansNotReady();
    throw error;
  }
}

async function row(pool, id, userId = null) {
  try {
    const [[found]] = await pool.query(
      `SELECT s.*, u.full_name FROM body_scans s JOIN users u ON u.id = s.user_id WHERE s.id = ?${userId ? " AND s.user_id = ?" : ""}`,
      userId ? [id, userId] : [id],
    );
    if (!found) throw new NotFoundError("That scan doesn't exist.");
    return found;
  } catch (error) {
    if (notReady(error)) throw new ScansNotReady();
    throw error;
  }
}

/** One scan with its report. userId: only that member's (the member's own routes) */
async function detail(pool, id, userId = null) {
  const found = await row(pool, id, userId);
  return { ...summary(found), member: { id: found.user_id, name: nameOf(found) }, report: json(found.report) };
}

/** A scan's front or side photo. userId: only that member's */
async function photo(pool, id, side, userId = null, env = process.env) {
  const found = await row(pool, id, userId);
  const file = await files.read(side === "front" ? found.front_key : found.side_key, env);
  if (!file) throw new NotFoundError("That photo is gone.");
  return { file, member: { id: found.user_id, name: nameOf(found) }, at: found.created_at };
}

/** The member deletes one of their own scans: the row first, then both files */
async function removeOwn(pool, id, userId, env = process.env) {
  const found = await row(pool, id, userId);
  await pool.query("DELETE FROM body_scans WHERE id = ? AND user_id = ?", [id, userId]);
  for (const key of [found.front_key, found.side_key]) {
    await files.remove(key, env).catch((error) => console.error(`Body scan photo cleanup failed: ${error?.code ?? "unknown"}`));
  }
}

// Answers with a scan photo. Unlike program covers, never kept in a cache: a body photo stays on
// the server, and a deleted scan is gone everywhere at once
function send(res, { bytes, mediaType }) {
  res.set({ "Content-Type": mediaType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "Content-Disposition": "inline" });
  res.end(bytes);
}

module.exports = { send, scanDir, keep, forUser, listQuery, listAll, detail, photo, removeOwn, scanId, view, ScansNotReady, PAGE_SIZE };
