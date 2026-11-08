// The HUD's rules: short lines, how long each kind stays, which host draws it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HUD_MAX_CHARS, HUD_MS, hudText, topHost } from "../hudRules.ts";

describe("hudText", () => {
  it("keeps a short line as it is, tidied", () => {
    assert.equal(hudText("Checked in"), "Checked in");
    assert.equal(hudText("  Payment \n recorded "), "Payment recorded");
  });
  it("cuts a long line at a word, with an ellipsis, within the limit", () => {
    const long = "The server answered with a very long explanation that nobody can read before it disappears again";
    const line = hudText(long);
    assert.ok(line.length <= HUD_MAX_CHARS, line);
    assert.ok(line.endsWith("…"));
    assert.ok(long.startsWith(line.slice(0, -1)));
    assert.ok(!/\s…$/.test(line));
  });
  it("cuts a line with no spaces too", () => {
    const line = hudText("x".repeat(100));
    assert.equal(line.length, HUD_MAX_CHARS);
    assert.ok(line.endsWith("…"));
  });
});

describe("HUD_MS", () => {
  it("leaves problems up longer than successes", () => {
    assert.ok(HUD_MS.error > HUD_MS.success);
    assert.ok(HUD_MS.offline > HUD_MS.success);
    for (const ms of Object.values(HUD_MS)) assert.ok(ms >= 1000 && ms <= 5000);
  });
});

describe("topHost", () => {
  it("is the newest mounted host (the sheet open over the root)", () => {
    assert.equal(topHost([]), null);
    assert.equal(topHost([1]), 1);
    assert.equal(topHost([1, 4, 7]), 7);
  });
});
