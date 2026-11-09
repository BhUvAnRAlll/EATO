// Trainer profiles (Gym Profile Management phase 3, 2026-11-09): the gym admin, or Staff given Gym
// Profile › Trainer profiles, writes a public profile for each trainer login at the branch
// (gym_staff kind 'trainer'). There is one profile per trainer per gym (brand), so it is the same at
// every branch they work at; members see it at those branches while it is switched on. Every query
// is scoped to the caller's branch: a trainer who doesn't work there is a 404. Photos are files on
// the server's disk (TRAINER_PHOTO_DIR, by default uploads/trainer-photos, git-ignored) under names
// the server made, checked from their bytes like member photos.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { audit } = require("../admin/overview");
const covers = require("../fitness/covers");
const rules = require("./trainerProfileRules");
const { inTransaction } = require("./service");

// Square or not, 96 px to 6000 px a side, 3 MB (the phone shrinks them to 512 px first)
const photoLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 96, minHeight: 96, maxSide: 6000 };
const photoDir = (env = process.env) => env.TRAINER_PHOTO_DIR || path.join(__dirname, "..", "uploads", "trainer-photos");
const files = covers.fileStore(photoDir);
const checkTrainerPhoto = (body) => covers.checkPhoto(body, photoLimits);

const masked = (phone) => (phone ? `+91 ••••• •${String(phone).slice(-4)}` : null);

// The branch's trainers with their profiles (or none yet), by name
async function branchRows(db, gym, userId = null) {
  const [rows] = await db.query(
    `SELECT u.id AS user_id, u.full_name, u.verified_phone, p.id, p.photo_key, p.specializations, p.years_experience, p.certifications,
       p.bio, p.availability, p.active, p.updated_at
     FROM gym_staff s JOIN users u ON u.id = s.user_id
     LEFT JOIN gym_trainer_profiles p ON p.brand_id = ? AND p.user_id = s.user_id
     WHERE s.gym_id = ? AND s.kind = 'trainer'${userId ? " AND s.user_id = ?" : ""}
     ORDER BY u.full_name IS NULL, u.full_name, s.added_at`,
    userId ? [gym.brand_id, gym.id, userId] : [gym.brand_id, gym.id],
  );
  return rows;
}

