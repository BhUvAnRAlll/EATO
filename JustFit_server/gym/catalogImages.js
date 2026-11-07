// Catalogue item images: Add Plan (and Edit) in Plans / Catalogue can attach an optional picture of a
// plan, PT package, service or product, for example a brochure photo. The checks and the file
// handling are the member photos' (gym/photos.js, fitness/covers.js) with a folder of their own:
// CATALOG_IMAGE_DIR, by default uploads/catalog-images (git-ignored; back it up with the droplet).
// The row keeps only the file's random name; an image is read through the branch's signed-in
// staff route, never from a path in the request, and never shown to anyone outside the branch.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const { inTransaction } = require("./service");

// Not cropped square like a member photo: a brochure is any shape, 96 px to 6000 px a side, 3 MB
const imageLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 96, minHeight: 96, maxSide: 6000 };
const imageDir = (env = process.env) => env.CATALOG_IMAGE_DIR || path.join(__dirname, "..", "uploads", "catalog-images");
const files = covers.fileStore(imageDir);

/** PUT …/image { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkItemImage = (body) => covers.checkPhoto(body, imageLimits);

/**
 * Puts a checked image on one of the branch's catalogue items, replacing the one it had: the new
 * file is written first, the item then points at it (its row locked), and only then is the old
 * file deleted. An item of another branch is a 404 and leaves no file behind.
 */
async function setImage(pool, gymId, itemId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT image_key FROM gym_catalog_items WHERE id = ? AND gym_id = ? FOR UPDATE", [itemId, gymId]);
      if (!row) throw new NotFoundError("That item isn't in your catalogue.");
      await conn.query("UPDATE gym_catalog_items SET image_key = ? WHERE id = ? AND gym_id = ?", [key, itemId, gymId]);
      return row.image_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await discard(replaced, env);
}

/** Takes the item's image off and deletes its file */
async function removeImage(pool, gymId, itemId, env = process.env) {
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT image_key FROM gym_catalog_items WHERE id = ? AND gym_id = ? FOR UPDATE", [itemId, gymId]);
    if (!row) throw new NotFoundError("That item isn't in your catalogue.");
    if (!row.image_key) return null;
    await conn.query("UPDATE gym_catalog_items SET image_key = NULL WHERE id = ? AND gym_id = ?", [itemId, gymId]);
    return row.image_key;
  });
  if (removed) await discard(removed, env);
}

/** Deletes a file an item no longer points at (after a replace, a remove, or the item's deletion) */
async function discard(key, env = process.env) {
  await files.remove(key, env).catch((error) => console.error(`Catalogue image cleanup failed: ${error?.code ?? "unknown"}`));
}

/** The image of one of the branch's items → { bytes, mediaType }; 404 when there is none */
async function imageFile(pool, gymId, itemId, env = process.env) {
  const [[row]] = await pool.query("SELECT image_key FROM gym_catalog_items WHERE id = ? AND gym_id = ?", [itemId, gymId]);
  const file = row?.image_key ? await files.read(row.image_key, env) : null;
  if (!file) throw new NotFoundError("That item has no image.");
  return file;
}

module.exports = { imageLimits, imageDir, checkItemImage, setImage, removeImage, discard, imageFile, send: covers.send };
