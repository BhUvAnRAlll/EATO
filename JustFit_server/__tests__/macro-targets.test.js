// Adjust targets (macro/targets.js rebalance): typed macros stay, the rest share what's left of
// the calories, and a set that can't add up is refused. Pure: no database.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { rebalance } = require("../macro/targets.js");

const kcalOf = (m) => m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9;
// The goal split for 2200 kcal (what applyUserAdjustment gives before the typed grams)
const split = { proteinG: 150, carbsG: 245, fatG: 68 };

describe("adjust targets: rebalance", () => {
  it("only the calories changed: every macro follows the new calories", () => {
    const m = rebalance(split, {}, 2200);
    assert.ok(Math.abs(kcalOf(m) - 2200) <= 10, `adds up to ${kcalOf(m)}`);
  });

  it("protein typed: carbs and fat share what's left, so the total still matches", () => {
    const m = rebalance(split, { proteinG: 200 }, 2200);
    assert.equal(m.proteinG, 200);
    assert.ok(Math.abs(kcalOf(m) - 2200) <= 10, `adds up to ${kcalOf(m)}`);
    assert.ok(m.carbsG < split.carbsG && m.fatG < split.fatG, "the others gave room");
  });

  it("all three typed and close to the calories: used as typed", () => {
    assert.deepEqual(rebalance(split, { proteinG: 150, carbsG: 250, fatG: 65 }, 2200), { proteinG: 150, carbsG: 250, fatG: 65 });
  });

  it("all three typed and far from the calories: refused with the numbers", () => {
    assert.throws(() => rebalance(split, { proteinG: 150, carbsG: 200, fatG: 67 }, 2600), /add up to 2003 kcal, not 2600/);
  });

  it("typed macros alone over the calories: refused", () => {
    assert.throws(() => rebalance(split, { proteinG: 400, carbsG: 300 }, 2000), /more than your 2000 kcal target/);
  });
});
