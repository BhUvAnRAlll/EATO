// The built-in food list (data/foods.ts) and its search and maths (lib/foods.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FOODS } from "../../data/foods.ts";
import { findFood, nutrientsFor, rescale, searchFoods, unitsFor } from "../foods.ts";

describe("food list", () => {
  it("has unique ids and sane numbers", () => {
    assert.equal(new Set(FOODS.map((f) => f.id)).size, FOODS.length);
    for (const f of FOODS) {
      const { kcal, proteinG, carbsG, fatG } = f.per100;
      assert.ok(kcal >= 0 && kcal <= 900 && proteinG >= 0 && carbsG >= 0 && fatG >= 0 && proteinG + carbsG + fatG <= 100, f.name);
      if (f.pieceG !== null) assert.ok(f.pieceG > 0, f.name);
    }
  });

  it("each food's calories roughly agree with its macros (catches typos)", () => {
    for (const f of FOODS) {
      const { kcal, proteinG, carbsG, fatG } = f.per100;
      const fromMacros = proteinG * 4 + carbsG * 4 + fatG * 9;
      if (kcal < 25) continue; // tea, coffee, salad: rounding dominates
      assert.ok(Math.abs(fromMacros - kcal) / kcal <= 0.15, `${f.name}: ${kcal} kcal vs ${Math.round(fromMacros)} from macros`);
    }
  });
});

describe("food search", () => {
  it("finds by name and by other names, best match first", () => {
    assert.equal(searchFoods("idli")[0].name, "Idli");
    assert.equal(searchFoods("chapati")[0].name, "Roti / chapati");
    assert.equal(searchFoods("dahi")[0].name, "Curd");
    assert.ok(searchFoods("paneer").every((f) => /paneer/i.test(f.name + f.aka.join(" "))));
    assert.ok(searchFoods("paneer").length <= 5);
  });

  it("needs two letters and finds nothing for nonsense", () => {
    assert.deepEqual(searchFoods("d"), []);
    assert.deepEqual(searchFoods("zzqx"), []);
  });
});

describe("food maths", () => {
  const roti = findFood("roti-chapati")!;
  const milk = findFood("toned-milk")!;
  const rice = findFood("steamed-rice")!;

  it("scales per 100 g and per piece", () => {
    assert.deepEqual(nutrientsFor(rice, 200, "g"), { kcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6 });
    assert.deepEqual(nutrientsFor(roti, 2, "piece"), nutrientsFor(roti, 80, "g"));
    assert.equal(nutrientsFor(rice, 1, "piece"), null, "rice has no piece weight");
    assert.equal(nutrientsFor(rice, 0, "g"), null);
  });

  it("offers the units that make sense", () => {
    assert.deepEqual(unitsFor(roti), ["g", "piece"]);
    assert.deepEqual(unitsFor(milk), ["ml"]);
    assert.deepEqual(unitsFor(rice), ["g"]);
    assert.deepEqual(unitsFor(null), ["g", "ml", "piece"]);
  });

  it("rescales an estimate to a new amount", () => {
    assert.deepEqual(rescale({ kcal: 300, proteinG: 10, carbsG: 40, fatG: 10 }, 200, 100), { kcal: 150, proteinG: 5, carbsG: 20, fatG: 5 });
    assert.equal(rescale({ kcal: 300, proteinG: 10, carbsG: 40, fatG: 10 }, 0, 100), null);
  });
});
