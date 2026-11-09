// A member's delivery addresses (Profile › Delivery addresses, 2026-11-09). Every query is scoped
// to the signed-in account (req.userId); an id that isn't theirs reads as missing. The selected
// address is the one with is_default = 1, at most one per member (a unique key on a generated
// column), and the first address saved becomes it.
const { NotFoundError, ConflictError } = require("../errors");
const { inTransaction } = require("../gym/service");
const rules = require("./rules");

const COLUMNS = `a.id, a.kind, a.receiver_name, a.receiver_phone, a.house, a.street, a.landmark, a.city, a.pincode,
  a.formatted_address, a.latitude, a.longitude, a.instructions, a.is_default, a.updated_at,
  (dp.pincode IS NOT NULL) AS deliverable, dp.area AS delivery_area`;
const FROM = "user_addresses a LEFT JOIN delivery_pincodes dp ON dp.pincode = a.pincode AND dp.active = 1";

const addressOf = (r) => ({
  id: r.id,
  kind: r.kind,
  receiverName: r.receiver_name,
  receiverPhone: r.receiver_phone,
  house: r.house,
  street: r.street,
  landmark: r.landmark,
  city: r.city,
  pincode: r.pincode,
  formattedAddress: r.formatted_address,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  instructions: r.instructions,
  isDefault: Number(r.is_default) === 1,
  deliverable: Number(r.deliverable) === 1,
  deliveryArea: r.delivery_area ?? null,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
});

// The selected address first, then the most recently changed
async function list(pool, userId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.user_id = ? ORDER BY a.is_default DESC, a.updated_at DESC, a.id DESC`, [userId]);
  const addresses = rows.map(addressOf);
  return { addresses, selectedId: addresses.find((a) => a.isDefault)?.id ?? null, max: rules.MAX_ADDRESSES };
}

const values = (f) => [f.kind, f.receiverName, f.receiverPhone, f.house, f.street, f.landmark, f.city, f.pincode, f.formattedAddress, f.latitude, f.longitude, f.instructions];

// Locks the member's addresses, so two saves at once can't pass the limit or leave two selected
const lockMine = (db, userId) => db.query("SELECT id, is_default FROM user_addresses WHERE user_id = ? FOR UPDATE", [userId]);

async function makeDefault(db, userId, id) {
  await db.query("UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND is_default = 1 AND id <> ?", [userId, id]);
  await db.query("UPDATE user_addresses SET is_default = 1 WHERE user_id = ? AND id = ?", [userId, id]);
}

async function create(pool, userId, fields) {
  const id = await inTransaction(pool, async (db) => {
    const [mine] = await lockMine(db, userId);
    if (mine.length >= rules.MAX_ADDRESSES) throw new ConflictError(`You can keep ${rules.MAX_ADDRESSES} addresses. Delete one to add another.`);
    const [result] = await db.query(
      `INSERT INTO user_addresses (user_id, kind, receiver_name, receiver_phone, house, street, landmark, city, pincode,
        formatted_address, latitude, longitude, instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, ...values(fields)],
    );
    // The first address is the selected one; a later one only when asked
    if (fields.makeDefault || !mine.some((a) => Number(a.is_default) === 1)) await makeDefault(db, userId, result.insertId);
    return result.insertId;
  });
  return { ...(await list(pool, userId)), savedId: id };
}

async function update(pool, userId, id, fields) {
  await inTransaction(pool, async (db) => {
    const [mine] = await lockMine(db, userId);
    if (!mine.some((a) => a.id === id)) throw new NotFoundError("That address isn't saved on your account.");
    await db.query(
      `UPDATE user_addresses SET kind = ?, receiver_name = ?, receiver_phone = ?, house = ?, street = ?, landmark = ?, city = ?,
        pincode = ?, formatted_address = ?, latitude = ?, longitude = ?, instructions = ? WHERE id = ? AND user_id = ?`,
      [...values(fields), id, userId],
    );
    if (fields.makeDefault) await makeDefault(db, userId, id);
  });
  return { ...(await list(pool, userId)), savedId: id };
}

// Deleting the selected address selects the most recently added one left
async function remove(pool, userId, id) {
  await inTransaction(pool, async (db) => {
    const [mine] = await lockMine(db, userId);
    const gone = mine.find((a) => a.id === id);
    if (!gone) throw new NotFoundError("That address isn't saved on your account.");
    await db.query("DELETE FROM user_addresses WHERE id = ? AND user_id = ?", [id, userId]);
    if (Number(gone.is_default) === 1) {
      const [[next]] = await db.query("SELECT id FROM user_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
      if (next) await makeDefault(db, userId, next.id);
    }
  });
  return list(pool, userId);
}

async function select(pool, userId, id) {
  await inTransaction(pool, async (db) => {
    const [mine] = await lockMine(db, userId);
    if (!mine.some((a) => a.id === id)) throw new NotFoundError("That address isn't saved on your account.");
    await makeDefault(db, userId, id);
  });
  return list(pool, userId);
}

// Whether justFit delivers to a pincode (Select Location checks the pin's before saving)
async function serviceable(pool, pincode) {
  const [[row]] = await pool.query("SELECT area FROM delivery_pincodes WHERE pincode = ? AND active = 1", [pincode]);
  return { pincode, deliverable: Boolean(row), area: row?.area ?? null };
}

// For checkout (not built yet): the member's address, refused unless justFit delivers to its
// pincode today. Checkout must call this with the address id it was given, never trust the app.
async function deliverableAddress(pool, userId, id) {
  const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.id = ? AND a.user_id = ?`, [id, userId]);
  if (!row) throw new NotFoundError("That address isn't saved on your account.");
  const address = addressOf(row);
  if (!address.deliverable) throw new ConflictError(`We don't deliver to ${address.pincode} yet. Pick another address.`);
  return address;
}

module.exports = { list, create, update, remove, select, serviceable, deliverableAddress };
