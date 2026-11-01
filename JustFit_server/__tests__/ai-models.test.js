// The AI model router, cache and deduplicator (ai/models.js, ai/cache.js, ai/dedupe.js): pure, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const models = require("../ai/models.js");
const { createResponseCache, keyOf, normalizeQuestion } = require("../ai/cache.js");
const { createDeduplicator, requestKey } = require("../ai/dedupe.js");
const rules = require("../ai/rules.js");

describe("ai models: routing", () => {
  it("defaults every app feature to a small model", () => {
    for (const feature of ["coach_chat", "coach_plan", "coach_meal", "food_scan", "body_report"]) assert.equal(models.modelFor(feature, {}), "gpt-4.1-mini", feature);
    assert.doesNotMatch(models.routingSummary({}), /gpt-4o(?!-mini)/, "nothing runs on gpt-4o unless configured");
  });

  it("a feature's own variable wins over the old global one, which still works", () => {
    assert.equal(models.modelFor("coach_chat", { OPENAI_MODEL: "gpt-4o", AI_MODEL_COACH_CHAT: " gpt-4.1-nano " }), "gpt-4.1-nano");
    assert.equal(models.modelFor("coach_plan", { OPENAI_MODEL: "gpt-4o" }), "gpt-4o", "the old global override still applies");
    assert.throws(() => models.modelFor("gym_assistant", {}), /unknown AI feature/, "the gym assistant was removed with the gyms");
    assert.throws(() => models.modelFor("trainer", {}), /unknown AI feature/);
  });

  it("the request carries the model and an output cap; a reasoning model gets the lowest effort", () => {
    const chat = models.settingsFor("coach_chat", {});
    assert.deepEqual(chat.request, { model: "gpt-4.1-mini", max_output_tokens: 900 });
    assert.equal(models.settingsFor("coach_chat", { AI_MAX_OUTPUT_COACH_CHAT: "300" }).request.max_output_tokens, 300);
    assert.equal(models.settingsFor("coach_chat", { AI_MAX_OUTPUT_COACH_CHAT: "-5" }).request.max_output_tokens, 900, "a bad cap keeps the default");
    assert.deepEqual(models.settingsFor("coach_plan", { AI_MODEL_COACH_PLAN: "gpt-5-mini" }).request, { model: "gpt-5-mini", max_output_tokens: 2200, reasoning: { effort: "minimal" } });
    assert.ok(models.settingsFor("coach_plan", {}).maxOutputTokens >= 2000, "a five-meal plan is never cut short");
  });

  it("knows the test stand-in and reads cached tokens off a response", () => {
    assert.equal(models.isFake({ NODE_ENV: "test", AI_PROVIDER: "fake" }), true);
    assert.equal(models.isFake({ NODE_ENV: "production", AI_PROVIDER: "fake" }), false);
    assert.equal(models.cachedTokensOf({ usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 640 } } }), 640);
    assert.equal(models.cachedTokensOf({ usage: { input_tokens: 900 } }), 0);
    assert.equal(models.cachedTokensOf(undefined), 0);
  });
});

