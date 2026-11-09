// Kitchens' menus, stock and recipes (pure, unit-tested in __tests__/inventory-rules.test.js;
// Meal Operations phase 2, 2026-11-10). Quantities are in the ingredient's own unit (g, kg, ml, l,
// pcs) with up to 3 decimals; money in whole rupees on the way in, paise in the database.
const { ValidationError } = require("../profile");

const CATEGORIES = ["vegetables", "fruits", "grains", "pulses", "dairy", "meat", "seafood", "eggs", "oils", "spices", "packaging", "other"];
const UNITS = ["g", "kg", "ml", "l", "pcs"];
const MOVE_KINDS = ["purchase", "use", "waste", "adjust"];
const FILTERS = ["all", "low", "out", "expiring"];
const EXPIRING_DAYS = 3; // expiring: on or before this many days from today
const MAX_QUANTITY = 1_000_000;
const MAX_RECIPE_ITEMS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}
function text(value, label, max, { min = 1, required = true } = {}) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new ValidationError(`Add the ${label}.`);
    return null;
  }
  if (typeof value !== "string" || CONTROL.test(value)) throw new ValidationError(`Write the ${label} as plain text.`);
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length < min) throw new ValidationError(`The ${label} is too short.`);
  if (clean.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return clean;
}
/** A quantity: a number from min to 1,000,000, rounded to 3 decimals */
function quantity(value, label, { min = 0, allowZero = true } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > MAX_QUANTITY || (!allowZero && value === 0)) {
    throw new ValidationError(`${label} must be a number${allowZero ? "" : " above 0"} up to ${MAX_QUANTITY.toLocaleString("en-IN")}.`);
  }
  return Math.round(value * 1000) / 1000;
}
function rupeesToPaise(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new ValidationError(`${label} must be from ₹0 to ₹10,00,000.`);
  return Math.round(value * 100);
}

/** POST /ingredients { name, category, unit } */
function ingredientBody(body) {
  onlyFields(body, ["name", "category", "unit"]);
  if (!CATEGORIES.includes(body.category)) throw new ValidationError("Pick the ingredient's category from the list.");
  if (!UNITS.includes(body.unit)) throw new ValidationError("Pick a unit: g, kg, ml, l or pcs.");
  return { name: text(body.name, "ingredient's name", 60, { min: 2 }), category: body.category, unit: body.unit };
}

/** PUT …/inventory/:ingredientId { minQuantity, unitPrice?, supplier?, expiresOn?, storage? } */
function stockDetailsBody(body, today) {
  onlyFields(body, ["minQuantity", "unitPrice", "supplier", "expiresOn", "storage"]);
  let expiresOn = null;
  if (body.expiresOn !== undefined && body.expiresOn !== null) {
    if (typeof body.expiresOn !== "string" || !DATE.test(body.expiresOn) || Number.isNaN(Date.parse(`${body.expiresOn}T00:00:00Z`))) throw new ValidationError("Write the expiry date like 2026-11-30.");
    if (body.expiresOn < addDays(today, -366) || body.expiresOn > addDays(today, 3650)) throw new ValidationError("Pick an expiry date within ten years.");
    expiresOn = body.expiresOn;
  }
  return {
    minQuantity: quantity(body.minQuantity, "The minimum"),
    unitPricePaise: rupeesToPaise(body.unitPrice, "The price"),
    supplier: text(body.supplier, "supplier", 80, { required: false }),
    expiresOn,
    storage: text(body.storage, "storage place", 80, { required: false }),
  };
}

/**
 * POST …/moves { kind, quantity, unitPrice?, note?, override? }: purchase adds, use and waste take
 * away, adjust sets the counted amount. Taking more than is there needs override with a note.
 */
function moveBody(body) {
  onlyFields(body, ["kind", "quantity", "unitPrice", "note", "override"]);
  if (!MOVE_KINDS.includes(body.kind)) throw new ValidationError("Pick Purchase, Use, Waste or Count.");
  const qty = quantity(body.quantity, "The quantity", { allowZero: body.kind === "adjust" });
  if (body.override !== undefined && typeof body.override !== "boolean") throw new ValidationError("Say whether to override the stock check.");
  const note = text(body.note, "note", 120, { required: body.override === true, min: 3 });
  if (body.unitPrice !== undefined && body.kind !== "purchase") throw new ValidationError("Only a purchase has a price.");
  return { kind: body.kind, quantity: qty, unitPricePaise: rupeesToPaise(body.unitPrice, "The price"), note, override: body.override === true };
}

