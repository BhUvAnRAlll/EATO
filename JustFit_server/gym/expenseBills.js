// Expense bills: an optional photo of an expense's bill (the electricity bill, a vendor's receipt),
// uploaded from the Add Expense sheet once the expense is saved. The checks and the file handling
// are the payment bills' (gym/paymentReceipts.js) with a folder of their own: EXPENSE_BILL_DIR, by
// default uploads/expense-bills (git-ignored; back it up with the droplet). The row keeps only the
// file's random name; a bill is read through the branch's signed-in route, never from a path in
// the request.
const path = require("node:path");

const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const { inTransaction } = require("./service");

// Same as a payment's bill: any shape, 96 px to 6000 px a side, 3 MB
const billLimits = { maxBytes: 3 * 1024 * 1024, minWidth: 96, minHeight: 96, maxSide: 6000 };
const billDir = (env = process.env) => env.EXPENSE_BILL_DIR || path.join(__dirname, "..", "uploads", "expense-bills");
const files = covers.fileStore(billDir);

/** PUT …/bill { data: base64, mediaType } → { ok, bytes, mediaType } or { ok: false, status, error } */
const checkBill = (body) => covers.checkPhoto(body, billLimits);

/**
 * Puts a checked bill on one of the branch's expenses, replacing the one it had: the new file is
 * written first, the expense then points at it (its row locked), and only then is the old file
 * deleted. Another branch's expense is a 404 and leaves no file behind.
 */
async function setBill(pool, gymId, expenseId, { bytes, mediaType }, env = process.env) {
  const key = await files.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT bill_key FROM gym_expenses WHERE id = ? AND gym_id = ? FOR UPDATE", [expenseId, gymId]);
      if (!row) throw new NotFoundError("That expense isn't at your branch.");
      await conn.query("UPDATE gym_expenses SET bill_key = ? WHERE id = ? AND gym_id = ?", [key, expenseId, gymId]);
      return row.bill_key;
    });
  } catch (error) {
    await files.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await discard(replaced, env);
}

/** Takes the expense's bill off and deletes its file */
async function removeBill(pool, gymId, expenseId, env = process.env) {
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT bill_key FROM gym_expenses WHERE id = ? AND gym_id = ? FOR UPDATE", [expenseId, gymId]);
    if (!row) throw new NotFoundError("That expense isn't at your branch.");
    if (!row.bill_key) return null;
    await conn.query("UPDATE gym_expenses SET bill_key = NULL WHERE id = ? AND gym_id = ?", [expenseId, gymId]);
    return row.bill_key;
  });
  if (removed) await discard(removed, env);
}

/** Deletes a file no expense points at any more (after a replace, a remove or a deleted expense) */
async function discard(key, env = process.env) {
  await files.remove(key, env).catch((error) => console.error(`Expense bill cleanup failed: ${error?.code ?? "unknown"}`));
}

/** The bill of one of the branch's expenses → { bytes, mediaType }; 404 when there is none */
async function billFile(pool, gymId, expenseId, env = process.env) {
  const [[row]] = await pool.query("SELECT bill_key FROM gym_expenses WHERE id = ? AND gym_id = ?", [expenseId, gymId]);
  const file = row?.bill_key ? await files.read(row.bill_key, env) : null;
  if (!file) throw new NotFoundError("That expense has no bill attached.");
  return file;
}

module.exports = { billLimits, billDir, checkBill, setBill, removeBill, discard, billFile, send: covers.send };
