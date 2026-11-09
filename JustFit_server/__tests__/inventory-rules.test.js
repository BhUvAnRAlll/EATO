// Kitchens' menus, stock and recipes: the pure rules (kitchens/inventoryRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../kitchens/inventoryRules");
const { ValidationError } = require("../profile");

describe("inventory rules", () => {
  it("reads ingredients and stock details", () => {
    assert.deepEqual(rules.ingredientBody({ name: "  Paneer ", category: "dairy", unit: "kg" }), { name: "Paneer", category: "dairy", unit: "kg" });
    for (const bad of [{ name: "P", category: "dairy", unit: "kg" }, { name: "Paneer", category: "cheese", unit: "kg" }, { name: "Paneer", category: "dairy", unit: "lb" }, { name: "Paneer", category: "dairy", unit: "kg", price: 1 }]) {
      assert.throws(() => rules.ingredientBody(bad), ValidationError);
    }
    const d = rules.stockDetailsBody({ minQuantity: 2.5, unitPrice: 380.5, supplier: "Nandini", expiresOn: "2026-11-14", storage: "Cold room" }, "2026-11-10");
    assert.deepEqual(d, { minQuantity: 2.5, unitPricePaise: 38050, supplier: "Nandini", expiresOn: "2026-11-14", storage: "Cold room" });
    for (const bad of [{ minQuantity: -1 }, { minQuantity: 1, expiresOn: "14-11-2026" }, { minQuantity: 1, expiresOn: "2040-01-01" }, { minQuantity: 1, unitPrice: -5 }, { minQuantity: "1" }]) {
      assert.throws(() => rules.stockDetailsBody(bad, "2026-11-10"), ValidationError);
    }
  });

  it("reads moves: a reason for an override, a price only on a purchase", () => {
    assert.deepEqual(rules.moveBody({ kind: "purchase", quantity: 10, unitPrice: 40 }), { kind: "purchase", quantity: 10, unitPricePaise: 4000, note: null, override: false });
    assert.equal(rules.moveBody({ kind: "adjust", quantity: 0 }).quantity, 0, "a count may be 0");
    assert.throws(() => rules.moveBody({ kind: "use", quantity: 0 }), ValidationError);
    assert.throws(() => rules.moveBody({ kind: "use", quantity: 2, override: true }), ValidationError, "an override needs a reason");
    assert.equal(rules.moveBody({ kind: "use", quantity: 2, override: true, note: "Count was wrong" }).override, true);
    assert.throws(() => rules.moveBody({ kind: "use", quantity: 2, unitPrice: 5 }), ValidationError);
    assert.throws(() => rules.moveBody({ kind: "steal", quantity: 2 }), ValidationError);
    assert.throws(() => rules.moveBody({ kind: "use", quantity: 2e7 }), ValidationError);
    assert.throws(() => rules.transferBody({ toKitchenId: 3, quantity: 1 }, 3), ValidationError, "not to itself");
    assert.throws(() => rules.transferBody({ toKitchenId: "4", quantity: 1 }, 3), ValidationError);
    assert.deepEqual(rules.transferBody({ toKitchenId: 4, quantity: 1.2345 }, 3), { toKitchenId: 4, quantity: 1.235, note: null });
  });

  it("applies moves without going below zero unless overridden", () => {
    assert.deepEqual(rules.applyMove(5, { kind: "purchase", quantity: 2.5 }), { change: 2.5, after: 7.5 });
    assert.deepEqual(rules.applyMove(5, { kind: "adjust", quantity: 3 }), { change: -2, after: 3 });
    assert.deepEqual(rules.applyMove(5, { kind: "use", quantity: 2 }), { change: -2, after: 3, overridden: false });
    assert.match(rules.applyMove(1.5, { kind: "waste", quantity: 2 }).problem, /Only 1.5 in stock/);
    assert.deepEqual(rules.applyMove(1.5, { kind: "use", quantity: 2, override: true }), { change: -2, after: 0, overridden: true });
    assert.deepEqual(rules.applyMove(0.1, { kind: "use", quantity: 0.1 }), { change: -0.1, after: 0, overridden: false });
  });

  it("says what state an item is in", () => {
    const today = "2026-11-10";
    assert.deepEqual(rules.stockState({ quantity: 0, minQuantity: 2, expiresOn: null }, today), { out: true, low: false, expiring: false, expired: false });
    assert.deepEqual(rules.stockState({ quantity: 1, minQuantity: 2, expiresOn: "2026-11-13" }, today), { out: false, low: true, expiring: true, expired: false });
    assert.deepEqual(rules.stockState({ quantity: 5, minQuantity: 2, expiresOn: "2026-11-14" }, today), { out: false, low: false, expiring: false, expired: false });
    assert.equal(rules.stockState({ quantity: 5, minQuantity: 2, expiresOn: "2026-11-09" }, today).expired, true);
  });

  it("reads the inventory query, recipes and menu changes", () => {
    assert.deepEqual(rules.inventoryQuery({}), { filter: "all", search: "" });
    assert.throws(() => rules.inventoryQuery({ filter: "fresh" }), ValidationError);
    assert.throws(() => rules.inventoryQuery({ sort: "name" }), ValidationError);
    assert.deepEqual(rules.recipeBody({ prepMinutes: 20, items: [{ ingredientId: 1, quantity: 0.15 }] }), { prepMinutes: 20, items: [{ ingredientId: 1, quantity: 0.15 }] });
    assert.deepEqual(rules.recipeBody({ items: [] }), { prepMinutes: null, items: [] });
    for (const bad of [{ prepMinutes: 0, items: [] }, { items: [{ ingredientId: 1, quantity: 1 }, { ingredientId: 1, quantity: 2 }] }, { items: [{ ingredientId: 1, quantity: 0 }] }, { items: [{ ingredientId: "1", quantity: 1 }] }, { items: Array.from({ length: 31 }, (_, i) => ({ ingredientId: i + 1, quantity: 1 })) }]) {
      assert.throws(() => rules.recipeBody(bad), ValidationError);
    }
    assert.deepEqual(rules.menuBody({ cooks: true }), { cooks: true, available: true });
    assert.throws(() => rules.menuBody({ cooks: "yes" }), ValidationError);
  });
});
