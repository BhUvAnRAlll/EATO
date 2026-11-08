// Role & Permission's tick rules (lib/permissionTree.ts): an option brings what it needs, a tile
// ticks or unticks all its options, and the search keeps a tile's matching options.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterTree, optionsLine, sameOptions, tickedIn, toggleOption, toggleTile } from "../permissionTree.ts";
import type { PermissionTile, StaffOption } from "../gymApi.ts";

const tree: PermissionTile[] = [
  { id: "members", label: "Members", options: [
    { id: "members.view", label: "Member list and pages", needs: null },
    { id: "members.add", label: "Add Member", needs: "members.view" },
    { id: "members.renew", label: "Renew membership", needs: "members.view" },
  ] },
  { id: "payments", label: "Payments", options: [
    { id: "payments.collect", label: "Collect payment due", needs: null },
    { id: "payments.wallet", label: "Wallet", needs: null },
  ] },
];

describe("toggleOption", () => {
  it("ticks an option with the one it needs, in the tree's order", () => {
    assert.deepEqual(toggleOption(tree, ["payments.wallet"], "members.add"), ["members.view", "members.add", "payments.wallet"]);
  });
  it("unticking an option others need unticks them too", () => {
    assert.deepEqual(toggleOption(tree, ["members.view", "members.add", "members.renew", "payments.wallet"], "members.view"), ["payments.wallet"]);
  });
  it("unticking one that nothing needs leaves the rest", () => {
    assert.deepEqual(toggleOption(tree, ["members.view", "members.add"], "members.add"), ["members.view"]);
  });
});

describe("toggleTile", () => {
  it("ticks every option of an unticked tile", () => {
    assert.deepEqual(toggleTile(tree, [], tree[1]), ["payments.collect", "payments.wallet"]);
  });
  it("unticks every option of a tile with any ticked, leaving other tiles", () => {
    const ticked: StaffOption[] = ["members.view", "payments.wallet"];
    assert.deepEqual(toggleTile(tree, ticked, tree[0]), ["payments.wallet"]);
    assert.deepEqual(tickedIn(tree[0], ticked).map((o) => o.id), ["members.view"]);
  });
});

describe("filterTree", () => {
  it("keeps a whole tile whose name matches, or only the matching options", () => {
    assert.equal(filterTree(tree, "").length, 2);
    assert.deepEqual(filterTree(tree, "pay").map((t) => [t.id, t.options.length]), [["payments", 2]]);
    assert.deepEqual(filterTree(tree, " RENEW ").map((t) => [t.id, t.options.map((o) => o.id)]), [["members", ["members.renew"]]]);
    assert.deepEqual(filterTree(tree, "nothing like it"), []);
  });
});

describe("sameOptions", () => {
  it("compares lists whatever their order", () => {
    assert.equal(sameOptions(["members.view", "payments.wallet"], ["payments.wallet", "members.view"]), true);
    assert.equal(sameOptions(["members.view"], []), false);
  });
});

describe("optionsLine", () => {
  it("says what a Staff login can use in one line", () => {
    assert.equal(optionsLine(tree, []), "Home only");
    assert.equal(optionsLine(tree, ["members.view", "members.add", "members.renew", "payments.collect", "payments.wallet"]), "All areas");
    assert.equal(optionsLine(tree, ["members.view", "payments.collect", "payments.wallet"]), "Members (1 of 3), Payments");
  });
});
