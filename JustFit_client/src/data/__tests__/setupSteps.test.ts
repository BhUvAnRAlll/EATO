// Setup's steps and the health check's options (data/setup.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { healthFlagOptionsFor, healthFlagsFor, setupSteps } from "../setup.ts";
import { intakeSteps } from "../coach.ts";

describe("setup steps", () => {
  it("is the personal details only; activity, the body scan and food are coach intake steps", () => {
    assert.deepEqual([...setupSteps], ["personal"]);
    assert.deepEqual([...intakeSteps], ["goal", "experience", "activity", "schedule", "spots", "equipment", "limits", "body", "food", "coach"]);
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
