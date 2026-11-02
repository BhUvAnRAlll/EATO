// ai/limits.js with a stand-in database: the budget fails closed, re-reads the spend near the
// limit, and refuses a model with no price. No real database, no model.
const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");

const limits = require("../ai/limits.js");
const models = require("../ai/models.js");
const usage = require("../ai/usage.js");

// A pool that answers the few queries limits.js makes; `state` changes what it answers
function fakePool(state) {
  const pool = {
    reads: 0,
    async query(sql) {
      if (state.fail) throw Object.assign(new Error("connection lost"), { code: "PROTOCOL_CONNECTION_LOST" });
      if (/FROM ai_budget WHERE id = 1/.test(sql) && /monthly_limit_inr/.test(sql)) return [[{ monthly_limit_inr: state.limit, usd_to_inr: 84 }]];
      if (/SUM\(cost_inr\)/.test(sql)) {
        pool.reads += 1;
        return [[{ spent: state.spent, month: "2026-11" }]];
      }
      if (/FROM ai_model_prices/.test(sql)) return [state.prices.map((model) => ({ model, input_usd_per_million: 0.4, cached_input_usd_per_million: 0.1, output_usd_per_million: 1.6, request_usd: 0 }))];
      if (/SELECT usd_to_inr FROM ai_budget/.test(sql)) return [[{ usd_to_inr: 84 }]];
      if (/COUNT\(\*\) AS n FROM ai_usage/.test(sql)) return [[{ n: 0 }]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return pool;
}

const env = { NODE_ENV: "production" }; // not the fake provider: every check runs
const priced = [models.modelFor("coach_chat", env)];
const ask = (pool, feature = "coach_chat") => limits.check(pool, { feature, userId: "u1" }, env);
const refused = (code) => (error) => error instanceof limits.AiLimitError && error.status === 503 && error.limit === code;

describe("ai limits: the monthly budget", () => {
  beforeEach(() => {
    limits.reset();
    usage.resetPriceCache();
  });

  it("a database error refuses the call (fails closed) and is not remembered", async () => {
    const state = { fail: true, limit: 1000, spent: 0, prices: priced };
    const pool = fakePool(state);
    await assert.rejects(ask(pool), refused("unchecked"));
    state.fail = false;
    await ask(pool); // the next call checks again and goes through
  });

  it("a spent budget stops every call", async () => {
    await assert.rejects(ask(fakePool({ limit: 1000, spent: 1000, prices: priced })), refused("budget"));
  });

  it("within the last 10% the spend is read on every call, not from the 30 s cache", async () => {
    const state = { limit: 1000, spent: 950, prices: priced };
    const pool = fakePool(state);
    await ask(pool);
    state.spent = 1001; // another call just spent the rest
    await assert.rejects(ask(pool), refused("budget"));
    assert.equal(pool.reads, 2);
  });

  it("far from the limit the cached answer is reused", async () => {
    const pool = fakePool({ limit: 1000, spent: 100, prices: priced });
    await ask(pool);
    await ask(pool);
    assert.equal(pool.reads, 1);
  });

  it("a model with no price row is refused instead of counting as ₹0", async () => {
    await assert.rejects(ask(fakePool({ limit: 1000, spent: 0, prices: [] })), refused("unpriced"));
  });

  it("the self-hosted body scan has no model to price, but still respects a spent budget", async () => {
    await ask(fakePool({ limit: 1000, spent: 0, prices: [] }), "body_scan");
    limits.reset();
    await assert.rejects(ask(fakePool({ limit: 1000, spent: 2000, prices: [] }), "body_scan"), refused("budget"));
  });

  it("with the hard stop off, nothing is refused for the budget or the price", async () => {
    await limits.check(fakePool({ limit: 1000, spent: 5000, prices: [] }), { feature: "coach_chat", userId: "u1" }, { ...env, AI_BUDGET_HARD_STOP: "off" });
  });
});

describe("ai client options", () => {
  it("every OpenAI call gives up after 45 s with one retry, unless AI_TIMEOUT_MS says otherwise", () => {
    assert.deepEqual(models.clientOptions({}), { timeout: 45000, maxRetries: 1 });
    assert.deepEqual(models.clientOptions({ AI_TIMEOUT_MS: "20000" }), { timeout: 20000, maxRetries: 1 });
    assert.equal(models.clientOptions({ AI_TIMEOUT_MS: "999999" }).timeout, 45000, "out of range falls back");
    assert.equal(models.clientOptions({ AI_TIMEOUT_MS: "abc" }).timeout, 45000);
  });
});
