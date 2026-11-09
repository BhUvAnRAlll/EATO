// Kitchens' menus, stock and recipes (Meal Operations phase 2, 2026-11-10). Super Admin only.
// Every stock change is one stock_moves row written with the stock row locked, so the balance and
// the history always agree; a transfer locks both kitchens' rows in id order (no deadlock).
const { ConflictError, NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { inTransaction } = require("../gym/service");
const rules = require("./inventoryRules");
const kitchenRules = require("./rules");

const num = (v) => Number(v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
const rupees = (paise) => (paise === null || paise === undefined ? null : num(paise) / 100);
const likeOf = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function kitchenExists(db, id, lock = false) {
  const [[row]] = await db.query(`SELECT id, name FROM kitchens WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!row) throw new NotFoundError("That kitchen doesn't exist.");
  return row;
}

// ---- Ingredients ----

const ingredientOf = (r) => ({ id: num(r.id), name: r.name, category: r.category, unit: r.unit });

async function ingredients(pool, search) {
  const [rows] = await pool.query(
    `SELECT * FROM ingredients ${search ? "WHERE name LIKE ?" : ""} ORDER BY name LIMIT 100`,
    search ? [likeOf(search)] : [],
  );
  return { ingredients: rows.map(ingredientOf) };
}

async function addIngredient(pool, fields) {
  try {
    const [result] = await pool.query("INSERT INTO ingredients (name, category, unit) VALUES (?, ?, ?)", [fields.name, fields.category, fields.unit]);
    return { ingredient: { id: result.insertId, ...fields } };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new ConflictError("That ingredient is already on the list. Pick it instead.");
    throw error;
  }
}

// ---- A kitchen's stock ----

function itemOf(r, today) {
  const item = {
    ingredientId: num(r.ingredient_id),
    name: r.name,
    category: r.category,
    unit: r.unit,
    quantity: num(r.quantity),
    minQuantity: num(r.min_quantity),
    unitPrice: rupees(r.unit_price_paise),
    supplier: r.supplier ?? null,
    expiresOn: day(r.expires_on),
    storage: r.storage ?? null,
    updatedAt: iso(r.updated_at),
  };
  return { ...item, ...rules.stockState(item, today) };
}

/**
 * A kitchen's inventory: every item with its state, the counts per filter, the stock's value, and
 * today's use and waste (in rupees at each item's last purchase price, where it has one)
 */
async function inventory(pool, kitchenId, { filter, search }, now = Date.now()) {
  await kitchenExists(pool, kitchenId);
  const today = kitchenRules.indiaNow(now).date;
  const { start, end } = kitchenRules.dayBounds(today);
  const [[rows], [moves]] = await Promise.all([
    pool.query(
      `SELECT s.*, i.name, i.category, i.unit FROM kitchen_stock s JOIN ingredients i ON i.id = s.ingredient_id
       WHERE s.kitchen_id = ? ORDER BY i.name`,
      [kitchenId],
    ),
    pool.query(
      `SELECT m.kind, SUM(-m.quantity * COALESCE(s.unit_price_paise, 0)) AS paise, COUNT(*) AS n FROM stock_moves m
       LEFT JOIN kitchen_stock s ON s.kitchen_id = m.kitchen_id AND s.ingredient_id = m.ingredient_id
       WHERE m.kitchen_id = ? AND m.kind IN ('use', 'waste') AND m.created_at >= FROM_UNIXTIME(?) AND m.created_at < FROM_UNIXTIME(?)
       GROUP BY m.kind`,
      [kitchenId, start, end],
    ),
  ]);
  const all = rows.map((r) => itemOf(r, today));
  const counts = { all: all.length, low: all.filter((i) => i.low).length, out: all.filter((i) => i.out).length, expiring: all.filter((i) => i.expiring).length };
  const words = search.toLowerCase();
  const items = all.filter((i) => (filter === "all" || i[filter]) && (!words || i.name.toLowerCase().includes(words) || (i.supplier ?? "").toLowerCase().includes(words)));
  const today_ = Object.fromEntries(["use", "waste"].map((k) => {
    const m = moves.find((x) => x.kind === k);
    return [k, { moves: num(m?.n ?? 0), value: Math.round(num(m?.paise ?? 0) / 100) }];
  }));
  const value = Math.round(all.reduce((sum, i) => sum + i.quantity * (i.unitPrice ?? 0), 0));
  return { items, counts, value, today: { used: today_.use, wasted: today_.waste } };
}

async function lockedItem(db, kitchenId, ingredientId) {
  const [[row]] = await db.query(
    `SELECT s.*, i.name, i.category, i.unit FROM kitchen_stock s JOIN ingredients i ON i.id = s.ingredient_id
     WHERE s.kitchen_id = ? AND s.ingredient_id = ? FOR UPDATE`,
    [kitchenId, ingredientId],
  );
  return row ?? null;
}
async function ingredientExists(db, ingredientId) {
  const [[row]] = await db.query("SELECT id FROM ingredients WHERE id = ?", [ingredientId]);
  if (!row) throw new NotFoundError("That ingredient isn't on the list.");
}

/** Adds the ingredient to the kitchen (at 0) or changes its minimum, price, supplier, expiry and storage */
async function saveDetails(pool, kitchenId, ingredientId, fields, now = Date.now()) {
  await kitchenExists(pool, kitchenId);
  await ingredientExists(pool, ingredientId);
  await pool.query(
    `INSERT INTO kitchen_stock (kitchen_id, ingredient_id, min_quantity, unit_price_paise, supplier, expires_on, storage) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE min_quantity = VALUES(min_quantity), unit_price_paise = VALUES(unit_price_paise), supplier = VALUES(supplier),
       expires_on = VALUES(expires_on), storage = VALUES(storage)`,
    [kitchenId, ingredientId, fields.minQuantity, fields.unitPricePaise, fields.supplier, fields.expiresOn, fields.storage],
  );
  return item(pool, kitchenId, ingredientId, now);
}

async function item(pool, kitchenId, ingredientId, now = Date.now()) {
  const [[row]] = await pool.query(
    `SELECT s.*, i.name, i.category, i.unit FROM kitchen_stock s JOIN ingredients i ON i.id = s.ingredient_id WHERE s.kitchen_id = ? AND s.ingredient_id = ?`,
    [kitchenId, ingredientId],
  );
  if (!row) throw new NotFoundError("That ingredient isn't in this kitchen's stock.");
  const [moves] = await pool.query(
    `SELECT m.*, k.name AS other_name FROM stock_moves m LEFT JOIN kitchens k ON k.id = m.other_kitchen_id
     WHERE m.kitchen_id = ? AND m.ingredient_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 30`,
    [kitchenId, ingredientId],
  );
  return {
    item: itemOf(row, kitchenRules.indiaNow(now).date),
    moves: moves.map((m) => ({
      id: num(m.id), kind: m.kind, quantity: num(m.quantity), balanceAfter: num(m.balance_after), unitPrice: rupees(m.unit_price_paise),
      note: m.note ?? null, overridden: num(m.overridden) === 1, otherKitchen: m.other_name ?? null, at: iso(m.created_at),
    })),
  };
}

/** A purchase, use, waste or count, with the item locked; a purchase's price becomes the item's */
async function move(pool, kitchenId, ingredientId, body, userId, now = Date.now()) {
  await inTransaction(pool, async (db) => {
    const row = await lockedItem(db, kitchenId, ingredientId);
    if (!row) throw new NotFoundError("Add this ingredient to the kitchen's stock first.");
    const applied = rules.applyMove(num(row.quantity), body);
    if (applied.problem) throw new ConflictError(applied.problem);
    await db.query(
      `UPDATE kitchen_stock SET quantity = ?${body.kind === "purchase" && body.unitPricePaise !== null ? ", unit_price_paise = ?" : ""} WHERE kitchen_id = ? AND ingredient_id = ?`,
      [applied.after, ...(body.kind === "purchase" && body.unitPricePaise !== null ? [body.unitPricePaise] : []), kitchenId, ingredientId],
    );
    await db.query(
      `INSERT INTO stock_moves (kitchen_id, ingredient_id, kind, quantity, balance_after, unit_price_paise, note, overridden, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [kitchenId, ingredientId, body.kind, applied.change, applied.after, body.unitPricePaise, body.note, applied.overridden ? 1 : 0, userId],
    );
  });
  return item(pool, kitchenId, ingredientId, now);
}

/** Sends stock to another kitchen: both rows locked in kitchen-id order, never more than is there */
async function transfer(pool, kitchenId, ingredientId, body, userId, now = Date.now()) {
  await inTransaction(pool, async (db) => {
    const [first, second] = [kitchenId, body.toKitchenId].sort((a, b) => a - b);
    await kitchenExists(db, first, true);
    await kitchenExists(db, second, true);
    const from = await lockedItem(db, kitchenId, ingredientId);
    if (!from) throw new NotFoundError("This kitchen doesn't stock that ingredient.");
    const left = rules.round(num(from.quantity) - body.quantity);
    if (left < 0) throw new ConflictError(`Only ${num(from.quantity)} in stock to send.`);
    await db.query(
      `INSERT INTO kitchen_stock (kitchen_id, ingredient_id, quantity, unit_price_paise) VALUES (?, ?, 0, ?) ON DUPLICATE KEY UPDATE kitchen_id = kitchen_id`,
      [body.toKitchenId, ingredientId, from.unit_price_paise],
    );
    const to = await lockedItem(db, body.toKitchenId, ingredientId);
    const arrived = rules.round(num(to.quantity) + body.quantity);
    await db.query("UPDATE kitchen_stock SET quantity = ? WHERE kitchen_id = ? AND ingredient_id = ?", [left, kitchenId, ingredientId]);
    await db.query("UPDATE kitchen_stock SET quantity = ? WHERE kitchen_id = ? AND ingredient_id = ?", [arrived, body.toKitchenId, ingredientId]);
    await db.query(
      `INSERT INTO stock_moves (kitchen_id, ingredient_id, kind, quantity, balance_after, note, other_kitchen_id, created_by) VALUES
       (?, ?, 'transfer_out', ?, ?, ?, ?, ?), (?, ?, 'transfer_in', ?, ?, ?, ?, ?)`,
      [kitchenId, ingredientId, -body.quantity, left, body.note, body.toKitchenId, userId,
        body.toKitchenId, ingredientId, body.quantity, arrived, body.note, kitchenId, userId],
    );
  });
  return item(pool, kitchenId, ingredientId, now);
}

/** Takes an ingredient off the kitchen's list once none is left (its history stays) */
async function removeItem(pool, kitchenId, ingredientId) {
  return inTransaction(pool, async (db) => {
    const row = await lockedItem(db, kitchenId, ingredientId);
    if (!row) throw new NotFoundError("That ingredient isn't in this kitchen's stock.");
    if (num(row.quantity) > 0) throw new ConflictError("Use, waste or send what's left first, or count it as 0.");
    await db.query("DELETE FROM kitchen_stock WHERE kitchen_id = ? AND ingredient_id = ?", [kitchenId, ingredientId]);
    return { removed: true, name: row.name };
  });
}

// ---- A kitchen's menu ----

/** Every meal on justFit's menu with whether this kitchen cooks it and has it today */
async function menu(pool, kitchenId) {
  await kitchenExists(pool, kitchenId);
  const [rows] = await pool.query(
    `SELECT m.id, m.name, m.diet, m.is_available, km.available AS here, mp.prep_minutes,
       (SELECT COUNT(*) FROM meal_recipes r WHERE r.meal_id = m.id) AS recipe_items
     FROM meals m LEFT JOIN kitchen_meals km ON km.meal_id = m.id AND km.kitchen_id = ? LEFT JOIN meal_prep mp ON mp.meal_id = m.id
     ORDER BY km.meal_id IS NULL, m.name`,
    [kitchenId],
  );
  const meals = rows.map((r) => ({
    id: r.id, name: r.name, diet: r.diet, onMenu: num(r.is_available) === 1, cooks: r.here !== null, available: r.here !== null && num(r.here) === 1,
    prepMinutes: r.prep_minutes === null ? null : num(r.prep_minutes), recipeItems: num(r.recipe_items),
  }));
  return { meals, counts: { cooks: meals.filter((m) => m.cooks).length, available: meals.filter((m) => m.available).length, all: meals.length } };
}

async function setMenu(pool, kitchenId, mealId, { cooks, available }) {
  await kitchenExists(pool, kitchenId);
  const [[meal]] = await pool.query("SELECT id, name FROM meals WHERE id = ?", [mealId]);
  if (!meal) throw new NotFoundError("That meal was deleted.");
  if (cooks) {
    await pool.query("INSERT INTO kitchen_meals (kitchen_id, meal_id, available) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE available = VALUES(available)", [kitchenId, mealId, available ? 1 : 0]);
  } else {
    await pool.query("DELETE FROM kitchen_meals WHERE kitchen_id = ? AND meal_id = ?", [kitchenId, mealId]);
  }
  const { meals } = await menu(pool, kitchenId);
  return { meal: meals.find((m) => m.id === mealId), name: meal.name };
}

// ---- Recipes ----

async function recipe(pool, mealId) {
  const [[meal]] = await pool.query("SELECT m.id, m.name, mp.prep_minutes FROM meals m LEFT JOIN meal_prep mp ON mp.meal_id = m.id WHERE m.id = ?", [mealId]);
  if (!meal) throw new NotFoundError("That meal was deleted.");
  const [rows] = await pool.query(
    "SELECT r.ingredient_id, r.quantity, i.name, i.unit, i.category FROM meal_recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.meal_id = ? ORDER BY i.name",
    [mealId],
  );
  return {
    recipe: {
      mealId: meal.id, mealName: meal.name, prepMinutes: meal.prep_minutes === null ? null : num(meal.prep_minutes),
      items: rows.map((r) => ({ ingredientId: num(r.ingredient_id), name: r.name, unit: r.unit, category: r.category, quantity: num(r.quantity) })),
    },
  };
}

/** Replaces a meal's recipe and preparation time in one transaction */
async function saveRecipe(pool, mealId, { prepMinutes, items }) {
  await inTransaction(pool, async (db) => {
    const [[meal]] = await db.query("SELECT id FROM meals WHERE id = ? FOR UPDATE", [mealId]);
    if (!meal) throw new NotFoundError("That meal was deleted.");
    if (items.length > 0) {
      const [found] = await db.query("SELECT id FROM ingredients WHERE id IN (?)", [items.map((i) => i.ingredientId)]);
      if (found.length !== items.length) throw new ValidationError("Pick each ingredient from the list.");
    }
    await db.query("DELETE FROM meal_recipes WHERE meal_id = ?", [mealId]);
    if (items.length > 0) await db.query("INSERT INTO meal_recipes (meal_id, ingredient_id, quantity) VALUES ?", [items.map((i) => [mealId, i.ingredientId, i.quantity])]);
    if (prepMinutes === null) await db.query("DELETE FROM meal_prep WHERE meal_id = ?", [mealId]);
    else await db.query("INSERT INTO meal_prep (meal_id, prep_minutes) VALUES (?, ?) ON DUPLICATE KEY UPDATE prep_minutes = VALUES(prep_minutes)", [mealId, prepMinutes]);
  });
  return recipe(pool, mealId);
}

/** Every kitchen's low, out and expiring items, for the dashboard (null before migration 2026-12-31) */
async function stockAlerts(pool, now = Date.now()) {
  const today = kitchenRules.indiaNow(now).date;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS items, SUM(quantity <= 0) AS out_count, SUM(quantity > 0 AND quantity < min_quantity) AS low_count,
         SUM(quantity > 0 AND expires_on IS NOT NULL AND expires_on <= ?) AS expiring_count FROM kitchen_stock`,
      [rules.addDays(today, rules.EXPIRING_DAYS)],
    );
    return { items: num(row.items), low: num(row.low_count ?? 0), out: num(row.out_count ?? 0), expiring: num(row.expiring_count ?? 0) };
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return null;
    throw error;
  }
}

module.exports = { ingredients, addIngredient, inventory, saveDetails, item, move, transfer, removeItem, menu, setMenu, recipe, saveRecipe, stockAlerts };