describe("ai rules: cached tokens, limits and messages", () => {
  const mini = { input_usd_per_million: "0.4000", cached_input_usd_per_million: "0.1000", output_usd_per_million: "1.6000", request_usd: "0" };

  it("bills cached input at the cached price, or the full price when the row has none", () => {
    // 1,000 in (800 cached), 100 out at ₹84: 200×0.4 + 800×0.1 + 100×1.6 = 0.00032 $ → ₹0.0269
    assert.equal(rules.costInr(mini, 1000, 100, 84, 800), 0.0269);
    assert.equal(rules.costInr({ ...mini, cached_input_usd_per_million: null }, 1000, 100, 84, 800), rules.costInr(mini, 1000, 100, 84, 0));
    assert.equal(rules.costInr(mini, 1000, 0, 84, 5000), rules.costInr(mini, 1000, 0, 84, 1000), "cached tokens never exceed the input");
  });

  it("a usage row keeps the cached count and the cache flag", () => {
    const row = rules.usageRow({ feature: "coach_meal", provider: "openai", model: "gpt-4.1-mini", inputTokens: 100, cachedInputTokens: 150, status: "ok" });
    assert.deepEqual({ cached: row.cachedInputTokens, fromCache: row.fromCache, feature: row.feature }, { cached: 100, fromCache: false, feature: "coach_meal" });
    assert.equal(rules.usageRow({ feature: "gym_assistant", provider: "openai", model: "x", fromCache: true, status: "ok" }).fromCache, true);
  });

  it("the limits come from the environment, with sane defaults and 0 for off", () => {
    assert.deepEqual(rules.limitsConfig({}), { perMinute: 12, perDay: 150, plansPerDay: 3, budgetHardStop: true, cacheTtlMs: 24 * 60 * 60 * 1000, cacheEnabled: true });
    const custom = rules.limitsConfig({ AI_LIMIT_PER_MINUTE: "0", AI_LIMIT_PER_DAY: "20", AI_PLAN_LIMIT_PER_DAY: "x", AI_BUDGET_HARD_STOP: "off", AI_CACHE: "off", AI_CACHE_TTL_MINUTES: "5" });
    assert.deepEqual(custom, { perMinute: 0, perDay: 20, plansPerDay: 3, budgetHardStop: false, cacheTtlMs: 5 * 60 * 1000, cacheEnabled: false });
    assert.match(rules.LIMIT_MESSAGES.plans(3), /3 plans today/);
    assert.match(rules.LIMIT_MESSAGES.day(150), /150 AI requests/);
    assert.equal(rules.estimateTokens("a".repeat(400)), 100);
  });
});

describe("ai cache", () => {
  it("returns an entry until it expires, drops the oldest past the size cap, and ignores sets when disabled", () => {
    const cache = createResponseCache({ ttlMs: 1000, maxEntries: 2 });
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    assert.equal(cache.get("a", 500), 1);
    assert.equal(cache.get("a", 1000), undefined, "expired");
    cache.set("c", 3, 0);
    cache.set("d", 4, 0);
    assert.equal(cache.size(), 2);
    assert.equal(cache.get("b", 0), undefined, "the oldest went");
    assert.equal(cache.get("d", 0), 4);
    const off = createResponseCache({ ttlMs: 0 });
    off.set("a", 1);
    assert.equal(off.get("a"), undefined);
  });

  it("keys the same question in different clothes the same, and different facts differently", () => {
    assert.equal(normalizeQuestion("  What ARE your Timings?? "), "what are your timings");
    const facts = { hours: ["6-10"] };
    assert.equal(keyOf("g1", facts, normalizeQuestion("Timings?")), keyOf("g1", facts, normalizeQuestion("timings")));
    assert.notEqual(keyOf("g1", facts, "timings"), keyOf("g1", { hours: ["7-10"] }, "timings"));
    assert.notEqual(keyOf("g1", facts, "timings"), keyOf("g2", facts, "timings"));
  });
});

describe("ai deduplicator", () => {
  it("runs identical in-flight requests once and forgets them when done", async () => {
    const dedupe = createDeduplicator();
    let calls = 0;
    const work = () => new Promise((resolve) => setTimeout(() => resolve(++calls), 10));
    const [a, b] = await Promise.all([dedupe.run("k", work), dedupe.run("k", work)]);
    assert.deepEqual([a, b, calls], [1, 1, 1]);
    assert.equal(dedupe.size(), 0);
    assert.equal(await dedupe.run("k", work), 2, "a later request runs again");
    const key = requestKey("coach_chat", "u1", [{ role: "member", text: "hi" }]);
    assert.match(key, /^coach_chat:u1:[0-9a-f]{32}$/);
    assert.notEqual(key, requestKey("coach_chat", "u1", [{ role: "member", text: "hi!" }]));
  });

  it("a failing request is not cached and does not break the next one", async () => {
    const dedupe = createDeduplicator();
    await assert.rejects(dedupe.run("k", () => Promise.reject(new Error("boom"))), /boom/);
    assert.equal(await dedupe.run("k", async () => "ok"), "ok");
  });
});
