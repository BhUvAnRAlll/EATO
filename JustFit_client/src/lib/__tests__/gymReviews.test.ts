import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HIDE_REASONS, averageText, countText, hideReasonText, ratingLabel, reviewDateText, starShares, starWord } from "../gymReviews.ts";

const summary = { average: 3.8, count: 4, counts: { "5": 2, "4": 1, "3": 0, "2": 0, "1": 1 } };

describe("Gym review words", () => {
  it("names the ratings and the gym's reasons to hide", () => {
    assert.deepEqual([starWord(1), starWord(5), starWord(0)], ["Poor", "Excellent", ""]);
    assert.deepEqual(HIDE_REASONS.map((r) => r.id), ["abusive", "spam", "personal", "not_member", "other"]);
    assert.equal(hideReasonText("spam"), "Spam or advertising");
    assert.equal(hideReasonText(null), "Hidden");
  });

  it("writes the average, the count and a screen reader's line", () => {
    assert.deepEqual([averageText(4), averageText(3.8), averageText(null)], ["4.0", "3.8", null]);
    assert.deepEqual([countText(1), countText(1200)], ["1 review", "1,200 reviews"]);
    assert.equal(ratingLabel(summary), "Rated 3.8 out of 5 from 4 reviews");
    assert.equal(ratingLabel({ average: null, count: 0, counts: { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 } }), "No reviews yet");
  });

  it("shares each number of stars, 5 first", () => {
    assert.deepEqual(starShares(summary).map((s) => [s.stars, s.count, s.share]), [[5, 2, 0.5], [4, 1, 0.25], [3, 0, 0], [2, 0, 0], [1, 1, 0.25]]);
  });

  it("dates a review in India's calendar", () => {
    const now = Date.parse("2026-11-09T10:00:00Z");
    assert.equal(reviewDateText("2026-11-09T01:00:00Z", now), "Today");
    assert.equal(reviewDateText("2026-11-08T19:00:00Z", now), "Today", "after midnight in India");
    assert.equal(reviewDateText("2026-11-08T10:00:00Z", now), "Yesterday");
    assert.equal(reviewDateText("2026-11-03T10:00:00Z", now), "3 Nov 2026");
    assert.equal(reviewDateText(null, now), "");
  });
});
