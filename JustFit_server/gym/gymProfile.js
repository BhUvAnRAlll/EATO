// A branch's Gym Profile (Gym Hub phase 2, then Gym Profile Management phase 1, 2026-11-09): the
// description, facilities (the list's and the gym's own), opening hours and closures, contacts and
// links, the photo gallery in order, and which sections members may see. The gym admin (or Staff
// given the Gym Profile options) edits a draft; Publish copies it into published_profile, which is
// all members ever read (gym/discover.js). Removing a photo takes it away at once, from members
// too. Reused from other screens: the address and phone (Invoice details), the place on the map
// (Location & Attendance) and the gym's logo. Every query is scoped
// to the caller's branch (gym.id). Photos are files on the server's disk (GYM_PHOTO_DIR, by default
// uploads/gym-photos, git-ignored; back it up with the droplet) under names the server made, with
// the checks of the catalogue images (fitness/covers.js).
const path = require("node:path");

const { NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { audit } = require("../admin/overview");
const covers = require("../fitness/covers");
const rules = require("./profileRules");
const { inTransaction } = require("./service");

// Any shape, 320 px to 6000 px a side, 3 MB (the phone shrinks them to 1600 px first)
const photoLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 320, minHeight: 240, maxSide: 6000 };
const photoDir = (env = process.env) => env.GYM_PHOTO_DIR || path.join(__dirname, "..", "uploads", "gym-photos");
const files = covers.fileStore(photoDir);

