// The Membership screens' words (lib/membershipText.ts): dates, the badge and the pause lines
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, allowanceLine, daysBetween, historyLine, membershipBadge, pauseLine, planText, prettyDate } from "../membershipText.ts";

const pause = { id: 1, status: "pending" as const, by: "member" as const, from: "2026-11-10", until: "2026-11-20", days: 11, reason: "Trip", note: null, extendedDays: null, requestedAt: "2026-11-07T10:00:00Z", decidedAt: null };

describe("membership text", () => {
  it("formats dates, plans and day counts", () => {
    assert.equal(prettyDate("2026-11-07"), "7 Nov 2026");
    assert.equal(planText({ duration: 3, unit: "months" }), "3 months");
    assert.equal(planText({ duration: 1, unit: "month" as "months" }), "1 month");
    assert.equal(planText({ duration: 15, unit: "days" }), "15 days");
    assert.equal(daysBetween("2026-11-10", "2026-11-20"), 11);
    assert.equal(addDays("2026-12-31", 7), "2027-01-07");
  });

  it("picks the badge: paused first, then the plan's state", () => {
    assert.deepEqual(membershipBadge({ status: "active", pausedNow: true, pause: { ...pause, status: "approved" }, daysLeft: 40 }), { label: "Paused until 20 Nov 2026", tone: "paused" });
    assert.deepEqual(membershipBadge({ status: "expired", pausedNow: false, pause: null, daysLeft: -3 }), { label: "Expired", tone: "expired" });
    assert.deepEqual(membershipBadge({ status: "expiring", pausedNow: false, pause: null, daysLeft: 0 }), { label: "Expires today", tone: "pending" });
    assert.deepEqual(membershipBadge({ status: "active", pausedNow: false, pause, daysLeft: 1 }), { label: "1 day left", tone: "active" }, "a waiting request doesn't change the badge");
    assert.deepEqual(membershipBadge({ status: "active", pausedNow: false, pause: null, daysLeft: 40 }), { label: "40 days left", tone: "active" });
  });

  it("says where a pause stands", () => {
    assert.equal(pauseLine(pause, "Forma", "2026-11-07"), "Pause requested for 10 Nov 2026 to 20 Nov 2026 (11 days). Waiting for Forma to approve.");
    assert.equal(pauseLine({ ...pause, status: "approved" }, "Forma", "2026-11-07"), "Paused from 10 Nov 2026 to 20 Nov 2026 (11 days). Those days are added to your plan.");
    assert.equal(pauseLine({ ...pause, status: "approved" }, "Forma", "2026-11-12"), "Paused until 20 Nov 2026. Those days are added to your plan.");
    assert.equal(historyLine({ ...pause, status: "rejected", note: "Renew first" }), "Not approved · 10 Nov 2026 to 20 Nov 2026 · “Renew first”");
    assert.equal(historyLine({ ...pause, status: "cancelled" }), "Cancelled · 10 Nov 2026 to 20 Nov 2026");
    assert.equal(historyLine({ ...pause, status: "approved", by: "staff" }), "Paused by the gym · 10 Nov 2026 to 20 Nov 2026");
  });

  it("shows a suspended or cancelled membership first, and what the pause limits leave", () => {
    const base = { status: "active" as const, pausedNow: false, pause: null, daysLeft: 20 };
    assert.deepEqual(membershipBadge({ ...base, standing: "suspended" }), { label: "Suspended", tone: "expired" });
    assert.deepEqual(membershipBadge({ ...base, standing: "cancelled" }), { label: "Cancelled", tone: "expired" });
    assert.equal(membershipBadge({ ...base, standing: "active" }).label, "20 days left");
    const policy = { maxPerYear: 2, maxDaysPerYear: 30, maxDaysEach: 15 };
    assert.equal(allowanceLine({ pausesLeft: 1, daysLeft: 10, used: { count: 1, days: 20 }, policy }), "1 pause and 10 days left in these 12 months · up to 15 days a pause");
    assert.equal(allowanceLine({ pausesLeft: null, daysLeft: null, used: { count: 0, days: 0 }, policy: { maxPerYear: null, maxDaysPerYear: null, maxDaysEach: 90 } }), null);
    assert.equal(allowanceLine(undefined), null);
  });
});
