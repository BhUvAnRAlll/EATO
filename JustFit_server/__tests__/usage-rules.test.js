// Super Admin › App Usage, the pure parts: the feature catalogue, the date ranges and the
// comparison and ranking maths. No database.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../admin/usageRules");
const { ValidationError } = require("../profile");

const TODAY = "2026-10-30";

describe("app usage: the feature catalogue", () => {
  it("every feature names a table, a member column and a time column, and ids are unique", () => {
    const ids = new Set();
    for (const f of rules.FEATURES) {
      assert.match(f.id, /^[a-z_]+$/, f.id);
      assert.ok(!ids.has(f.id), `duplicate feature id ${f.id}`);
      ids.add(f.id);
      assert.match(f.table, /^[a-z_]+$/, `${f.id}: table`);
      assert.match(f.member, /^[a-z_]+$/, `${f.id}: member column`);
      assert.match(f.at, /^[a-z_]+$/, `${f.id}: time column`);
      assert.ok(rules.MODULES.some((m) => m.id === f.module), `${f.id}: module ${f.module} exists`);
      if (f.where) assert.ok(!/[;]/.test(f.where), `${f.id}: a single condition`);
    }
    assert.ok(rules.FEATURES.length >= 9);
  });

  it("AI features count only successful calls, never failed or refused ones", () => {
    for (const f of rules.FEATURES.filter((x) => x.table === "ai_usage")) assert.match(f.where, /status = 'ok'/, f.id);
  });

  it("names what the brief asks for but the app doesn't write yet", () => {
    assert.ok(rules.NOT_TRACKED.some((n) => n.id === "screen_visits"));
    for (const n of rules.NOT_TRACKED) assert.ok(n.reason.length > 0);
  });
});

describe("app usage: date ranges", () => {
  const q = (query) => rules.usageQuery(query, TODAY);

  it("defaults to the last 7 days and compares with the 7 before", () => {
    assert.deepEqual(q({}), { range: "7d", from: "2026-10-24", to: "2026-10-30", days: 7, previousFrom: "2026-10-17", previousTo: "2026-10-23" });
  });

  it("knows every preset", () => {
    assert.deepEqual(q({ range: "today" }), { range: "today", from: TODAY, to: TODAY, days: 1, previousFrom: "2026-10-29", previousTo: "2026-10-29" });
    assert.deepEqual(q({ range: "yesterday" }), { range: "yesterday", from: "2026-10-29", to: "2026-10-29", days: 1, previousFrom: "2026-10-28", previousTo: "2026-10-28" });
    assert.equal(q({ range: "30d" }).from, "2026-10-01");
    assert.equal(q({ range: "90d" }).from, "2026-08-02");
    assert.deepEqual(q({ range: "this_month" }), { range: "this_month", from: "2026-10-01", to: TODAY, days: 30, previousFrom: "2026-09-01", previousTo: "2026-09-30" });
    assert.deepEqual(q({ range: "last_month" }), { range: "last_month", from: "2026-09-01", to: "2026-09-30", days: 30, previousFrom: "2026-08-02", previousTo: "2026-08-31" });
  });

  it("this month on the 1st is one day, compared with the last day of the month before", () => {
    assert.deepEqual(rules.usageQuery({ range: "this_month" }, "2026-11-01"), { range: "this_month", from: "2026-11-01", to: "2026-11-01", days: 1, previousFrom: "2026-10-31", previousTo: "2026-10-31" });
  });

  it("a custom range needs two dates, in order, not in the future, at most a year", () => {
    assert.deepEqual(q({ range: "custom", from: "2026-10-01", to: "2026-10-15" }), { range: "custom", from: "2026-10-01", to: "2026-10-15", days: 15, previousFrom: "2026-09-16", previousTo: "2026-09-30" });
    for (const bad of [
      { range: "custom" },
      { range: "custom", from: "2026-10-01" },
      { range: "custom", from: "2026-10-15", to: "2026-10-01" },
      { range: "custom", from: "2026-10-01", to: "2026-11-01" },
      { range: "custom", from: "2025-01-01", to: "2026-10-30" },
      { range: "custom", from: "2026-13-01", to: "2026-10-30" },
      { range: "custom", from: "' OR 1=1 --", to: "2026-10-30" },
    ]) {
      assert.throws(() => q(bad), ValidationError, JSON.stringify(bad));
    }
  });

  it("refuses an unknown range", () => {
    assert.throws(() => q({ range: "forever" }), ValidationError);
    assert.throws(() => q({ range: "7d; DROP TABLE users" }), ValidationError);
  });
});

describe("app usage: comparison and ranking", () => {
  it("percent change, or null when the period before had nothing", () => {
    assert.equal(rules.changePercent(150, 100), 50);
    assert.equal(rules.changePercent(50, 100), -50);
    assert.equal(rules.changePercent(0, 4), -100);
    assert.equal(rules.changePercent(5, 0), null);
    assert.equal(rules.changePercent(0, 0), null);
  });

  it("ranks by distinct members first, never by uses alone, and keeps unused features at zero", () => {
    const current = [
      { id: "a", label: "A", module: "m", uses: "500", members: "3" },
      { id: "b", label: "B", module: "m", uses: "120", members: "40" },
      { id: "c", label: "C", module: "m", uses: "0", members: "0" },
    ];
    const previous = [{ id: "a", uses: "100", members: "10" }, { id: "b", uses: "100", members: "30" }];
    const ranked = rules.rankFeatures(current, previous, 50);
    assert.deepEqual(ranked.map((f) => f.id), ["b", "a", "c"]);
    const [b, a, c] = ranked;
    assert.equal(b.sharePercent, 80);
    assert.equal(b.usesPerMember, 3);
    assert.equal(b.changePercent, 33);
    assert.equal(b.declining, false);
    assert.equal(a.declining, true, "3 members after 10 is a decline");
    assert.equal(a.changePercent, -70);
    assert.equal(c.unused, true);
    assert.equal(c.changePercent, null);
    assert.equal(c.sharePercent, 0);
  });

  it("with no active members every share is zero and nothing divides by zero", () => {
    const ranked = rules.rankFeatures([{ id: "a", label: "A", module: "m", uses: 0, members: 0 }], [], 0);
    assert.deepEqual([ranked[0].sharePercent, ranked[0].usesPerMember, ranked[0].unused], [0, 0, true]);
  });
});
