// A branch's public profile (Gym Hub phase 2, 2026-11-09): the description, facilities, opening
// hours and photo gallery the gym admin fills in from Settings › Public profile, beside what the
// branch already has: its address and phone (Invoice details), its place on the map (Location &
// Attendance) and the gym's logo. Members will read it when they discover gyms (phase 3); here only
// the branch's own portal logins read it, and only the gym admin changes it. Every query is scoped
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

/** GET /profile: what members will see of this branch, and what's still missing */
async function profile(pool, gym) {
  const [[[row]], [photos], [[logo]]] = await Promise.all([
    pool.query("SELECT about, facilities, opening_hours, address, phone, latitude FROM gyms WHERE id = ?", [gym.id]),
    pool.query("SELECT id, image_key FROM gym_photos WHERE gym_id = ? ORDER BY id LIMIT ?", [gym.id, rules.MAX_PHOTOS]),
    pool.query("SELECT logo_key FROM gym_brands WHERE id = ?", [gym.brand_id]),
  ]);
  if (!row) throw new NotFoundError("That branch doesn't exist any more.");
  return {
    gym: { name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city },
    about: row.about ?? null,
    facilities: rules.readFacilities(row.facilities),
    hours: rules.readHours(row.opening_hours),
    photos: photos.map(photoOf),
    maxPhotos: rules.MAX_PHOTOS,
    // Reused from other screens: shown here so the gym admin knows what members see
    contact: { address: row.address ?? null, phone: row.phone ?? null },
    hasLocation: row.latitude !== null,
    hasLogo: Boolean(logo?.logo_key),
  };
}

/** PATCH /profile: the fields given; audited */
async function updateProfile(pool, gym, userId, fields) {
  // Column names only from this list; JSON columns written as JSON text
  const columns = { about: ["about", (v) => v], facilities: ["facilities", (v) => JSON.stringify(v)], hours: ["opening_hours", (v) => (v === null ? null : JSON.stringify(v))] };
  const keys = Object.keys(fields);
  await inTransaction(pool, async (db) => {
    await db.query(`UPDATE gyms SET ${keys.map((k) => `${columns[k][0]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => columns[k][1](fields[k])), gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin edited the public profile of ${gym.brand}’s ${gym.branch} branch`);
  });
  return profile(pool, gym);
}

/**
 * Adds a checked photo to the branch's gallery: the file is written first, then the row (with the
 * branch's photos locked, so two uploads can't pass the limit together); a refusal leaves no file.
 */
async function addPhoto(pool, gym, userId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  try {
    await inTransaction(pool, async (db) => {
      await db.query("SELECT id FROM gyms WHERE id = ? FOR UPDATE", [gym.id]);
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_photos WHERE gym_id = ?", [gym.id]);
      if (n >= rules.MAX_PHOTOS) throw new ValidationError(`A branch can show up to ${rules.MAX_PHOTOS} photos. Remove one first.`);
      await db.query("INSERT INTO gym_photos (gym_id, image_key, created_by) VALUES (?, ?, ?)", [gym.id, key, userId]);
      await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin added a photo to ${gym.brand}’s ${gym.branch} branch`);
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  return profile(pool, gym);
}

/** DELETE /profile/photos/:id: another branch's photo is a 404; the file goes after the row */
async function removePhoto(pool, gym, userId, photoId, env = process.env) {
  const key = await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT image_key FROM gym_photos WHERE id = ? AND gym_id = ? FOR UPDATE", [photoId, gym.id]);
    if (!row) throw new NotFoundError("That photo isn't in your gallery.");
    await db.query("DELETE FROM gym_photos WHERE id = ? AND gym_id = ?", [photoId, gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin removed a photo from ${gym.brand}’s ${gym.branch} branch`);
    return row.image_key;
  });
  await files.remove(key, env).catch((error) => console.error(`Gym photo cleanup failed: ${error?.code ?? "unknown"}`));
  return profile(pool, gym);
}

/** GET /profile/photos/:id → { bytes, mediaType }; another branch's photo is a 404 */
async function photoFile(pool, gymId, photoId, env = process.env) {
  const [[row]] = await pool.query("SELECT image_key FROM gym_photos WHERE id = ? AND gym_id = ?", [photoId, gymId]);
  const file = row ? await files.read(row.image_key, env) : null;
  if (!file) throw new NotFoundError("That photo isn't in your gallery.");
  return file;
}

module.exports = { photoLimits, photoDir, checkGymPhoto, profile, updateProfile, addPhoto, removePhoto, photoFile, send: covers.send };
