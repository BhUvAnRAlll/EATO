/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Story, StoryAudience, StoryGroup } from "../community.ts";
import { storyRingFor, withOwnStory } from "../storyRing.ts";

const me = { id: "user_me", name: "Priya Sharma", initial: "P" };
const other = { id: "user_other", name: "Rohan Mehta", initial: "R" };

const story = (id: string, options: { audience?: StoryAudience; viewed?: boolean; own?: boolean } = {}): Story => ({
  id,
  author: options.own ? me : other,
  imageUrl: `/api/media/${id}`,
  caption: null,
  audience: options.audience ?? "public",
  viewed: options.viewed ?? false,
  isOwn: options.own ?? false,
  viewCount: options.own ? 0 : null,
  createdAt: "2026-10-14T10:00:00.000Z",
  expiresAt: "2026-10-15T10:00:00.000Z",
});
const group = (stories: Story[], own = false): StoryGroup => ({
  member: own ? me : other,
  isOwn: own,
  stories,
  allViewed: own || stories.every((item) => item.viewed),
});

describe("story ring", () => {
  it("shows no ring without an active story the viewer may see", () => {
    assert.equal(storyRingFor(undefined), "none");
    assert.equal(storyRingFor(null), "none");
    assert.equal(storyRingFor(group([])), "none");
  });

  it("always rings your own active stories, even though the server marks them seen", () => {
    assert.equal(storyRingFor(group([story("a", { own: true })], true)), "unseen");
    assert.equal(storyRingFor(group([story("a", { own: true, audience: "close_friends" }), story("b", { own: true })], true)), "unseen");
    assert.equal(storyRingFor(group([story("a", { own: true, audience: "close_friends" })], true)), "close");
  });

  it("rings another member's unseen stories, green when an unseen one is for Close Friends", () => {
    assert.equal(storyRingFor(group([story("a"), story("b")])), "unseen");
    assert.equal(storyRingFor(group([story("a", { viewed: true }), story("b", { audience: "close_friends" })])), "close");
    assert.equal(storyRingFor(group([story("a", { audience: "close_friends", viewed: true }), story("b")])), "unseen", "a seen Close Friends story doesn't turn it green");
  });

  it("shows the seen ring once every story has been seen", () => {
    assert.equal(storyRingFor(group([story("a", { viewed: true }), story("b", { viewed: true })])), "seen");
  });
});

describe("adding a story you just published", () => {
  it("creates your group first in the row when you had none", () => {
    const others = [group([story("x")])];
    const result = withOwnStory(others, story("new", { own: true }));
    assert.equal(result.length, 2);
    assert.equal(result[0].isOwn, true);
    assert.deepEqual(result[0].stories.map((s) => s.id), ["new"]);
    assert.equal(result[1], others[0]);
  });

  it("appends to your existing stories, oldest first, and keeps several active", () => {
    const start = [group([story("first", { own: true })], true), group([story("x")])];
    const result = withOwnStory(start, story("second", { own: true }));
    assert.deepEqual(result[0].stories.map((s) => s.id), ["first", "second"]);
    assert.equal(result.length, 2);
  });

  it("never adds the same story twice (a Retry that gets the same story back)", () => {
    const start = [group([story("first", { own: true })], true)];
    assert.equal(withOwnStory(start, story("first", { own: true })), start);
  });
});
