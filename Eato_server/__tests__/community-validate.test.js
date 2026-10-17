// Unit tests for the community input checks (community/validate.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const v = require("../community/validate.js");

const rejects = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
const UUID = "11111111-2222-4333-8444-555555555555";

describe("community validation", () => {
  it("posts: text within limits, a known category, optional own image", () => {
    assert.deepEqual(v.validatePost({ body: "  Hit a PR  " }), { body: "Hit a PR", category: "general", audience: "public", mediaIds: [], groupId: null, clientKey: null });
    assert.deepEqual(v.validatePost({ body: "x", category: "meal", mediaId: UUID.toUpperCase() }).mediaIds, [UUID]);
    assert.equal(v.validatePost({ body: "x", category: "workout" }).category, "workout");
    rejects(() => v.validatePost({ body: "" }), /Post text is required/);
    rejects(() => v.validatePost({ body: "x".repeat(1001) }), /too long/);
    rejects(() => v.validatePost({ body: "x", category: "league" }), /Category/);
    rejects(() => v.validatePost({ body: "x", userId: "user_other" }), /unexpected field: userId/);
    rejects(() => v.validatePost({ body: "x", mediaId: "../../etc/passwd" }), /image isn't valid/);
    rejects(() => v.validatePost("just text"), /Send the post as an object/);
  });

  it("posts: an ordered list of photos (up to the limit, no repeats) and a client key per draft", () => {
    const second = UUID.replace("1111", "2222");
    assert.deepEqual(v.validatePost({ body: "x", mediaIds: [second.toUpperCase(), UUID] }).mediaIds, [second, UUID]);
    assert.deepEqual(v.validatePost({ body: "x", mediaIds: [] }).mediaIds, []);
    assert.equal(v.validatePost({ body: "x", clientKey: UUID.toUpperCase() }).clientKey, UUID);
    rejects(() => v.validatePost({ body: "x", mediaIds: "not-a-list" }), /list of images/);
    rejects(() => v.validatePost({ body: "x", mediaIds: [UUID, UUID] }), /listed twice/);
    rejects(() => v.validatePost({ body: "x", mediaIds: Array(v.limits.postMedia + 1).fill(UUID).map((id, i) => id.replace("1111", String(1000 + i))) }), /up to 4 photos/);
    rejects(() => v.validatePost({ body: "x", mediaIds: [UUID], mediaId: UUID }), /either mediaId or mediaIds/);
    rejects(() => v.validatePost({ body: "x", mediaIds: ["1 OR 1=1"] }), /image isn't valid/);
    rejects(() => v.validatePost({ body: "x", clientKey: "draft-1" }), /client key isn't valid/);
    assert.deepEqual(v.validatePostUpdate({ mediaIds: [UUID] }), { mediaIds: [UUID] });
    assert.deepEqual(v.validatePostUpdate({ mediaIds: [] }), { mediaIds: [] });
    rejects(() => v.validatePostUpdate({ mediaId: UUID }), /unexpected field: mediaId/);
    rejects(() => v.validatePostUpdate({ clientKey: UUID }), /unexpected field: clientKey/);
  });

  it("audiences: public, followers or only_me; groups are gone, so a post can't name one", () => {
    assert.equal(v.validatePost({ body: "x", audience: "followers" }).audience, "followers");
    assert.equal(v.validatePost({ body: "x", audience: "only_me" }).audience, "only_me");
    rejects(() => v.validatePost({ body: "x", audience: "everyone" }), /Audience/);
    rejects(() => v.validatePost({ body: "x", groupId: UUID }), /unexpected field: groupId/);
    assert.deepEqual(v.validatePostUpdate({ audience: "only_me" }), { audience: "only_me" });
    rejects(() => v.validatePostUpdate({ audience: "friends" }), /Audience/);
  });

  it("stories: an own image, an optional caption and an audience (Everyone by default)", () => {
    assert.deepEqual(v.validateStory({ mediaId: UUID }), { mediaId: UUID, caption: null, audience: "public" });
    assert.equal(v.validateStory({ mediaId: UUID, audience: "close_friends" }).audience, "close_friends");
    assert.equal(v.validateStory({ mediaId: UUID, audience: "followers", caption: "  Leg day " }).caption, "Leg day");
    rejects(() => v.validateStory({ mediaId: UUID, audience: "only_me" }), /Audience/);
    rejects(() => v.validateStory({ mediaId: UUID, audience: "friends" }), /Audience/);
    rejects(() => v.validateStory({ mediaId: UUID, caption: "x".repeat(201) }), /too long/);
    rejects(() => v.validateStory({ mediaId: UUID, userId: "user_other" }), /unexpected field: userId/);
    rejects(() => v.validateStory({ mediaId: "1 OR 1=1" }), /image isn't valid/);
    rejects(() => v.validateStory({}), /image isn't valid/);
  });

  it("own settings: private flag and bio", () => {
    assert.deepEqual(v.validateProfileSettings({ isPrivate: true }), { isPrivate: true });
    assert.deepEqual(v.validateProfileSettings({ bio: "  Lifting since 2021 " }), { bio: "Lifting since 2021" });
    assert.deepEqual(v.validateProfileSettings({ bio: "" }), { bio: null });
    rejects(() => v.validateProfileSettings({ isPrivate: "yes" }), /true or false/);
    rejects(() => v.validateProfileSettings({ status: "suspended" }), /unexpected field: status/);
    rejects(() => v.validateProfileSettings({}), /Nothing to change/);
  });

  it("strips control characters but keeps newlines and emoji", () => {
    assert.equal(v.validatePost({ body: "line one\nline two \u0000\u0007 🔥" }).body, "line one\nline two  🔥");
  });

  it("post updates: only text and category, and at least one of them", () => {
    assert.deepEqual(v.validatePostUpdate({ body: "new" }), { body: "new" });
    rejects(() => v.validatePostUpdate({}), /Nothing to change/);
    rejects(() => v.validatePostUpdate({ likeCount: 999 }), /unexpected field: likeCount/);
  });

  it("comments, stories, reports and messages", () => {
    assert.deepEqual(v.validateComment({ body: "Nice" }), { body: "Nice" });
    rejects(() => v.validateComment({ body: "x".repeat(501) }), /too long/);
    assert.deepEqual(v.validateStory({ mediaId: UUID, caption: "" }), { mediaId: UUID, caption: null, audience: "public" });
    rejects(() => v.validateStory({ caption: "no image" }), /image isn't valid/);
    assert.deepEqual(v.validateReport({ reason: "Spam" }), { reason: "Spam" });
    rejects(() => v.validateReport({}), /Reason is required/);
    assert.deepEqual(v.validateMessage({ body: "hi" }), { body: "hi", id: null });
    const id = "7B8C3C8A-2D1E-4F5A-9B6C-1D2E3F4A5B6C";
    assert.deepEqual(v.validateMessage({ body: "hi", id }), { body: "hi", id: id.toLowerCase() }, "an optional client id, normalised");
    rejects(() => v.validateMessage({ body: "hi", id: "not-a-uuid" }), /message id/);
    rejects(() => v.validateMessage({ body: "hi", id: 42 }), /message id/);
    rejects(() => v.validateMessage({ body: "hi", senderId: "user_x" }), /unexpected|unknown|isn't/i);
    rejects(() => v.validateMessage({ body: "x".repeat(1001) }), /too long/);
  });

  it("ids, pages and cursors", () => {
    assert.equal(v.id(UUID.toUpperCase(), "The post"), UUID);
    rejects(() => v.id("1 OR 1=1", "The post"), /isn't valid/);
    assert.equal(v.pageSize(undefined), 20);
    assert.equal(v.pageSize("50"), 50);
    rejects(() => v.pageSize("0"), /between 1 and 50/);
    rejects(() => v.pageSize("500"), /between 1 and 50/);
    const cursor = v.encodeCursor({ created_at: new Date("2026-10-14T10:00:00Z"), id: UUID });
    assert.deepEqual(v.decodeCursor(cursor), { createdAt: new Date("2026-10-14T10:00:00Z"), id: UUID });
    assert.equal(v.decodeCursor(""), null);
    rejects(() => v.decodeCursor("abc"), /cursor isn't valid/);
    rejects(() => v.decodeCursor("123_' OR 1=1 --"), /cursor isn't valid/);
  });

  it("search terms are trimmed, capped and have SQL wildcards escaped", () => {
    assert.equal(v.searchTerm("  fat loss "), "fat loss");
    assert.equal(v.searchTerm("100%_sure"), "100\\%\\_sure");
    assert.equal(v.searchTerm(""), null);
    assert.equal(v.searchTerm("x".repeat(100)).length, 60);
  });

  it("only Clerk-shaped user ids can start a conversation", () => {
    assert.equal(v.clerkUserId("user_3KfGqHkk7h1VV8d05WWJETAhSV6", "The member"), "user_3KfGqHkk7h1VV8d05WWJETAhSV6");
    rejects(() => v.clerkUserId("'; DROP TABLE users; --", "The member"), /isn't valid/);
    rejects(() => v.clerkUserId("", "The member"), /isn't valid/);
  });
});
