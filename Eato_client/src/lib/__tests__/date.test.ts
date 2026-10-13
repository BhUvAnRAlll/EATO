/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dobLimits } from "../date.ts";

describe("date of birth limits", () => {
  it("clamps a February 29 boundary to the last day of February", () => {
    const { maximumDate } = dobLimits(new Date(2024, 1, 29));
    assert.deepEqual(
      [maximumDate.getFullYear(), maximumDate.getMonth(), maximumDate.getDate()],
      [2011, 1, 28],
    );
  });
});