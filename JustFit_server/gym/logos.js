// Gym logos (2026-11-08, the user's request): each gym prints its own logo at the top right of its
// invoices. The gym admin uploads it from Branch details › Invoice details; it belongs to the gym
// (gym_brands.logo_key), so every branch's invoices carry it. The checks and the file handling are
// the catalogue images' (gym/catalogImages.js, fitness/covers.js) with a folder of their own:
// GYM_LOGO_DIR, by default uploads/gym-logos (git-ignored; back it up with the droplet). The row
// keeps only the file's random name; the logo is read through the gym's signed-in staff routes,
// never from a path in the request, and never shown to anyone outside the gym.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const { audit } = require("../admin/overview");
const covers = require("../fitness/covers");
const { inTransaction } = require("./service");

// Any shape (a wordmark is wide, a mark is square), 64 px to 4000 px a side, 2 MB
const logoLimits = { maxBytes: 2 * 1024 * 1024, minWidth: 64, minHeight: 64, maxSide: 4000 };
const logoDir = (env = process.env) => env.GYM_LOGO_DIR || path.join(__dirname, "..", "uploads", "gym-logos");
const files = covers.fileStore(logoDir);

/** PUT /logo { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkLogo = (body) => covers.checkPhoto(body, logoLimits);

/**
 * Puts a checked logo on the gym, replacing the one it had: the new file is written first, the gym
 * then points at it (its row locked) and the change is audited, and only then is the old file
 * deleted. gym: the caller's branch row (brand_id, brand, branch).
 */
async function setLogo(pool, gym, userId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT logo_key FROM gym_brands WHERE id = ? FOR UPDATE", [gym.brand_id]);
      if (!row) throw new NotFoundError("That gym doesn't exist any more.");
      await conn.query("UPDATE gym_brands SET logo_key = ? WHERE id = ?", [key, gym.brand_id]);
      await audit(conn, userId, "gym.edit", "gym", gym.id, `The gym admin ${row.logo_key ? "replaced" : "added"} ${gym.brand}’s logo`);
      return row.logo_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await discard(replaced, env);
}

/** Takes the gym's logo off and deletes its file */
async function removeLogo(pool, gym, userId, env = process.env) {
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT logo_key FROM gym_brands WHERE id = ? FOR UPDATE", [gym.brand_id]);
    if (!row?.logo_key) return null;
    await conn.query("UPDATE gym_brands SET logo_key = NULL WHERE id = ?", [gym.brand_id]);
    await audit(conn, userId, "gym.edit", "gym", gym.id, `The gym admin removed ${gym.brand}’s logo`);
    return row.logo_key;
  });
  if (removed) await discard(removed, env);
}

/** Deletes a file the gym no longer points at (after a replace or a remove) */
async function discard(key, env = process.env) {
  await files.remove(key, env).catch((error) => console.error(`Gym logo cleanup failed: ${error?.code ?? "unknown"}`));
}

/** The gym's logo → { bytes, mediaType } or null when there is none (or the file is gone) */
async function logoOf(pool, brandId, env = process.env) {
  const [[row]] = await pool.query("SELECT logo_key FROM gym_brands WHERE id = ?", [brandId]);
  return row?.logo_key ? files.read(row.logo_key, env) : null;
}

/** GET /logo: the gym's logo; 404 when there is none */
async function logoFile(pool, brandId, env = process.env) {
  const file = await logoOf(pool, brandId, env);
  if (!file) throw new NotFoundError("Your gym has no logo yet.");
  return file;
}

/**
 * The logo as a data URL for the invoice (the app draws it on the screen and into the PDF without
 * a second signed request), or null. Before migration 2026-12-08 there is no column: the invoice
 * simply has no logo, so invoices keep working.
 */
async function logoDataUrl(pool, brandId, env = process.env) {
  try {
    const file = await logoOf(pool, brandId, env);
    return file ? `data:${file.mediaType};base64,${file.bytes.toString("base64")}` : null;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return null;
    throw error;
  }
}

/** Whether the gym has a logo (Invoice details' logoUrl); false before the migration */
async function hasLogo(pool, brandId) {
  try {
    const [[row]] = await pool.query("SELECT logo_key FROM gym_brands WHERE id = ?", [brandId]);
    return Boolean(row?.logo_key);
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return false;
    throw error;
  }
}

module.exports = { logoLimits, logoDir, checkLogo, setLogo, removeLogo, discard, logoFile, logoDataUrl, hasLogo, send: covers.send };
