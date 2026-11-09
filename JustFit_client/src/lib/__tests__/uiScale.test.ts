// The proportional scale: narrower phones show the 430-point layout shrunk evenly; wider phones
// are never enlarged; the smallest phones stop at 80%.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UI_DESIGN_WIDTH, UI_MIN_SCALE, uiScaleFor } from "../../constants/uiScale.ts";

describe("uiScaleFor", () => {
  it("is 1 at and above the design width", () => {
    assert.equal(uiScaleFor(UI_DESIGN_WIDTH), 1);
    assert.equal(uiScaleFor(440), 1); // iPhone Pro Max: never enlarged
    assert.equal(uiScaleFor(820), 1); // a tablet
  });
  it("shrinks a narrower phone in proportion", () => {
    assert.equal(uiScaleFor(360).toFixed(3), "0.837"); // a 360-wide Android
    assert.equal(uiScaleFor(375).toFixed(3), "0.872"); // iPhone SE / mini
    assert.equal(uiScaleFor(393).toFixed(3), "0.914"); // iPhone 16
  });
  it("never goes under the minimum, and treats a missing width as 1", () => {
    assert.equal(uiScaleFor(200), UI_MIN_SCALE);
    assert.equal(uiScaleFor(0), 1);
    assert.equal(uiScaleFor(Number.NaN), 1);
  });
});
