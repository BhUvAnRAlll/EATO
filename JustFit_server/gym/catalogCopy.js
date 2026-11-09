// Duplicate a plan, PT package, service or product (Gym Hub ecosystem, the brief's plan management,
// 2026-11-10): the copy keeps the price, length, stock, "What's included" and benefits, is named
// "<name> (copy)", starts Inactive (members don't see it until it's switched on) and is never the
// Best value. It goes through service.addItem, so the branch's item limit and order still hold. Only
// this branch's items can be copied.
const { NotFoundError } = require("../errors");
const service = require("./service");
const discoverRules = require("./discoverRules");

async function duplicate(pool, gymId, userId, itemId) {
  const withOptions = await service.hasPlanOptions(pool);
  const [[row]] = await pool.query(`SELECT * FROM gym_catalog_items WHERE id = ? AND gym_id = ?`, [itemId, gymId]);
  if (!row) throw new NotFoundError("That item isn't in your catalogue.");
  const name = `${row.name} (copy)`.slice(0, 80);
  const item = {
    kind: row.kind, name, duration: row.duration ?? undefined, unit: row.duration_unit ?? undefined, price: row.price, stock: row.stock ?? undefined,
    ...(row.details !== undefined && row.details !== null ? { details: row.details } : {}),
    ...(withOptions ? { benefits: discoverRules.readBenefits(row.benefits), bestValue: false, status: "inactive" } : {}),
  };
  return service.addItem(pool, gymId, userId, item);
}

module.exports = { duplicate };
