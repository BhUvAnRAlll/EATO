// Gym reviews (Gym Profile phase 4, 2026-11-09): what a member and the gym may send, the reviewer's
// name as others see it, and the summary (hidden reviews' stars still count)
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/reviewRules");

describe("Gym review rules", () => {
  it("takes 1 to 5 whole stars and an optional comment, tidied", () => {
    assert.deepEqual(rules.reviewBody({ rating: 5, comment: "  Great   trainers.\r\n\n\n\nClean.  " }), { rating: 5, comment: "Great trainers.\n\nClean." });
    assert.deepEqual(rules.reviewBody({ rating: 1 }), { rating: 1, comment: null });
    assert.deepEqual(rules.reviewBody({ rating: 3, comment: "   " }), { rating: 3, comment: null });
  });

  it("refuses a bad rating, a bad comment and anything unexpected", () => {
    for (const [payload, message] of [
      [{ rating: 0 }, /1 to 5/],
      [{ rating: 6 }, /1 to 5/],
      [{ rating: 4.5 }, /1 to 5/],
      [{ rating: "5" }, /1 to 5/],
      [{}, /1 to 5/],
      [{ rating: 4, comment: "x".repeat(501) }, /500 characters/],
      [{ rating: 4, comment: "ok" }, /few more words/],
      [{ rating: 4, comment: 5 }, /as text/],
      [{ rating: 4, comment: "bad\u0007bell" }, /can't show/],
      [{ rating: 4, userId: "user_x" }, /Unexpected field/],
      [{ rating: 4, gymId: 2 }, /Unexpected field/],
      [[], /as an object/],
      [null, /as an object/],
    ]) assert.throws(() => rules.reviewBody(payload), message, JSON.stringify(payload));
  });

  it("takes the gym's reply and a reason to hide, and nothing about the rating", () => {
    assert.deepEqual(rules.replyBody({ text: " Thank you! " }), { reply: "Thank you!" });
    assert.throws(() => rules.replyBody({ text: "" }), /reply first/);
    assert.throws(() => rules.replyBody({ text: "x".repeat(501) }), /500 characters/);
    assert.throws(() => rules.replyBody({ text: "Thanks", rating: 5 }), /Unexpected field: rating/);
    for (const reason of rules.HIDE_REASONS) assert.deepEqual(rules.hideBody({ reason }), { reason });
    assert.throws(() => rules.hideBody({ reason: "bad_rating" }), /Pick why/);
    assert.throws(() => rules.hideBody({ reason: "spam", rating: 5 }), /Unexpected field: rating/);
  });

  it("reads the portal's and the member's query strings", () => {
    assert.deepEqual(rules.reviewsQuery({}), { view: "all", page: 1 });
    assert.deepEqual(rules.reviewsQuery({ view: "hidden", page: "3" }), { view: "hidden", page: 3 });
    assert.throws(() => rules.reviewsQuery({ view: "deleted" }), /Pick All/);
    assert.throws(() => rules.reviewsQuery({ page: "0" }), /page from 1/);
    assert.throws(() => rules.reviewsQuery({ page: "1 OR 1=1" }), /page from 1/);
    assert.throws(() => rules.reviewsQuery({ sort: "rating" }), /Unexpected filter/);
    assert.deepEqual(rules.memberQuery({ page: "2" }), { page: 2 });
    assert.throws(() => rules.memberQuery({ view: "hidden" }), /Unexpected filter/);
  });

  it("names a reviewer by first name and initial only", () => {
    assert.equal(rules.reviewerName("Arjun Mehta"), "Arjun M.");
    assert.equal(rules.reviewerName("  arjun  kumar  mehta "), "arjun M.");
    assert.equal(rules.reviewerName("Priya"), "Priya");
    assert.equal(rules.reviewerName(""), "justFit member");
    assert.equal(rules.reviewerName(null), "justFit member");
  });

  it("averages every review to one decimal and counts each number of stars", () => {
    assert.deepEqual(rules.summary([]), { average: null, count: 0, counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
    assert.deepEqual(rules.summary([{ rating: 5, n: 2 }, { rating: 4, n: "1" }, { rating: 1, n: 1 }]), { average: 3.8, count: 4, counts: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 1 } });
  });
});
