// The motion helpers: tweens land exactly on their target, the reply reveal keeps the text and
// its bold points intact, and only keys added after the first showing get an entrance.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { easeOut, newKeys, revealWords, tweenAt } from "../motionRules.ts";

describe("tweenAt", () => {
  it("starts at from, ends exactly on to, and passes halfway early (ease-out)", () => {
    assert.equal(tweenAt(10, 20, 0, 600), 10);
    assert.equal(tweenAt(10, 20, 600, 600), 20);
    assert.equal(tweenAt(10, 20, 9000, 600), 20);
    assert.ok(tweenAt(0, 100, 300, 600) > 50);
  });
  it("jumps straight to the target with no duration (reduced motion)", () => {
    assert.equal(tweenAt(3, 7, 0, 0), 7);
  });
  it("clamps the easing to 0-1", () => {
    assert.equal(easeOut(-1), 0);
    assert.equal(easeOut(2), 1);
  });
});

describe("revealWords", () => {
  const reply = "You've had **52 of 120 g** so far. Add **Greek curd** at 5 PM.";
  it("lays end to end into the reply without its markers", () => {
    assert.equal(revealWords(reply).map((w) => w.text).join(""), "You've had 52 of 120 g so far. Add Greek curd at 5 PM.");
  });
  it("marks the words inside ** as bold and only those", () => {
    const bold = revealWords(reply).filter((w) => w.bold).map((w) => w.text.trim());
    assert.deepEqual(bold, ["52", "of", "120", "g", "Greek", "curd"]);
  });
  it("keeps line breaks and plain text as they are", () => {
    assert.equal(revealWords("One\ntwo  three").map((w) => w.text).join(""), "One\ntwo  three");
    assert.ok(revealWords("plain text").every((w) => !w.bold));
  });
  it("answers no words for an empty reply", () => {
    assert.deepEqual(revealWords(""), []);
  });
});

describe("newKeys", () => {
  it("animates nothing before the list has been shown once", () => {
    assert.equal(newKeys(null, ["a", "b"]).size, 0);
  });
  it("animates only what was added after the first showing", () => {
    assert.deepEqual([...newKeys(new Set(["a", "b"]), ["a", "b", "c"])], ["c"]);
  });
});
