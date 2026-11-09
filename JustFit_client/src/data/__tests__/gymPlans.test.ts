import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOG_STATUS, PLAN_PRESETS, pickable } from "../gymDashboard.ts";

describe("Plans / Catalogue (Gym Profile phase 2)", () => {
  it("offers only active plans in months to the forms", () => {
    assert.equal(pickable({ unit: "months" }), true, "an item from before the migration is active");
    assert.equal(pickable({ unit: "months", status: "active" }), true);
    assert.equal(pickable({ unit: "months", status: "inactive" }), false);
    assert.equal(pickable({ unit: "months", status: "archived" }), false);
    assert.equal(pickable({ unit: "days", status: "active" }), false);
    assert.equal(pickable({ unit: null, status: "active" }), true, "services and products have no length");
  });

  it("has the four quick lengths and three statuses", () => {
    assert.deepEqual(PLAN_PRESETS.map((p) => p.months), [1, 3, 6, 12]);
    assert.deepEqual(CATALOG_STATUS.map((c) => c.id), ["active", "inactive", "archived"]);
  });
});