const portalTrainer = (r) => ({
  userId: r.user_id,
  name: rules.displayName(r.full_name),
  phone: masked(r.verified_phone),
  photoUrl: r.photo_key ? `/api/gym/profile/trainers/${encodeURIComponent(r.user_id)}/photo?v=${r.photo_key.slice(0, 8)}` : null,
  ...rules.profileOf(r),
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/** GET /profile/trainers: every trainer login at the branch, with what members see of them */
async function list(pool, gym) {
  return { trainers: (await branchRows(pool, gym)).map(portalTrainer) };
}

// The trainer at this branch, or a 404 (another branch's or a made-up id)
async function oneTrainer(db, gym, userId) {
  const [row] = await branchRows(db, gym, userId);
  if (!row) throw new NotFoundError("That trainer doesn't work at this branch.");
  return row;
}

/** PUT /profile/trainers/:userId: creates the profile or changes it; audited */
async function save(pool, gym, editorId, userId, fields) {
  await inTransaction(pool, async (db) => {
    const row = await oneTrainer(db, gym, userId);
    if (fields.active === true && !rules.displayName(row.full_name)) throw new ValidationError("This trainer hasn't added their name in the justFit app yet. Members can see them once they have.");
    // Column names only from this list; lists and the week stored as JSON text
    const json = (v) => (v === null ? null : JSON.stringify(v));
    const columns = {
      specializations: ["specializations", json], certifications: ["certifications", json], years: ["years_experience", (v) => v],
      bio: ["bio", (v) => v], availability: ["availability", json], active: ["active", (v) => (v ? 1 : 0)],
    };
    const keys = Object.keys(fields);
    const names = keys.map((k) => columns[k][0]);
    const values = keys.map((k) => columns[k][1](fields[k]));
    await db.query(
      `INSERT INTO gym_trainer_profiles (brand_id, user_id, updated_by, ${names.join(", ")}) VALUES (?, ?, ?, ${names.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), ${names.map((n) => `${n} = VALUES(${n})`).join(", ")}`,
      [gym.brand_id, userId, editorId, ...values],
    );
    await audit(db, editorId, "gym.edit", "gym", gym.id, `Edited a trainer's profile at ${gym.brand}’s ${gym.branch} branch`);
  });
  return list(pool, gym);
}

/** PUT /profile/trainers/:userId/photo: the new file first, then the row; the old file after */
async function setPhoto(pool, gym, editorId, userId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (db) => {
      const row = await oneTrainer(db, gym, userId);
      await db.query(
        `INSERT INTO gym_trainer_profiles (brand_id, user_id, updated_by, photo_key) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), photo_key = VALUES(photo_key)`,
        [gym.brand_id, userId, editorId, key],
      );
      await audit(db, editorId, "gym.edit", "gym", gym.id, `Changed a trainer's photo at ${gym.brand}’s ${gym.branch} branch`);
      return row.photo_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await files.remove(replaced, env).catch(() => {});
  return list(pool, gym);
}

/** DELETE /profile/trainers/:userId/photo */
async function removePhoto(pool, gym, editorId, userId, env = process.env) {
  const removed = await inTransaction(pool, async (db) => {
    const row = await oneTrainer(db, gym, userId);
    if (!row.photo_key) return null;
    await db.query("UPDATE gym_trainer_profiles SET photo_key = NULL, updated_by = ? WHERE brand_id = ? AND user_id = ?", [editorId, gym.brand_id, userId]);
    await audit(db, editorId, "gym.edit", "gym", gym.id, `Removed a trainer's photo at ${gym.brand}’s ${gym.branch} branch`);
    return row.photo_key;
  });
  if (removed) await files.remove(removed, env).catch(() => {});
  return list(pool, gym);
}

/** GET /profile/trainers/:userId/photo for the branch's portal logins */
async function photoFile(pool, gym, userId, env = process.env) {
  const row = await oneTrainer(pool, gym, userId);
  const file = row.photo_key ? await files.read(row.photo_key, env) : null;
  if (!file) throw new NotFoundError("That trainer has no photo.");
  return file;
}

// ---- Members ------------------------------------------------------------------------------

/**
 * The trainers members see at a branch: switched on, with a name, and working there now. The id is
 * the profile's own (never the account's); the photo is read through the branch's member route.
 */
async function forMembers(pool, gymId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.photo_key, p.specializations, p.years_experience, p.certifications, p.bio, p.availability, p.active, u.full_name
     FROM gym_trainer_profiles p
     JOIN gyms g ON g.brand_id = p.brand_id AND g.id = ?
     JOIN gym_staff s ON s.gym_id = g.id AND s.user_id = p.user_id AND s.kind = 'trainer'
     JOIN users u ON u.id = p.user_id
     WHERE p.active = 1
     ORDER BY u.full_name, p.id`,
    [gymId],
  );
  return rows
    .filter((r) => rules.displayName(r.full_name))
    .map((r) => {
      const { active, ...profile } = rules.profileOf(r);
      return { id: r.id, name: rules.displayName(r.full_name), photoUrl: r.photo_key ? `/api/gyms/${gymId}/trainers/${r.id}/photo?v=${r.photo_key.slice(0, 8)}` : null, ...profile };
    });
}

/** GET /api/gyms/:id/trainers/:trainerId/photo: only a trainer members can see at that branch */
async function memberPhoto(pool, gymId, profileId, env = process.env) {
  const shown = await forMembers(pool, gymId);
  const [[row]] = shown.some((t) => t.id === profileId) ? await pool.query("SELECT photo_key FROM gym_trainer_profiles WHERE id = ?", [profileId]) : [[null]];
  const file = row?.photo_key ? await files.read(row.photo_key, env) : null;
  if (!file) throw new NotFoundError("That photo isn't there any more.");
  return file;
}

module.exports = { photoLimits, photoDir, checkTrainerPhoto, list, save, setPhoto, removePhoto, photoFile, forMembers, memberPhoto, send: covers.send };
