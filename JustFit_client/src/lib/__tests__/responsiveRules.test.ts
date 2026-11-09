// The responsive sizing rules: layout classes in text units and bounded component scaling.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMPACT, DESIGN_WIDTH, WIDE, layoutSize, scaled, textWidth } from "../responsiveRules.ts";

describe("textWidth", () => {
  it("ignores the phone's text-size setting", () => {
    assert.equal(textWidth(440, 1.15), 440);
    assert.equal(textWidth(360, 1.15), 360);
    assert.equal(textWidth(390, 2), 390);
  });
  it("treats a missing or odd font scale as 1 / bounded", () => {
    assert.equal(textWidth(390, 0), 390);
    assert.equal(textWidth(400, 0.1), 800); // a smaller setting still counts (never below 0.5)
  });
});

describe("layoutSize", () => {
  const cases: [string, number, number, string][] = [
    ["iPhone SE / 13 mini at default text", 375, 1, "wide"],
    ["320-wide phone", 320, 1, "compact"],
    ["350-wide phone", 350, 1, "regular"],
    ["360-wide Android at 1.15 text (same as an iPhone)", 360, 1.15, "wide"],
    ["360-wide Android at 1.0", 360, 1, "wide"],
    ["iPhone 16/17 at default text", 393, 1, "wide"],
    ["iPhone 16 with larger text", 393, 1.3, "wide"],
    ["412-wide Android", 412, 1, "wide"],
    ["iPhone Pro Max", 440, 1, "wide"],
    ["iPhone Pro Max at 1.3", 440, 1.3, "wide"],
  ];
  for (const [name, width, scale, expected] of cases) {
    it(`${name} → ${expected}`, () => assert.equal(layoutSize(width, scale), expected));
  }
  it("uses the documented breakpoints", () => {
    assert.equal(layoutSize(COMPACT - 1, 1), "compact");
    assert.equal(layoutSize(COMPACT, 1), "regular");
    assert.equal(layoutSize(WIDE - 1, 1), "regular");
    assert.equal(layoutSize(WIDE, 1), "wide");
  });
});

describe("scaled", () => {
  it("is the design size at the design width", () => assert.equal(scaled(120, DESIGN_WIDTH), 120));
  it("follows the screen in proportion", () => assert.equal(scaled(100, 351), 90));
  it("never goes under the minimum or over the maximum (85% / 115% by default)", () => {
    assert.equal(scaled(100, 200), 85);
    assert.equal(scaled(100, 1000), 115);
  });
  it("takes explicit bounds", () => {
    assert.equal(scaled(140, 320, { min: 130 }), 130);
    assert.equal(scaled(140, 600, { max: 150 }), 150);
  });
});
