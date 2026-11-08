// The Macro diary's dates: the day a save goes to once midnight has passed since the day was picked
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { logDateFor } from "../macroDateRules.ts";

describe("logDateFor", () => {
  it("follows the clock when the selected day was today at the time it was picked", () => {
    assert.equal(logDateFor("2026-11-07", "2026-11-07", "2026-11-08"), "2026-11-08");
  });

  it("keeps a past day picked on purpose, before and after midnight", () => {
    assert.equal(logDateFor("2026-11-05", "2026-11-07", "2026-11-07"), "2026-11-05");
    assert.equal(logDateFor("2026-11-05", "2026-11-07", "2026-11-08"), "2026-11-05");
  });

  it("changes nothing while it is still the same day", () => {
    assert.equal(logDateFor("2026-11-07", "2026-11-07", "2026-11-07"), "2026-11-07");
  });

  it("works across a month end", () => {
    assert.equal(logDateFor("2026-11-30", "2026-11-30", "2026-12-01"), "2026-12-01");
  });
});
