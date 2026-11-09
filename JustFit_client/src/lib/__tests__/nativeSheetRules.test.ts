// The iPhone action sheet's buttons: Cancel last, red only where asked.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { iosButtons } from "../nativeSheetRules.ts";

describe("iosButtons", () => {
  it("lists the actions in order with Cancel last", () => {
    const b = iosButtons([{ label: "Start from this exercise" }, { label: "How to do it" }]);
    assert.deepEqual(b.options, ["Start from this exercise", "How to do it", "Cancel"]);
    assert.equal(b.cancelButtonIndex, 2);
    assert.equal(b.destructiveButtonIndex, undefined);
  });
  it("marks every destructive action red, by index", () => {
    const b = iosButtons([{ label: "Edit" }, { label: "Remove", destructive: true }, { label: "Delete", destructive: true }]);
    assert.deepEqual(b.destructiveButtonIndex, [1, 2]);
    assert.equal(b.cancelButtonIndex, 3);
  });
  it("takes its own cancel label (a confirmation's Keep it)", () => {
    const b = iosButtons([{ label: "Cancel request", destructive: true }], "Keep it");
    assert.deepEqual(b.options, ["Cancel request", "Keep it"]);
    assert.equal(b.cancelButtonIndex, 1);
    assert.deepEqual(b.destructiveButtonIndex, [0]);
  });
  it("leaves a non-destructive confirmation uncoloured", () => {
    assert.equal(iosButtons([{ label: "Regenerate", destructive: false }]).destructiveButtonIndex, undefined);
  });
});
