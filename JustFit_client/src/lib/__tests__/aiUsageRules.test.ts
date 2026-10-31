// Admin › AI Usage: a summary from an older server, or with no activity yet, still renders.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeModels, normalizeSummary, num, totalsOf } from "../aiUsageRules.ts";

const full = { requests: 3, inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, tokens: 15, costInr: 1.5, fromCache: 1, avgCostInr: 0.5 };

describe("num", () => {
  it("keeps finite numbers and reads numeric strings (MySQL sums arrive as strings)", () => {
    assert.equal(num(7), 7);
    assert.equal(num("2.5"), 2.5);
  });
  it("turns anything else into 0", () => {
    for (const v of [undefined, null, NaN, Infinity, "", "abc", {}]) assert.equal(num(v), 0);
  });
});

describe("totalsOf", () => {
  it("fills in a total the server left out, keeping the rest", () => {
    const { fromCache, cachedInputTokens, ...older } = full;
    const t = totalsOf({ ...older, model: "gpt-4.1-mini" } as never) as typeof full & { model: string };
    assert.equal(t.fromCache, 0);
    assert.equal(t.cachedInputTokens, 0);
    assert.equal(t.requests, 3);
    assert.equal(t.model, "gpt-4.1-mini");
  });
  it("answers all zeros for nothing at all", () => {
    assert.deepEqual(totalsOf(undefined), { requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, tokens: 0, costInr: 0, fromCache: 0, avgCostInr: 0 });
  });
});

describe("normalizeSummary", () => {
  it("a summary from a server without the cache fields renders every card as a number", () => {
    const { fromCache, cachedInputTokens, ...older } = full;
    const summary = normalizeSummary({
      period: "week", range: { from: "2026-10-24", to: "2026-10-31" },
      allTime: older, today: { costInr: 1, requests: 1 }, month: { costInr: 2, requests: 2 },
      current: older, previous: older,
      features: [{ ...older, feature: "coach_chat", models: [{ ...older, model: "m", provider: "openai" }] }],
      byModel: [{ ...older, model: "m", provider: "openai" }], topMembers: [], series: [],
      budget: { monthlyLimitInr: 0, spentInr: 0, remainingInr: 0, percent: 0, openAlerts: 0 },
    } as never);
    assert.equal(summary.allTime.fromCache.toLocaleString("en-US"), "0");
    assert.equal(summary.features[0].ok, 0);
    assert.equal(summary.features[0].models[0].fromCache, 0);
    assert.equal(summary.byModel[0].cachedInputTokens, 0);
  });
  it("missing sections become empty, not undefined", () => {
    const summary = normalizeSummary({ period: "day" } as never);
    assert.deepEqual(summary.features, []);
    assert.deepEqual(summary.series, []);
    assert.equal(summary.budget.percent, 0);
    assert.equal(summary.today.costInr, 0);
  });
});

describe("mergeModels", () => {
  const row = (model: string, requests: number, costInr: number, tokens = 0) => ({ model, provider: "openai", requests, costInr, tokens });
  it("adds up the features that share a model, dearest first", () => {
    const merged = mergeModels([row("gpt-4.1-mini", 2, 1), row("gpt-4.1", 1, 5, 100), row("gpt-4.1-mini", 3, 2, 50)]);
    assert.deepEqual(merged, [row("gpt-4.1", 1, 5, 100), row("gpt-4.1-mini", 5, 3, 50)]);
  });
  it("leaves one row per model as it is", () => {
    assert.deepEqual(mergeModels([row("m", 1, 1)]), [row("m", 1, 1)]);
    assert.deepEqual(mergeModels([]), []);
  });
});
