// Members' meal problems and reports: the pure rules (issues/rules.js, reports/service.js rangeQuery)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../issues/rules");
const reports = require("../reports/service");
const { ValidationError } = require("../profile");

const ORDER = "6f1c2a0e-1111-4222-8333-944455556666";

describe("issue rules", () => {
  it("reads a report on one order or plan", () => {
    assert.deepEqual(rules.issueBody({ orderId: ORDER, category: "missing_meal", description: "The dal was missing from my bag" }), { orderId: ORDER, subscriptionId: null, category: "missing_meal", description: "The dal was missing from my bag" });
    for (const bad of [
      { category: "missing_meal", description: "The dal was missing" },
      { orderId: ORDER, subscriptionId: ORDER, category: "missing_meal", description: "The dal was missing" },
      { orderId: "1 OR 1=1", category: "missing_meal", description: "The dal was missing" },
      { orderId: ORDER, category: "rude", description: "The dal was missing" },
      { orderId: ORDER, category: "other", description: "short" },
      { orderId: ORDER, category: "other", description: "Long enough text", userId: "x" },
    ]) assert.throws(() => rules.issueBody(bad), ValidationError, JSON.stringify(bad));
    assert.equal(rules.issueCode(7), "ISS-0007");
  });

  it("works an issue: notes for closing, refunds within what was paid, reopen only closed ones", () => {
    const open = { status: "open" };
    assert.deepEqual(rules.actionBody("assign", {}, open, 259), { status: "in_progress", assign: true, note: null });
    assert.deepEqual(rules.actionBody("resolve", { note: "Sent a new meal", refund: 100 }, open, 259), { status: "resolved", note: "Sent a new meal", refundPaise: 10000 });
    assert.throws(() => rules.actionBody("resolve", { note: "Refunded", refund: 300 }, open, 259), ValidationError, "more than was paid");
    assert.throws(() => rules.actionBody("resolve", {}, open, 259), ValidationError, "a note is needed");
    assert.throws(() => rules.actionBody("reject", {}, open, 259), ValidationError);
    assert.throws(() => rules.actionBody("note", { note: "x" }, open, 259), ValidationError);
    assert.throws(() => rules.actionBody("progress", {}, { status: "resolved" }, 259), ValidationError, "closed");
    assert.equal(rules.actionBody("reopen", {}, { status: "rejected" }, 259).status, "open");
    assert.throws(() => rules.actionBody("reopen", {}, open, 259), ValidationError);
    assert.throws(() => rules.actionBody("delete", {}, open, 259), ValidationError);
    assert.throws(() => rules.actionBody("resolve", { note: "ok ok", amount: 1 }, open, 259), ValidationError);
  });

  it("reads list and report ranges", () => {
    assert.deepEqual(rules.listQuery({ status: "open" }), { status: "open", search: "" });
    assert.throws(() => rules.listQuery({ status: "lost" }), ValidationError);
    const now = Date.parse("2026-11-10T12:00:00+05:30");
    const r = reports.rangeQuery({}, now);
    assert.deepEqual({ from: r.from, to: r.to, format: r.format }, { from: "2026-10-12", to: "2026-11-10", format: null });
    for (const bad of [{ from: "2026-11-10", to: "2026-11-01" }, { to: "2026-11-11" }, { from: "2026-01-01", to: "2026-11-10" }, { format: "pdf" }, { from: "yesterday" }, { kitchen: "1" }]) {
      assert.throws(() => reports.rangeQuery(bad, now), ValidationError, JSON.stringify(bad));
    }
  });
});
