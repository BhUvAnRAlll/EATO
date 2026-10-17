// Member-uploaded images for posts, stories and group covers. The bytes are written to
// uploads/<id>.<ext> on this server (never into the database) and the row in
// community_media records who uploaded what. Files are served only to signed-in members
// through GET /api/media/:id, never as public static files, and the path is built from
// the row's id and type, never from anything the request sends.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { checkUpload } = require("../bodyComposition/upload");
const { ValidationError } = require("../profile");

const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "..", "uploads");

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const filePath = (id, mediaType) => path.join(UPLOAD_DIR, `${id}.${EXTENSIONS[mediaType]}`);

// { data: base64, mediaType } → the stored media row. Images only (a PDF is refused).
async function storeImage(pool, userId, body) {
  const upload = checkUpload(body);
  if (!upload.ok) {
    const error = new ValidationError(upload.error);
    error.status = upload.status;
    throw error;
  }
  if (!EXTENSIONS[upload.mediaType]) throw new ValidationError("Upload a photo (JPEG, PNG or WebP).");

  const id = randomUUID();
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(filePath(id, upload.mediaType), upload.bytes, { flag: "wx" });
  try {
    await pool.query("INSERT INTO community_media (id, user_id, media_type, byte_size) VALUES (?, ?, ?, ?)", [
      id, userId, upload.mediaType, upload.bytes.length,
    ]);
  } catch (error) {
    await fs.unlink(filePath(id, upload.mediaType)).catch(() => {});
    throw error;
  }
  return { id, mediaType: upload.mediaType, byteSize: upload.bytes.length, url: `/api/media/${id}` };
}

// The row for an id, or null
async function getMedia(pool, id) {
  const [rows] = await pool.query("SELECT id, user_id, media_type, byte_size FROM community_media WHERE id = ?", [id]);
  return rows[0] ?? null;
}

// Where the file for a row is on disk
function pathFor(row) {
  return filePath(row.id, row.media_type);
}

const NOT_AVAILABLE = "That image isn't available. Please upload it again.";

// Checks that a media id the member attached is theirs (so nobody attaches another member's
// upload) and that its file really finished writing, then returns the id
async function assertOwnMedia(pool, mediaId, userId) {
  if (mediaId === null) return null;
  const [row] = await assertOwnMediaList(pool, [mediaId], userId);
  return row.id;
}

// The same check for every photo on a post, in the order given. Returns the rows.
async function assertOwnMediaList(pool, mediaIds, userId) {
  if (mediaIds.length === 0) return [];
  const [rows] = await pool.query("SELECT id, user_id, media_type, byte_size FROM community_media WHERE id IN (?)", [mediaIds]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [];
  for (const id of mediaIds) {
    const row = byId.get(id);
    if (!row || row.user_id !== userId) throw new ValidationError(NOT_AVAILABLE);
    // The row is written after the file, so a missing file means a failed or tampered upload
    await fs.access(pathFor(row)).catch(() => { throw new ValidationError(NOT_AVAILABLE); });
    ordered.push(row);
  }
  return ordered;
}

// Deletes the row and the file (best effort on the file)
async function removeMedia(pool, row) {
  await pool.query("DELETE FROM community_media WHERE id = ?", [row.id]);
  await fs.unlink(pathFor(row)).catch(() => {});
}

// Everything that can hold on to an upload. A post keeps its photos while it is live, for a
// while after a soft delete, and for as long as it has a report (moderation evidence).
// Story rows keep their photo until purgeOldStories removes the row (never if reported).
const DELETED_POST_KEEP_DAYS = 30;
const KEPT_POST_SQL = `(p.deleted_at IS NULL OR p.deleted_at > DATE_SUB(NOW(), INTERVAL ${DELETED_POST_KEEP_DAYS} DAY)
  OR EXISTS (SELECT 1 FROM community_reports r WHERE r.post_id = p.id))`;
const REFERENCED_SQL = `(
  EXISTS (SELECT 1 FROM community_posts p WHERE p.media_id = m.id AND ${KEPT_POST_SQL})
  OR EXISTS (SELECT 1 FROM community_post_media pm JOIN community_posts p ON p.id = pm.post_id WHERE pm.media_id = m.id AND ${KEPT_POST_SQL})
  OR EXISTS (SELECT 1 FROM community_stories s WHERE s.media_id = m.id)
  OR EXISTS (SELECT 1 FROM community_groups g WHERE g.cover_media_id = m.id)
  OR EXISTS (SELECT 1 FROM gyms gy WHERE gy.logo_media_id = m.id OR gy.cover_media_id = m.id)
)`;

// Whether an upload isn't used by any post, story, group cover or gym logo/cover yet (a photo picked for a
// draft). Only then does its uploader see it without the visibility rules; once attached,
// the post's or story's own rules decide, so deleted or ended content is hidden from
// everyone, the uploader included.
async function isUnattached(pool, mediaId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM community_media m WHERE m.id = ?
       AND NOT EXISTS (SELECT 1 FROM community_posts p WHERE p.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM community_post_media pm WHERE pm.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM community_stories s WHERE s.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM community_groups g WHERE g.cover_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM gyms gy WHERE gy.logo_media_id = m.id OR gy.cover_media_id = m.id)`,
    [mediaId],
  );
  return rows.length > 0;
}

// After a photo is taken off a post: if nothing else uses it, the file and row go too
async function removeIfUnreferenced(pool, mediaId) {
  const [rows] = await pool.query(`SELECT m.id, m.media_type FROM community_media m WHERE m.id = ? AND NOT ${REFERENCED_SQL}`, [mediaId]);
  if (rows[0]) await removeMedia(pool, rows[0]);
  return rows.length > 0;
}

const mediaUrl = (id) => (id ? `/api/media/${id}` : null);

// Removes uploads older than `olderThanHours` that nothing refers to (the member picked a
// photo but never posted it, or the post was deleted long ago). Returns how many were
// removed. Run from the server on a timer.
async function removeOrphanedMedia(pool, olderThanHours = 24) {
  const [rows] = await pool.query(
    `SELECT m.id, m.media_type FROM community_media m
     WHERE m.created_at < DATE_SUB(NOW(), INTERVAL ? HOUR) AND NOT ${REFERENCED_SQL}
     LIMIT 500`,
    [olderThanHours],
  );
  for (const row of rows) await removeMedia(pool, row);
  return rows.length;
}

module.exports = { UPLOAD_DIR, storeImage, getMedia, pathFor, assertOwnMedia, assertOwnMediaList, isUnattached, removeMedia, removeIfUnreferenced, removeOrphanedMedia, mediaUrl };