/** POST /profile/photos { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkGymPhoto = (body) => covers.checkPhoto(body, photoLimits);

// photoUrl: read with the session; the key's start changes when the file does
const photoOf = (r) => ({ id: r.id, url: `/api/gym/profile/photos/${r.id}?v=${r.image_key.slice(0, 8)}` });

// The draft's columns (Gym Profile, migration 2026-12-21): what the gym edits; members read the
// published copy (published_profile) instead
const DRAFT_COLUMNS = `about, facilities, opening_hours, custom_facilities, closures, profile_show, address, phone, whatsapp, email, website,
  instagram, facebook, latitude, profile_edited_at, published_profile, published_at, published_by`;
// Whether gyms has gym_types yet (migration 2027-01-23), asked once a minute while it's missing
let typesColumn = { has: false, at: 0 };
async function hasGymTypes(db) {
  if (typesColumn.has || Date.now() - typesColumn.at < 60000) return typesColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'gym_types'");
  typesColumn = { has: Number(row.n) > 0, at: Date.now() };
  return typesColumn.has;
}
const photosOf = (db, gymId) =>
  db.query("SELECT id, image_key FROM gym_photos WHERE gym_id = ? ORDER BY sort_order, id LIMIT ?", [gymId, rules.MAX_PHOTOS]);

/** The draft row and its gallery, in order; db may be a transaction (lock: FOR UPDATE on the branch) */
async function draftOf(db, gymId, lock = false) {
  const types = (await hasGymTypes(db)) ? ", gym_types" : "";
  const [[[row]], [photos]] = await Promise.all([
    db.query(`SELECT ${DRAFT_COLUMNS}${types} FROM gyms WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [gymId]),
    photosOf(db, gymId),
  ]);
  if (!row) throw new NotFoundError("That branch doesn't exist any more.");
  return { row, photos };
}
const iso = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

/** GET /profile: the draft, what members see now (publishing), and what's still missing */
async function profile(pool, gym, today) {
  const [{ row, photos }, [[logo]]] = await Promise.all([draftOf(pool, gym.id), pool.query("SELECT logo_key FROM gym_brands WHERE id = ?", [gym.brand_id])]);
  const ids = photos.map((p) => p.id);
  const draft = rules.snapshot(row, ids, today);
  const published = rules.readPublished(row.published_profile, ids, today);
  const list = rules.checklist(draft, { hasLocation: row.latitude !== null });
  return {
    gym: { name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city },
    about: draft.about,
    types: draft.types,
    // false before migration 2027-01-23: the app hides the kind-of-gym picker
    typesReady: row.gym_types !== undefined,
    facilities: draft.facilities,
    custom: rules.readCustom(row.custom_facilities),
    hours: draft.hours,
    closures: draft.closures,
    show: draft.show,
    contact: draft.contact,
    photos: photos.map(photoOf),
    maxPhotos: rules.MAX_PHOTOS,
    hasLocation: row.latitude !== null,
    hasLogo: Boolean(logo?.logo_key),
    publishing: {
      state: rules.publishState(draft, published),
      publishedAt: iso(row.published_at),
      editedAt: iso(row.profile_edited_at),
      checklist: list,
      problem: rules.publishProblem(list),
    },
  };
}

/** PATCH /profile: the fields given, into the draft; audited */
async function updateProfile(pool, gym, userId, fields, today) {
  // Column names only from this list; JSON columns written as JSON text
  const json = (v) => (v === null ? null : JSON.stringify(v));
  const same = (v) => v;
  const columns = {
    about: ["about", same], types: ["gym_types", json], facilities: ["facilities", json], hours: ["opening_hours", json], custom: ["custom_facilities", json],
    closures: ["closures", json], show: ["profile_show", json], whatsapp: ["whatsapp", same], email: ["email", same],
    website: ["website", same], instagram: ["instagram", same], facebook: ["facebook", same],
  };
  const keys = Object.keys(fields);
  if (fields.types !== undefined && !(await hasGymTypes(pool))) throw Object.assign(new Error("gym types missing"), { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 'gym_types'" });
  await inTransaction(pool, async (db) => {
    await db.query(`UPDATE gyms SET ${keys.map((k) => `${columns[k][0]} = ?`).join(", ")}, profile_edited_at = NOW(3) WHERE id = ?`, [...keys.map((k) => columns[k][1](fields[k])), gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `Edited the draft profile of ${gym.brand}’s ${gym.branch} branch`);
  });
  return profile(pool, gym, today);
}

/**
 * POST /profile/publish: the draft becomes what members see, once the required parts are there.
 * The branch's row is locked so the copy published is the draft as checked.
 */
async function publish(pool, gym, userId, today) {
  await inTransaction(pool, async (db) => {
    const { row, photos } = await draftOf(db, gym.id, true);
    const draft = rules.snapshot(row, photos.map((p) => p.id), today);
    const problem = rules.publishProblem(rules.checklist(draft, { hasLocation: row.latitude !== null }));
    if (problem) throw new ValidationError(problem);
    await db.query("UPDATE gyms SET published_profile = ?, published_at = NOW(3), published_by = ? WHERE id = ?", [JSON.stringify(draft), userId, gym.id]);
    await audit(db, userId, "gym.profile_publish", "gym", gym.id, `Published the profile of ${gym.brand}’s ${gym.branch} branch`);
  });
  return profile(pool, gym, today);
}

/** PUT /profile/photos/order { ids }: the gallery's new order (the first is the cover) */
async function reorderPhotos(pool, gym, userId, body, today) {
  await inTransaction(pool, async (db) => {
    await db.query("SELECT id FROM gyms WHERE id = ? FOR UPDATE", [gym.id]);
    const [rows] = await db.query("SELECT id FROM gym_photos WHERE gym_id = ?", [gym.id]);
    const ids = rules.photoOrder(body, rows.map((r) => r.id));
    for (const [index, id] of ids.entries()) await db.query("UPDATE gym_photos SET sort_order = ? WHERE id = ? AND gym_id = ?", [index + 1, id, gym.id]);
    await db.query("UPDATE gyms SET profile_edited_at = NOW(3) WHERE id = ?", [gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `Reordered the photos of ${gym.brand}’s ${gym.branch} branch`);
  });
  return profile(pool, gym, today);
}

/**
 * Adds a checked photo to the branch's gallery: the file is written first, then the row (with the
 * branch's photos locked, so two uploads can't pass the limit together); a refusal leaves no file.
 */
async function addPhoto(pool, gym, userId, { bytes, mediaType }, today, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  try {
    await inTransaction(pool, async (db) => {
      await db.query("SELECT id FROM gyms WHERE id = ? FOR UPDATE", [gym.id]);
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_photos WHERE gym_id = ?", [gym.id]);
      if (n >= rules.MAX_PHOTOS) throw new ValidationError(`A branch can show up to ${rules.MAX_PHOTOS} photos. Remove one first.`);
      const [[{ last }]] = await db.query("SELECT COALESCE(MAX(sort_order), 0) AS last FROM gym_photos WHERE gym_id = ?", [gym.id]);
      await db.query("INSERT INTO gym_photos (gym_id, image_key, sort_order, created_by) VALUES (?, ?, ?, ?)", [gym.id, key, Number(last) + 1, userId]);
      await db.query("UPDATE gyms SET profile_edited_at = NOW(3) WHERE id = ?", [gym.id]);
      await audit(db, userId, "gym.edit", "gym", gym.id, `Added a photo to ${gym.brand}’s ${gym.branch} branch`);
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  return profile(pool, gym, today);
}

/** DELETE /profile/photos/:id: another branch's photo is a 404; the file goes after the row */
async function removePhoto(pool, gym, userId, photoId, today, env = process.env) {
  const key = await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT image_key FROM gym_photos WHERE id = ? AND gym_id = ? FOR UPDATE", [photoId, gym.id]);
    if (!row) throw new NotFoundError("That photo isn't in your gallery.");
    await db.query("DELETE FROM gym_photos WHERE id = ? AND gym_id = ?", [photoId, gym.id]);
    await db.query("UPDATE gyms SET profile_edited_at = NOW(3) WHERE id = ?", [gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `Removed a photo from ${gym.brand}’s ${gym.branch} branch`);
    return row.image_key;
  });
  await files.remove(key, env).catch((error) => console.error(`Gym photo cleanup failed: ${error?.code ?? "unknown"}`));
  return profile(pool, gym, today);
}

/** GET /profile/photos/:id → { bytes, mediaType }; another branch's photo is a 404 */
async function photoFile(pool, gymId, photoId, env = process.env) {
  const [[row]] = await pool.query("SELECT image_key FROM gym_photos WHERE id = ? AND gym_id = ?", [photoId, gymId]);
  const file = row ? await files.read(row.image_key, env) : null;
  if (!file) throw new NotFoundError("That photo isn't in your gallery.");
  return file;
}

module.exports = { hasGymTypes, photoLimits, photoDir, checkGymPhoto, draftOf, profile, updateProfile, publish, reorderPhotos, addPhoto, removePhoto, photoFile, send: covers.send };
