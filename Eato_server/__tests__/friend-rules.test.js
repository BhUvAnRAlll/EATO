// Unit tests for the friendship rules (community/friendRules.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { pairOf, stateOf, messageLockReason } = require("../community/friendRules.js");

describe("friend rules", () => {
  it("pairOf orders ids the way MySQL's case-insensitive collation does, whichever side asks", () => {
    // A plain `<` would put "user_B" first (capitals sort before small letters); MySQL puts "user_a" first
    assert.deepEqual(pairOf("user_a", "user_B"), ["user_a", "user_B"]);
    assert.deepEqual(pairOf("user_B", "user_a"), ["user_a", "user_B"]);
    assert.deepEqual(pairOf("user_9z", "user_A1"), ["user_9z", "user_A1"], "digits before letters");
    assert.deepEqual(pairOf("user_Xa", "user_xB"), pairOf("user_xB", "user_Xa"));
  });

  it("stateOf reads the pair from the viewer's side", () => {
    assert.equal(stateOf(undefined, "user_me"), "none");
    assert.equal(stateOf({ status: "accepted", requester_id: "user_other" }, "user_me"), "friends");
    assert.equal(stateOf({ status: "pending", requester_id: "user_me" }, "user_me"), "outgoing");
    assert.equal(stateOf({ status: "pending", requester_id: "user_other" }, "user_me"), "incoming");
    for (const status of ["declined", "cancelled", "removed"]) assert.equal(stateOf({ status, requester_id: "user_me" }, "user_me"), "none");
  });

  it("messageLockReason explains each locked state and unlocks only for friends", () => {
    assert.equal(messageLockReason("friends", "Asha Rao"), null);
    assert.equal(messageLockReason("outgoing", "Asha Rao"), "Messaging unlocks when Asha accepts your friend request.");
    assert.equal(messageLockReason("incoming", "Asha Rao"), "Accept Asha's friend request to message them.");
    assert.equal(messageLockReason("none", "Asha Rao"), "Add Asha as a friend to message them.");
    assert.equal(messageLockReason("none", null), "Add them as a friend to message them.");
  });
});
