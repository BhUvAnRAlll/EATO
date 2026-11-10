// Setup's steps and the health check's options (data/setup.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { healthFlagOptionsFor, healthFlagsFor, setupSteps } from "../setup.ts";
import { intakeSteps } from "../coach.ts";

describe("setup steps", () => {
  it("has no body composition step; the scan is the coach intake's Body step", () => {
    assert.deepEqual([...setupSteps], ["personal", "goal", "activity", "food", "lifestyle", "targets"]);
    assert.equal(intakeSteps.indexOf("body"), intakeSteps.indexOf("limits") + 1);
    assert.equal(intakeSteps.length, 10);
  });
});

describe("health check options", () => {
  it("a male member isn't asked about pregnancy or breastfeeding", () => {
    const ids = (gender: Parameters<typeof healthFlagOptionsFor>[0]) => healthFlagOptionsFor(gender).map((o) => o.id);
    assert.deepEqual(ids("male"), ["medical_condition", "eating_disorder"]);
    for (const gender of ["female", "other", "unspecified", null] as const) assert.ok(ids(gender).includes("pregnant"), String(gender));
  });

  it("drops a pregnancy tick once the member says they are male, and keeps the rest", () => {
    assert.deepEqual(healthFlagsFor("male", ["pregnant", "breastfeeding", "medical_condition"]), ["medical_condition"]);
    assert.deepEqual(healthFlagsFor("female", ["pregnant"]), ["pregnant"]);
  });
});
