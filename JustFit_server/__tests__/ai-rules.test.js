// AI usage rules (ai/rules.js): pure functions, no database.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../ai/rules.js");
const { ValidationError } = require("../profile.js");

const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof ValidationError && pattern.test(e.message));

describe("ai rules: cost", () => {
  const gpt4o = { input_usd_per_million: "2.5000", output_usd_per_million: "10.0000", request_usd: "0.000000" };

  it("prices tokens per million in dollars, plus a flat per-request cost, converted to rupees", () => {
    assert.equal(rules.costInr(gpt4o, 1_000_000, 0, 80), 200);
    assert.equal(rules.costInr(gpt4o, 1000, 500, 80), 0.6);
    assert.equal(rules.costInr({ ...gpt4o, request_usd: "0.010000" }, 0, 0, 80), 0.8);
    assert.equal(rules.costInr(gpt4o, 1_000_000, 0), 2.5 * rules.DEFAULT_USD_TO_INR, "the default rate when none is set");
  });

  it("a model without a price costs nothing", () => {
    assert.equal(rules.costInr(null, 5000, 5000, 84), 0);
  });

  it("a usage row is checked and cleaned; bad token counts become 0", () => {
    const row = rules.usageRow({ feature: "coach_chat", provider: "openai", model: " gpt-4o ", inputTokens: 12, outputTokens: -3, status: "ok", userId: "u1", durationMs: 1234.6 });
    assert.deepEqual(row, { feature: "coach_chat", provider: "openai", model: "gpt-4o", inputTokens: 12, outputTokens: 0, cachedInputTokens: 0, fromCache: false, status: "ok", userId: "u1", gymId: null, durationMs: 1235 });
    assert.throws(() => rules.usageRow({ feature: "trainer", provider: "openai", model: "x", status: "ok" }), /unknown AI feature/);
    assert.throws(() => rules.usageRow({ feature: "coach_chat", provider: "openai", model: "", status: "ok" }), /needs a model/);
    assert.throws(() => rules.usageRow({ feature: "coach_chat", provider: "openai", model: "x", status: "maybe" }), /unknown AI status/);
  });
});

