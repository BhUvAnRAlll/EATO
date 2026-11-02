// Admin › Exercises › Add with AI: an exercise's equipment is one of the library's names, so the
// plans (which match them exactly) can use it at home or at a center. Pure: no database, no model.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../admin/exerciseRules.js");
const { EQUIPMENT } = require("../coach/planRules.js");

describe("AI exercises: equipment", () => {
  it("free text maps onto the library's names", () => {
    const cases = { Dumbbells: "Dumbbell", "Yoga Mat": "Bodyweight", Chair: "Bodyweight", "Resistance Bands": "Resistance band", "Jump rope": "Rope", "Battle Ropes": "Battle rope", "EZ bar": "Barbell", "Smith machine": "Machine", "Cable crossover": "Cable", "": "Bodyweight", bodyweight: "Bodyweight" };
    for (const [text, name] of Object.entries(cases)) assert.equal(rules.equipmentName(text), name, text);
  });

  it("something unknown is treated as gym kit, never as bodyweight", () => {
    assert.equal(rules.equipmentName("Trampoline"), "Machine");
  });

  it("the answer schema only allows the library's names, and the home lists use the same names", () => {
    const item = rules.draftSchema.properties.exercises?.items ?? JSON.stringify(rules.draftSchema);
    assert.match(JSON.stringify(item), /"enum":\["Bodyweight","Dumbbell"/);
    for (const name of EQUIPMENT.some) assert.ok(rules.EQUIPMENT_NAMES.includes(name), name);
  });

  it("an AI answer with home kit lands in a home plan's equipment", () => {
    const [drafted] = rules.normalizeDrafts({ exercises: [{ name: "Dumbbell Floor Press", muscleGroup: "chest", pattern: rules.PATTERNS[0], equipment: "Dumbbells", difficulty: 1, region: "any", highRisk: false, lowImpact: true, machine: false, timedSec: null, instructions: ["Lie on the floor.", "Press the dumbbells up."] }] }, { taken: [], count: 1 }).added;
    assert.ok(drafted, "the exercise was kept");
    assert.equal(drafted.equipment, "Dumbbell");
    assert.ok(EQUIPMENT.some.includes(drafted.equipment));
  });
});
