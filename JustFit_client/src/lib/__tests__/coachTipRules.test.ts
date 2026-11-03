// The Macro tab's coach tip: only real arithmetic on today's numbers, never a tip without a
// target or before anything is logged, and additions that actually cover the gap.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTEIN_ADDS, coachTip, plannedStill, proteinAdds } from "../coachTipRules.ts";

const targets = { kcal: 2000, proteinG: 120 };

describe("coachTip", () => {
  it("says nothing without targets or before anything is logged", () => {
    assert.equal(coachTip({ kcal: 500, proteinG: 20 }, null, null), null);
    assert.equal(coachTip({ kcal: 0, proteinG: 0 }, targets, null), null);
  });

  it("counts the plan's unlogged meals before calling protein short", () => {
    const tip = coachTip({ kcal: 960, proteinG: 52 }, targets, { kcal: 700, proteinG: 14 });
    assert.equal(tip?.kind, "protein_short");
    assert.match(tip!.message, /52 of 120 g protein/);
    assert.match(tip!.message, /planned meals add 14 g/);
    assert.match(tip!.message, /54 g short/);
    assert.equal(tip!.ask, "How can I reach my protein goal today?");
  });

  it("suggests additions that together cover the gap", () => {
    for (const gap of [6, 10, 18, 25, 33]) {
      const adds = proteinAdds(gap);
      assert.ok(adds.length >= 1 && adds.length <= 2);
      assert.ok(adds.reduce((sum, a) => sum + a.proteinG, 0) >= Math.min(gap, PROTEIN_ADDS[0].proteinG + PROTEIN_ADDS[1].proteinG));
    }
    assert.deepEqual(proteinAdds(0), []);
  });

  it("never claims two additions close a gap they don't", () => {
    const tip = coachTip({ kcal: 517, proteinG: 17 }, { kcal: 1800, proteinG: 110 }, { kcal: 900, proteinG: 58 });
    assert.match(tip!.message, /35 g short/);
    assert.match(tip!.message, /\(\+18 g\) and .*\(\+15 g\) to close most of it\./);
    const small = coachTip({ kcal: 900, proteinG: 90 }, targets, { kcal: 400, proteinG: 15 });
    assert.doesNotMatch(small!.message, /most of it/);
  });

  it("says the plan has it covered when the planned meals close the gap", () => {
    const tip = coachTip({ kcal: 900, proteinG: 70 }, targets, { kcal: 800, proteinG: 48 });
    assert.equal(tip?.kind, "protein_covered");
    assert.match(tip!.message, /add 48 g/);
  });

  it("stays quiet when protein is met and there's no plan to point at", () => {
    assert.equal(coachTip({ kcal: 1500, proteinG: 118 }, targets, null), null);
  });

  it("flags a day more than 5% over its calories, ahead of protein", () => {
    const tip = coachTip({ kcal: 2300, proteinG: 40 }, targets, null);
    assert.equal(tip?.kind, "over_kcal");
    assert.match(tip!.message, /300 kcal over/);
    assert.equal(coachTip({ kcal: 2080, proteinG: 118 }, targets, null), null);
  });

  it("never shows a negative or fractional figure", () => {
    const tip = coachTip({ kcal: 300.6, proteinG: 10.4 }, { kcal: 1999.5, proteinG: 99.7 }, { kcal: 0, proteinG: -3 });
    assert.ok(tip && !/-\d|\d\.\d/.test(tip.message), tip?.message ?? "no tip");
  });
});

describe("plannedStill", () => {
  const meal = (slot: "breakfast" | "morning_snack" | "lunch" | "evening_snack" | "dinner", proteinG: number, logged = false) => ({ slot, logged, totals: { kcal: proteinG * 10, proteinG } });
  it("adds only the plan's meals still to come", () => {
    assert.deepEqual(plannedStill([meal("breakfast", 18, true), meal("evening_snack", 14), meal("dinner", 30)], []), { kcal: 440, proteinG: 44 });
  });
  it("doesn't count a planned meal whose slot was logged by hand", () => {
    assert.equal(plannedStill([meal("lunch", 34), meal("dinner", 30)], ["lunch"]).proteinG, 30);
    assert.equal(plannedStill([meal("morning_snack", 8), meal("evening_snack", 14)], ["snack"]).proteinG, 0);
  });
});
