// Unit tests for the gym permission rules (gyms/permissions.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const p = require("../gyms/permissions.js");

const gym = (overrides = {}) => ({
  visibility: "public", who_can_post: "everyone", who_can_comment: "members", who_can_create_events: "trainers",
  member_approval: 0, post_moderation: 0, ...overrides,
});
const as = (role, status = "active", user_id = `user_${role}`) => ({ role, status, user_id });

describe("gym permissions", () => {
  it("counts a role only while the membership is active", () => {
    assert.equal(p.activeRole(as("admin")), "admin");
    assert.equal(p.activeRole(as("admin", "pending")), null);
    assert.equal(p.activeRole(as("owner", "suspended")), null);
    assert.equal(p.activeRole(null), null);
  });

  it("joining is instant unless approval is on or the gym is private", () => {
    assert.equal(p.joinMode(gym()), "join");
    assert.equal(p.joinMode(gym({ member_approval: 1 })), "request");
    assert.equal(p.joinMode(gym({ visibility: "private" })), "request");
  });

  it("content is for active members, or anyone in a public gym; hidden gyms only show to members", () => {
    assert.equal(p.canViewContent(gym(), null), true);
    assert.equal(p.canViewContent(gym({ visibility: "private" }), null), false);
    assert.equal(p.canViewContent(gym({ visibility: "private" }), as("member", "pending")), false, "a request isn't membership");
    assert.equal(p.canViewContent(gym({ visibility: "private" }), as("member")), true);
    assert.equal(p.canSeeGym(gym({ visibility: "hidden" }), null), false);
    assert.equal(p.canSeeGym(gym({ visibility: "hidden" }), as("member", "pending")), true);
    assert.equal(p.canSeeGym(gym({ visibility: "private" }), null), true, "private gyms are still listed");
  });

  it("who may post, comment and create events follows each setting", () => {
    assert.equal(p.canPost(gym(), as("member")), true);
    assert.equal(p.canPost(gym(), null), false, "outsiders never post, even in a public gym");
    assert.equal(p.canPost(gym({ who_can_post: "trainers" }), as("member")), false);
    assert.equal(p.canPost(gym({ who_can_post: "trainers" }), as("trainer")), true);
    assert.equal(p.canPost(gym({ who_can_post: "admins" }), as("trainer")), false);
    assert.equal(p.canPost(gym({ who_can_post: "admins" }), as("admin")), true);
    assert.equal(p.canComment(gym({ who_can_comment: "off" }), as("trainer")), false);
    assert.equal(p.canComment(gym({ who_can_comment: "off" }), as("owner")), true, "admins can still reply");
    assert.equal(p.canCreateEvents(gym(), as("member")), false);
    assert.equal(p.canCreateEvents(gym({ who_can_create_events: "members" }), as("member")), true);
    assert.equal(p.canCreateEvents(gym({ who_can_create_events: "admins" }), as("trainer")), false);
    assert.equal(p.canPost(gym(), as("member", "suspended")), false);
  });

  it("post moderation holds members' posts but not staff's", () => {
    assert.equal(p.postNeedsReview(gym({ post_moderation: 1 }), as("member")), true);
    assert.equal(p.postNeedsReview(gym({ post_moderation: 1 }), as("trainer")), false);
    assert.equal(p.postNeedsReview(gym(), as("member")), false);
  });

  it("staff invite: trainers members only, admins members and trainers, members nobody", () => {
    assert.deepEqual(p.invitableRoles(as("member")), []);
    assert.deepEqual(p.invitableRoles(as("trainer")), ["member"]);
    assert.deepEqual(p.invitableRoles(as("admin")), ["member", "trainer"]);
    assert.deepEqual(p.invitableRoles(as("owner", "pending")), []);
  });

  it("member changes protect the owner, other admins and yourself", () => {
    const owner = as("owner"), admin = as("admin"), trainer = as("trainer"), member = as("member");
    assert.equal(p.memberChangeRefusal(owner, member, { role: "trainer" }), null);
    assert.equal(p.memberChangeRefusal(owner, member, { role: "admin" }), null, "the owner makes admins");
    assert.match(p.memberChangeRefusal(admin, member, { role: "admin" }), /Only the owner/);
    assert.equal(p.memberChangeRefusal(admin, trainer, { status: "suspended" }), null);
    assert.match(p.memberChangeRefusal(admin, as("admin", "active", "user_other_admin"), {}), /Only the owner/);
    assert.match(p.memberChangeRefusal(admin, owner, { status: "suspended" }), /owner/);
    assert.match(p.memberChangeRefusal(owner, member, { role: "owner" }), /can't be given/);
    assert.match(p.memberChangeRefusal(trainer, member, { status: "active" }), /Only gym admins/);
    assert.match(p.memberChangeRefusal(member, member, {}), /Only gym admins/);
    assert.match(p.memberChangeRefusal(admin, admin, { role: "member" }), /your own/);
    assert.match(p.memberChangeRefusal(admin, null, {}), /isn't in this gym/);
    assert.match(p.memberChangeRefusal(as("admin", "suspended"), member, {}), /Only gym admins/);
  });

  it("everyone but the owner can leave", () => {
    assert.equal(p.canLeave(as("owner")), false);
    assert.equal(p.canLeave(as("admin")), true);
    assert.equal(p.canLeave(null), false);
  });
});