/** POST …/transfer { toKitchenId, quantity, note? } */
function transferBody(body, fromKitchenId) {
  onlyFields(body, ["toKitchenId", "quantity", "note"]);
  if (!Number.isInteger(body.toKitchenId) || body.toKitchenId < 1) throw new ValidationError("Pick the kitchen to send it to.");
  if (body.toKitchenId === fromKitchenId) throw new ValidationError("Pick another kitchen to send it to.");
  return { toKitchenId: body.toKitchenId, quantity: quantity(body.quantity, "The quantity", { allowZero: false }), note: text(body.note, "note", 120, { required: false }) };
}

/**
 * What a move does to a balance: → { change, after } or a problem. Use and waste can't go below 0
 * unless overridden (then the balance stops at 0 and the move records what was taken).
 */
function applyMove(balance, move) {
  if (move.kind === "purchase") return { change: move.quantity, after: round(balance + move.quantity) };
  if (move.kind === "adjust") return { change: round(move.quantity - balance), after: move.quantity };
  const after = round(balance - move.quantity);
  if (after < 0 && !move.override) return { problem: `Only ${balance} in stock. Take less, or override with a reason.` };
  return { change: -move.quantity, after: Math.max(0, after), overridden: after < 0 };
}
const round = (n) => Math.round(n * 1000) / 1000;

/** An item's state today: out (0), low (below its minimum), expiring (within 3 days or past) */
function stockState({ quantity: qty, minQuantity, expiresOn }, today) {
  return {
    out: qty <= 0,
    low: qty > 0 && qty < minQuantity,
    expiring: !!expiresOn && qty > 0 && expiresOn <= addDays(today, EXPIRING_DAYS),
    expired: !!expiresOn && qty > 0 && expiresOn < today,
  };
}

/** ?filter=&search= for a kitchen's inventory */
function inventoryQuery(query) {
  onlyFields(query, ["filter", "search"]);
  const filter = query.filter ?? "all";
  if (!FILTERS.includes(filter)) throw new ValidationError("Filter by all, low, out or expiring.");
  if (query.search !== undefined && typeof query.search !== "string") throw new ValidationError("Search with text.");
  return { filter, search: (query.search ?? "").trim().slice(0, 40) };
}

/** PUT /meals/:id/recipe { prepMinutes, items: [{ ingredientId, quantity }] } */
function recipeBody(body) {
  onlyFields(body, ["prepMinutes", "items"]);
  let prepMinutes = null;
  if (body.prepMinutes !== undefined && body.prepMinutes !== null) {
    if (!Number.isInteger(body.prepMinutes) || body.prepMinutes < 1 || body.prepMinutes > 600) throw new ValidationError("Preparation time must be from 1 to 600 minutes.");
    prepMinutes = body.prepMinutes;
  }
  if (!Array.isArray(body.items) || body.items.length > MAX_RECIPE_ITEMS) throw new ValidationError(`A recipe has up to ${MAX_RECIPE_ITEMS} ingredients.`);
  const seen = new Set();
  const items = body.items.map((item) => {
    onlyFields(item, ["ingredientId", "quantity"]);
    if (!Number.isInteger(item.ingredientId) || item.ingredientId < 1) throw new ValidationError("Pick each ingredient from the list.");
    if (seen.has(item.ingredientId)) throw new ValidationError("Each ingredient once, please.");
    seen.add(item.ingredientId);
    return { ingredientId: item.ingredientId, quantity: quantity(item.quantity, "Each quantity", { allowZero: false }) };
  });
  return { prepMinutes, items };
}

/** PUT /kitchens/:id/menu/:mealId { cooks, available }: cooks false takes the meal off this kitchen */
function menuBody(body) {
  onlyFields(body, ["cooks", "available"]);
  if (typeof body.cooks !== "boolean") throw new ValidationError("Say whether this kitchen cooks the meal.");
  if (body.available !== undefined && typeof body.available !== "boolean") throw new ValidationError("Say whether it's available today.");
  return { cooks: body.cooks, available: body.available ?? true };
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  CATEGORIES, UNITS, MOVE_KINDS, FILTERS, EXPIRING_DAYS, MAX_RECIPE_ITEMS,
  ingredientBody, stockDetailsBody, moveBody, transferBody, applyMove, stockState, inventoryQuery, recipeBody, menuBody, addDays, round,
};
