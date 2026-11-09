// A member's plan on Members' cards, the ⋯ sheet and the member's page (data/gymDashboard.ts):
// the catalogue plan's name with its length, or the length alone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memberPlanText, ptPackageText } from "../gymDashboard.ts";

describe("memberPlanText", () => {
  it("names the plan with its length", () => {
    assert.equal(memberPlanText({ planName: "Gold", planLength: { duration: 3, unit: "months" } }), "Gold · 3 Months");
  });
  it("says only the length for a custom plan or one saved before plan names", () => {
    assert.equal(memberPlanText({ planName: null, planLength: { duration: 1, unit: "months" } }), "1 Month");
    assert.equal(memberPlanText({ planName: "  ", planLength: { duration: 15, unit: "days" } }), "15 Days");
  });
  it("doesn't say the length twice when the plan is named after it", () => {
    assert.equal(memberPlanText({ planName: "3 months", planLength: { duration: 3, unit: "months" } }), "3 Months");
  });
});

describe("ptPackageText", () => {
  it("puts PT before a package's name", () => {
    assert.equal(ptPackageText("12 sessions"), "PT · 12 sessions");
    assert.equal(ptPackageText("1 Month"), "PT · 1 Month");
  });
  it("doesn't say PT twice when the name starts with it", () => {
    assert.equal(ptPackageText("PT 12 sessions"), "PT 12 sessions");
    assert.equal(ptPackageText("pt - monthly"), "pt - monthly");
    assert.equal(ptPackageText(" PT"), "PT");
  });
  it("keeps PT for a name that only begins with the letters", () => {
    assert.equal(ptPackageText("Pture yoga"), "PT · Pture yoga");
  });
});
