/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { friendButton, friendConfirm, messageLockText } from "../friends.ts";

describe("friend button", () => {
  it("offers the next step for each state and asks before undoing", () => {
    assert.deepEqual(friendButton("none"), { label: "Add Friend", tone: "primary", action: "request", confirm: false });
    assert.deepEqual(friendButton("outgoing"), { label: "Requested", tone: "soft", action: "cancel", confirm: true });
    assert.deepEqual(friendButton("incoming"), { label: "Accept", tone: "primary", action: "accept", confirm: false });
    assert.deepEqual(friendButton("friends"), { label: "Friends", tone: "soft", action: "remove", confirm: true });
  });

  it("names the member by first name in the confirmation", () => {
    assert.equal(friendConfirm("cancel", "Asha Rao").title, "Cancel your request to Asha?");
    assert.equal(friendConfirm("remove", "Asha Rao").confirmLabel, "Remove friend");
    assert.equal(friendConfirm("remove", " ").title, "Remove them as a friend?");
  });

  it("explains the messaging lock the way the server does", () => {
    assert.equal(messageLockText("friends", "Asha Rao"), null);
    assert.equal(messageLockText("outgoing", "Asha Rao"), "Messaging unlocks when Asha accepts your friend request.");
    assert.equal(messageLockText("incoming", "Asha Rao"), "Accept Asha's friend request to message them.");
    assert.equal(messageLockText("none", "Asha Rao"), "Add Asha as a friend to message them.");
  });
});
