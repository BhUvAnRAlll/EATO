// Jiggle mode's helpers: a saved order, moving a tile and the slot a drag ends over.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inSavedOrder, moveTile, sameOrder, slotAfterDrag } from "../tileOrder.ts";

const tiles = ["admission", "renewal", "enquiry", "due-paid", "pt", "product"].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("inSavedOrder", () => {
  it("keeps the usual order without a saved one", () => {
    assert.deepEqual(ids(inSavedOrder(tiles, null)), ids(tiles));
  });
  it("follows the saved order, puts unknown tiles last and drops gone ones", () => {
    assert.deepEqual(ids(inSavedOrder(tiles, ["pt", "gone", "admission"])), ["pt", "admission", "renewal", "enquiry", "due-paid", "product"]);
  });
  it("works on the tiles a login may see", () => {
    assert.deepEqual(ids(inSavedOrder(tiles.slice(0, 2), ["product", "renewal", "admission"])), ["renewal", "admission"]);
  });
});

describe("moveTile", () => {
  it("moves forwards and backwards", () => {
    assert.deepEqual(moveTile([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
    assert.deepEqual(moveTile([1, 2, 3, 4], 3, 1), [1, 4, 2, 3]);
  });
  it("clamps and leaves the list alone when nothing moves", () => {
    const list = [1, 2, 3];
    assert.equal(moveTile(list, 1, 1), list);
    assert.deepEqual(moveTile(list, 0, 99), [2, 3, 1]);
  });
});

describe("slotAfterDrag", () => {
  const cell = { width: 100, height: 80, columns: 3, count: 6 };
  it("counts whole cells across and down", () => {
    assert.equal(slotAfterDrag(0, 210, 0, cell), 2);
    assert.equal(slotAfterDrag(0, 90, 70, cell), 4);
    assert.equal(slotAfterDrag(5, -260, -90, cell), 0);
  });
  it("stays inside the grid and ignores a small nudge", () => {
    assert.equal(slotAfterDrag(2, 500, 500, cell), 5);
    assert.equal(slotAfterDrag(4, 30, -20, cell), 4);
    assert.equal(slotAfterDrag(4, 30, -20, { ...cell, width: 0 }), 4);
  });
  it("never points past the last tile in a short row", () => {
    assert.equal(slotAfterDrag(3, 200, 0, { ...cell, count: 4 }), 3);
  });
});

describe("sameOrder", () => {
  it("compares in order", () => {
    assert.ok(sameOrder(["a", "b"], ["a", "b"]));
    assert.ok(!sameOrder(["a", "b"], ["b", "a"]));
  });
});
