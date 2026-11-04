// Fitness program cover photos: the checks on an upload (pure, unit-tested) and the files on the
// server's disk. The admin uploads a cover from Admin › Programs; members see it on the Fitness tab
// through a signed-in route that reads the file named by the program's row, never a path from the
// request. Files live in COVER_DIR (by default uploads/program-covers, git-ignored), each under a
// new random name, so a replaced cover is a new file and the old one is deleted after the switch.
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { decodeBase64, sniffMediaType } = require("../bodyComposition/upload");

const coverLimits = { maxBytes: 2 * 1024 * 1024, minWidth: 320, minHeight: 180, maxSide: 6000 };
const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MEDIA_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
// The only names a cover file can have: a UUID and one of the three extensions
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

/** An image's width and height from its header, or null when the header can't be read */
function imageSize(bytes, mediaType) {
  if (mediaType === "image/png") {
    if (bytes.length < 24) return null;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (mediaType === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      // SOF0..SOF15 (not DHT C4, JPG C8 or DAC CC) carry the frame's size
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) };
      }
      i += 2 + u16be(bytes, i + 2);
    }
    return null;
  }
  if (mediaType === "image/webp") {
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8 ") return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L") {
      return {
        width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
        height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    return null;
  }
  return null;
}

/**
 * PUT …/cover { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error }.
 * The real type comes from the bytes (JPEG, PNG or WebP only) and must match the label; at most
 * `limits.maxBytes`; at least `limits.minWidth` × `limits.minHeight` and at most `limits.maxSide`
 * on a side. Program covers use coverLimits; gym member photos (gym/photos.js) their own.
 */
function checkPhoto(body, limits) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Send the photo as { data, mediaType }." };
  for (const key of Object.keys(body)) if (!["data", "mediaType"].includes(key)) return { ok: false, status: 400, error: `Unexpected field: ${key}.` };
  const { data, mediaType } = body;
  if (typeof data !== "string" || typeof mediaType !== "string") return { ok: false, status: 400, error: "Send the photo as { data, mediaType }." };
  const bytes = decodeBase64(data);
  if (!bytes) return { ok: false, status: 400, error: "The photo couldn't be read." };
  const actual = sniffMediaType(bytes);
  if (!EXTENSION[actual]) return { ok: false, status: 415, error: "Upload a photo (JPEG, PNG or WebP)." };
  if (actual !== mediaType) return { ok: false, status: 415, error: "The file type doesn't match its contents." };
  if (bytes.length > limits.maxBytes) return { ok: false, status: 413, error: `The photo is too large (max ${limits.maxBytes / (1024 * 1024)} MB).` };
  const size = imageSize(bytes, actual);
  if (!size || size.width < 1 || size.height < 1) return { ok: false, status: 415, error: "The photo couldn't be read." };
  if (size.width < limits.minWidth || size.height < limits.minHeight) {
    return { ok: false, status: 400, error: `The photo is too small (at least ${limits.minWidth} × ${limits.minHeight}).` };
  }
  if (size.width > limits.maxSide || size.height > limits.maxSide) {
    return { ok: false, status: 400, error: `The photo is too big (at most ${limits.maxSide} on a side).` };
  }
  return { ok: true, bytes, mediaType: actual };
}

const checkCover = (body) => checkPhoto(body, coverLimits);

const coverDir = (env = process.env) => env.COVER_DIR || path.join(__dirname, "..", "uploads", "program-covers");
const isKey = (key) => typeof key === "string" && KEY.test(key);
const mediaTypeOf = (key) => MEDIA_TYPE[key.split(".").pop()];

/**
 * Photo files in one folder (`dirOf(env)`): program covers here, gym member photos in gym/photos.js.
 * Each file has a new random name, so a replaced photo is a new file; only names that pass isKey
 * are ever read or deleted, never a path from a request.
 */
function fileStore(dirOf) {
  /** Writes a checked photo under a new name (written in full, then renamed into place) → its key */
  async function save(bytes, mediaType, env = process.env) {
    const dir = dirOf(env);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const key = `${crypto.randomUUID()}.${EXTENSION[mediaType]}`;
    const temp = path.join(dir, `${key}.part`);
    await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, path.join(dir, key));
    return key;
  }

  /** A photo's bytes and type, or null when the key isn't a photo name or the file is gone */
  async function read(key, env = process.env) {
    if (!isKey(key)) return null;
    try {
      return { bytes: await fs.readFile(path.join(dirOf(env), key)), mediaType: mediaTypeOf(key) };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Deletes a photo file; one that is already gone is fine */
  async function remove(key, env = process.env) {
    if (!isKey(key)) return;
    await fs.unlink(path.join(dirOf(env), key)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  return { save, read, remove };
}

const { save, read, remove } = fileStore(coverDir);

/**
 * Answers with a cover's bytes. Its URL changes whenever the cover does (?v=), so the app may keep
 * it a long time, but only for this signed-in user (private). The shared security headers stay
 * (nosniff and a CSP that lets nothing run); only the cache line is replaced.
 */
function send(res, { bytes, mediaType }) {
  res.set({ "Content-Type": mediaType, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=31536000, immutable", "Content-Disposition": "inline" });
  res.end(bytes);
}

module.exports = { coverLimits, imageSize, checkPhoto, checkCover, coverDir, isKey, fileStore, save, read, remove, send };
