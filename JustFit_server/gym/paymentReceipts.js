// Payment bills: Add Member's last step has "Attach the payment bill", a photo of the plan
// payment's receipt, uploaded once the admission is saved and kept with that payment. The checks
// and the file handling are the catalogue images' (gym/catalogImages.js, fitness/covers.js) with a
// folder of their own: PAYMENT_RECEIPT_DIR, by default uploads/payment-receipts (git-ignored; back
// it up with the droplet). The row keeps only the file's random name; a bill is read through the
// branch's signed-in staff route, never from a path in the request, and never shown to anyone
// outside the branch.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const { inTransaction } = require("./service");

// A receipt is any shape (a till slip is tall), 96 px to 6000 px a side, 3 MB
const receiptLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 96, minHeight: 96, maxSide: 6000 };
const receiptDir = (env = process.env) => env.PAYMENT_RECEIPT_DIR || path.join(__dirname, "..", "uploads", "payment-receipts");
const files = covers.fileStore(receiptDir);

/** PUT …/receipt { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkReceipt = (body) => covers.checkPhoto(body, receiptLimits);

/**
 * Puts a checked bill on one of the branch's payments, replacing the one it had: the new file is
 * written first, the payment then points at it (its row locked), and only then is the old file
 * deleted. A payment of another branch is a 404 and leaves no file behind.
 */
async function setReceipt(pool, gymId, paymentId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT receipt_key FROM gym_payments WHERE id = ? AND gym_id = ? FOR UPDATE", [paymentId, gymId]);
      if (!row) throw new NotFoundError("That payment isn't at your gym.");
      await conn.query("UPDATE gym_payments SET receipt_key = ? WHERE id = ? AND gym_id = ?", [key, paymentId, gymId]);
      return row.receipt_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await discard(replaced, env);
}

/** Takes the payment's bill off and deletes its file */
async function removeReceipt(pool, gymId, paymentId, env = process.env) {
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT receipt_key FROM gym_payments WHERE id = ? AND gym_id = ? FOR UPDATE", [paymentId, gymId]);
    if (!row) throw new NotFoundError("That payment isn't at your gym.");
    if (!row.receipt_key) return null;
    await conn.query("UPDATE gym_payments SET receipt_key = NULL WHERE id = ? AND gym_id = ?", [paymentId, gymId]);
    return row.receipt_key;
  });
  if (removed) await discard(removed, env);
}

/** Deletes a file a payment no longer points at (after a replace or a remove) */
async function discard(key, env = process.env) {
  await files.remove(key, env).catch((error) => console.error(`Payment bill cleanup failed: ${error?.code ?? "unknown"}`));
}

/** The bill of one of the branch's payments → { bytes, mediaType }; 404 when there is none */
async function receiptFile(pool, gymId, paymentId, env = process.env) {
  const [[row]] = await pool.query("SELECT receipt_key FROM gym_payments WHERE id = ? AND gym_id = ?", [paymentId, gymId]);
  const file = row?.receipt_key ? await files.read(row.receipt_key, env) : null;
  if (!file) throw new NotFoundError("That payment has no bill attached.");
  return file;
}

module.exports = { receiptLimits, receiptDir, checkReceipt, setReceipt, removeReceipt, discard, receiptFile, send: covers.send };
