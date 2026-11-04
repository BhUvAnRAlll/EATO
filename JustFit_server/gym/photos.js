// Gym member photos: Add New Member can take or choose one. The checks and the file handling are
// the program covers' (fitness/covers.js) with a member photo's own limits and folder:
// MEMBER_PHOTO_DIR, by default uploads/member-photos (git-ignored; back it up with the droplet).
// The row keeps only the file's random name; a photo is read through the branch's signed-in
// staff route, never from a path in the request, and never shown to anyone outside the branch.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const { inTransaction } = require("./service");

const photoLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 96, minHeight: 96, maxSide: 6000 };
const photoDir = (env = process.env) => env.MEMBER_PHOTO_DIR || path.join(__dirname, "..", "uploads", "member-photos");
const files = covers.fileStore(photoDir);

/** PUT …/photo { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkMemberPhoto = (body) => covers.checkPhoto(body, photoLimits);

/**
 * Puts a checked photo on one of the branch's members, replacing the one they had: the new file is
 * written first, the member then points at it (their row locked), and only then is the old file
 * deleted. A member of another branch is a 404 and leaves no file behind.
 */
async function setPhoto(pool, gymId, memberId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT photo_key FROM gym_members WHERE id = ? AND gym_id = ? FOR UPDATE", [memberId, gymId]);
      if (!row) throw new NotFoundError("That member isn't at your gym.");
      await conn.query("UPDATE gym_members SET photo_key = ? WHERE id = ? AND gym_id = ?", [key, memberId, gymId]);
      return row.photo_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await files.remove(replaced, env).catch((error) => console.error(`Member photo cleanup failed: ${error?.code ?? "unknown"}`));
}

/** Takes the member's photo off (the initials show again) and deletes its file */
async function removePhoto(pool, gymId, memberId, env = process.env) {
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT photo_key FROM gym_members WHERE id = ? AND gym_id = ? FOR UPDATE", [memberId, gymId]);
    if (!row) throw new NotFoundError("That member isn't at your gym.");
    if (!row.photo_key) return null;
    await conn.query("UPDATE gym_members SET photo_key = NULL WHERE id = ? AND gym_id = ?", [memberId, gymId]);
    return row.photo_key;
  });
  if (removed) await files.remove(removed, env).catch((error) => console.error(`Member photo cleanup failed: ${error?.code ?? "unknown"}`));
}

/** The photo of one of the branch's members → { bytes, mediaType }; 404 when there is none */
async function photoFile(pool, gymId, memberId, env = process.env) {
  const [[row]] = await pool.query("SELECT photo_key FROM gym_members WHERE id = ? AND gym_id = ?", [memberId, gymId]);
  const file = row?.photo_key ? await files.read(row.photo_key, env) : null;
  if (!file) throw new NotFoundError("That member has no photo.");
  return file;
}

module.exports = { photoLimits, photoDir, checkMemberPhoto, setPhoto, removePhoto, photoFile, send: covers.send };
