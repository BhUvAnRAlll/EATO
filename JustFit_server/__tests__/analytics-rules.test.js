// App event tracking, the pure parts: which events are accepted, how a batch is cleaned, and
// what never gets stored. No database.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../analytics/rules");
const { ValidationError } = require("../profile");

const NOW = Date.parse("2026-10-30T10:00:00Z");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = "11111111-2222-4333-8444-555555555555";
const event = (over = {}) => ({ id: id(1), name: "meal_logged", at: NOW - 1000, sessionId: SESSION, ...over });
const batch = (events, over = {}) => ({ events, platform: "ios", appVersion: "1.0.0", ...over });

describe("app events: the list", () => {
  it("every event has a module, and the modules match App Usage's areas", () => {
    for (const [name, module] of Object.entries(rules.EVENTS)) {
      assert.match(name, /^[a-z_]{3,40}$/);
      assert.ok(rules.MODULES.includes(module), name);
    }
    for (const name of ["app_opened", "screen_viewed", "login_completed", "workout_started", "workout_completed", "meal_logged", "ai_chat_sent", "macro_updated", "community_post_created", "story_viewed", "attendance_checked_in"]) {
      assert.ok(name in rules.EVENTS, `${name} is tracked`);
    }
  });
});

describe("app events: one event", () => {
  it("keeps a good event, with its module, and lowercases the ids", () => {
    const e = rules.cleanEvent(event({ id: id(1).toUpperCase(), metadata: { slot: "lunch", kcal: 420, planned: true } }), NOW);
    assert.deepEqual(e, { id: id(1), name: "meal_logged", module: "nutrition", screen: null, sessionId: SESSION, atMs: NOW - 1000, metadata: { slot: "lunch", kcal: 420, planned: true } });
  });

  it("refuses what can't be an event", () => {
    for (const bad of [
      null, "meal_logged", [],
      event({ id: "not-a-uuid" }), event({ id: undefined }),
      event({ name: "credit_card_entered" }), event({ name: undefined }),
      event({ sessionId: "abc" }),
      event({ at: "yesterday" }), event({ at: undefined }),
      event({ name: "screen_viewed" }), // a view needs a screen
      event({ name: "screen_viewed", screen: 42 }),
    ]) {
      assert.throws(() => rules.cleanEvent(bad, NOW), ValidationError, JSON.stringify(bad));
    }
  });

  it("drops (never refuses) an event older than a week, and a view of a screen we don't chart", () => {
    assert.equal(rules.cleanEvent(event({ at: NOW - 8 * 24 * 3600 * 1000 }), NOW), null);
    assert.equal(rules.cleanEvent(event({ name: "screen_viewed", screen: "settings-debug" }), NOW), null);
    assert.equal(rules.cleanEvent(event({ name: "screen_viewed", screen: "macro" }), NOW).screen, "macro");
  });

  it("a clock ahead of the server is clamped to now plus a few minutes", () => {
    assert.equal(rules.cleanEvent(event({ at: NOW + 60_000 }), NOW).atMs, NOW + 60_000);
    assert.equal(rules.cleanEvent(event({ at: NOW + 3600_000 }), NOW).atMs, NOW + 5 * 60_000);
  });

  it("accepts ISO strings and milliseconds for the time", () => {
    assert.equal(rules.cleanEvent(event({ at: new Date(NOW - 5000).toISOString() }), NOW).atMs, NOW - 5000);
  });
});

describe("app events: metadata never carries personal data", () => {
  it("keeps a few flat plain values and drops the rest", () => {
    assert.deepEqual(rules.cleanMetadata({ slot: "lunch", n: 2, ok: true, nested: { a: 1 }, list: [1], fn: null }), { slot: "lunch", n: 2, ok: true });
    assert.equal(rules.cleanMetadata({ nested: { a: 1 } }), null);
    assert.equal(rules.cleanMetadata("lunch"), null);
    assert.equal(rules.cleanMetadata(null), null);
  });

  it("refuses the keys that would name or locate a person, whatever the value", () => {
    const m = rules.cleanMetadata({ email: "a@b.c", phone: "9876543210", name: "Priya", Full_Name: "x", token: "jfs_x", otp: "123456", lat: 12.9, lng: 77.6, ip: "1.2.3.4", slot: "lunch" });
    assert.deepEqual(m, { slot: "lunch" });
  });

  it("caps the number of keys and the length of a value", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    assert.equal(Object.keys(rules.cleanMetadata(many)).length, rules.limits.metadataKeys);
    assert.equal(rules.cleanMetadata({ note: "x".repeat(500) }).note.length, rules.limits.metadataValue);
  });
});

describe("app events: a batch", () => {
  it("cleans every event, drops duplicates within the batch, and counts what it dropped", () => {
    const b = rules.cleanBatch(batch([event({ id: id(1) }), event({ id: id(1) }), event({ id: id(2), at: NOW - 30 * 24 * 3600 * 1000 }), event({ id: id(3) })]), NOW);
    assert.deepEqual(b.events.map((e) => e.id), [id(1), id(3)]);
    assert.equal(b.dropped, 2);
    assert.equal(b.platform, "ios");
    assert.equal(b.appVersion, "1.0.0");
  });

  it("refuses an empty batch, too many events, an unknown platform, or an extra field", () => {
    for (const bad of [
      batch([]),
      batch(Array.from({ length: rules.limits.batch + 1 }, (_, i) => event({ id: id(i) }))),
      batch([event()], { platform: "windows" }),
      batch([event()], { userId: "user_x" }),
      { events: [event()] },
      null,
      [],
    ]) {
      assert.throws(() => rules.cleanBatch(bad, NOW), ValidationError, JSON.stringify(bad)?.slice(0, 60));
    }
  });

  it("one bad event refuses the whole batch, so the app's bug shows up instead of being silently lost", () => {
    assert.throws(() => rules.cleanBatch(batch([event(), event({ id: id(2), name: "nope" })]), NOW), ValidationError);
  });

  it("an odd app version is dropped, never refused", () => {
    assert.equal(rules.cleanBatch(batch([event()], { appVersion: "1.0.0 (debug build) <script>" }), NOW).appVersion, null);
    assert.equal(rules.cleanBatch(batch([event()], { appVersion: "1.2.3-beta+7" }), NOW).appVersion, "1.2.3-beta+7");
  });
});