describe("ai rules: periods and series", () => {
  it("a day is 24 hours, a week 7 dates, a month 30 dates from the start", () => {
    assert.equal(rules.seriesKeys("day", "2026-10-30").length, 24);
    assert.deepEqual(rules.seriesKeys("day", "2026-10-30").slice(0, 2), ["00", "01"]);
    assert.deepEqual(rules.seriesKeys("week", "2026-10-24"), ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    const month = rules.seriesKeys("month", "2026-10-01");
    assert.equal(month.length, 30);
    assert.equal(month.at(-1), "2026-10-30");
  });

  it("fills the gaps with zeros and keeps the numbers", () => {
    const series = rules.fillSeries(["2026-10-29", "2026-10-30"], [{ k: "2026-10-30", requests: "3", tokens: "900", costInr: "1.0080" }]);
    assert.deepEqual(series, [
      { key: "2026-10-29", requests: 0, tokens: 0, costInr: 0 },
      { key: "2026-10-30", requests: 3, tokens: 900, costInr: 1.008 },
    ]);
  });

  it("the summary period defaults to a week and refuses anything else", () => {
    assert.deepEqual(rules.summaryQuery({}), { period: "week" });
    assert.deepEqual(rules.summaryQuery({ period: "day" }), { period: "day" });
    refuses(() => rules.summaryQuery({ period: "year" }), /day, week or month/);
  });
});

describe("ai rules: the history query", () => {
  it("defaults to everything, newest first, page 1", () => {
    assert.deepEqual(rules.historyQuery({}), { search: "", feature: null, status: null, model: null, from: null, to: null, sort: "newest", page: 1 });
  });

  it("keeps a trimmed search (capped) and the filters", () => {
    const q = rules.historyQuery({ search: "  priya ", feature: "food_scan", status: "failed", model: "gpt-4o", from: "2026-10-01", to: "2026-10-30", sort: "cost", page: "3" });
    assert.deepEqual(q, { search: "priya", feature: "food_scan", status: "failed", model: "gpt-4o", from: "2026-10-01", to: "2026-10-30", sort: "cost", page: 3 });
    assert.equal(rules.historyQuery({ search: "x".repeat(200) }).search.length, rules.limits.search);
  });

  it("refuses unknown features, statuses, sorts, bad dates and pages", () => {
    refuses(() => rules.historyQuery({ feature: "trainer" }), /doesn't exist/);
    refuses(() => rules.historyQuery({ status: "ok; DROP TABLE" }), /ok, failed or refused/);
    refuses(() => rules.historyQuery({ sort: "u.cost_usd; --" }), /newest, oldest, cost or tokens/);
    refuses(() => rules.historyQuery({ from: "yesterday" }), /YYYY-MM-DD/);
    refuses(() => rules.historyQuery({ from: "2026-02-30" }), /real day/);
    refuses(() => rules.historyQuery({ from: "2026-10-30", to: "2026-10-01" }), /on or before/);
    refuses(() => rules.historyQuery({ page: "0" }), /page/);
    refuses(() => rules.historyQuery({ page: "1.5" }), /page/);
    refuses(() => rules.historyQuery({ model: "m".repeat(65) }), /too long/);
  });
});

describe("ai rules: the budget", () => {
  const body = (over = {}) => ({ monthlyLimitInr: 4000, usdToInr: 84, alert50: true, alert75: true, alert90: false, alert100: true, spikeAlerts: true, ...over });

  it("accepts a limit between 0 and 1 crore rupees and a rate between 1 and 1000, rounded to paise, and five switches", () => {
    assert.deepEqual(rules.budgetBody(body({ monthlyLimitInr: 1234.567, usdToInr: 83.456 })), body({ monthlyLimitInr: 1234.57, usdToInr: 83.46 }));
    assert.equal(rules.budgetBody(body({ monthlyLimitInr: 0 })).monthlyLimitInr, 0);
  });

  it("refuses bad limits and rates, non-boolean switches and extra fields", () => {
    refuses(() => rules.budgetBody(body({ monthlyLimitInr: -1 })), /between 0 and/);
    refuses(() => rules.budgetBody(body({ monthlyLimitInr: "4000" })), /between 0 and/);
    refuses(() => rules.budgetBody(body({ monthlyLimitInr: 10_000_001 })), /between 0 and/);
    refuses(() => rules.budgetBody(body({ usdToInr: 0 })), /exchange rate/);
    refuses(() => rules.budgetBody(body({ usdToInr: "84" })), /exchange rate/);
    refuses(() => rules.budgetBody(body({ usdToInr: 1001 })), /exchange rate/);
    refuses(() => rules.budgetBody(body({ alert50: "yes" })), /50% alert/);
    refuses(() => rules.budgetBody(body({ adminId: "x" })), /unexpected field: adminId/);
    refuses(() => rules.budgetBody([]), /JSON object/);
  });

  it("alert ids are plain numbers", () => {
    assert.equal(rules.alertId("42"), 42);
    refuses(() => rules.alertId("42 OR 1=1"), /doesn't exist/);
  });

  it("thresholds: only the enabled ones the spend has reached, none without a limit", () => {
    const settings = { alert_50: 1, alert_75: 1, alert_90: 0, alert_100: 1 };
    assert.deepEqual(rules.crossedThresholds(10, 50, settings), []);
    assert.deepEqual(rules.crossedThresholds(25, 50, settings), [50]);
    assert.deepEqual(rules.crossedThresholds(46, 50, settings), [50, 75]); // 92%: the 90 is off
    assert.deepEqual(rules.crossedThresholds(60, 50, settings), [50, 75, 100]);
    assert.deepEqual(rules.crossedThresholds(60, 0, settings), []);
    assert.equal(rules.percentOf(60, 50), 120);
    assert.equal(rules.percentOf(1, 0), 0);
  });

  it("a spike is a day over ₹100 and more than double the recent daily average", () => {
    assert.equal(rules.isSpike(50, 0), false, "too small to matter");
    assert.equal(rules.isSpike(120, 0), true, "a quiet week, then a busy day");
    assert.equal(rules.isSpike(300, 150), false, "exactly double is not a spike");
    assert.equal(rules.isSpike(310, 150), true);
    assert.equal(rules.money(3.456), "₹3.46");
    assert.equal(rules.money(123456.7), "₹1,23,456.70", "Indian grouping");
  });
});
