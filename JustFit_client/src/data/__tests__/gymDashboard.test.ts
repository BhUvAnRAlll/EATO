// The gym portal's small input helpers (data/gymDashboard.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { daysFromToday, dobFromText, dobInput, followUpText, phoneInput, referrerText, todayIso } from "../gymDashboard.ts";

describe("gym portal inputs", () => {
  it("mobile numbers keep to 10 digits, whatever is typed or pasted", () => {
    assert.equal(phoneInput("9876543210"), "9876543210");
    assert.equal(phoneInput("98765 43210"), "9876543210");
    assert.equal(phoneInput("+91 98765-43210"), "9876543210", "a pasted +91");
    assert.equal(phoneInput("919876543210"), "9876543210");
    assert.equal(phoneInput("09876543210"), "9876543210", "a leading 0");
    assert.equal(phoneInput("84546345584"), "8454634558", "an 11th digit is never kept");
    assert.equal(phoneInput("98a76"), "9876");
  });

  it("dates of birth are typed as DD-MM-YYYY", () => {
    assert.equal(dobInput("30072004"), "30-07-2004");
    assert.equal(dobFromText("30-07-2004"), "2004-07-30");
    assert.equal(dobFromText("30-07-04"), null);
  });

  // QA 2026-11-04: "today" was the phone's date, so a device in UTC before 05:30 IST defaulted to
  // yesterday and the server (India's date) refused due dates and payment dates by a day
  it("today and the days around it are India's dates, whatever the device's zone", () => {
    const lateUtc = new Date("2026-11-04T20:00:00Z"); // 01:30 on 5 Nov in India
    assert.equal(todayIso(lateUtc), "2026-11-05");
    assert.equal(daysFromToday(0, lateUtc), "2026-11-05");
    assert.equal(daysFromToday(7, lateUtc), "2026-11-12");
    assert.equal(daysFromToday(-365, lateUtc), "2025-11-05");
    assert.equal(todayIso(new Date("2026-11-04T18:29:00Z")), "2026-11-04", "23:59 in India");
  });

  it("an enquiry's follow-up line: today, overdue, tomorrow or the date", () => {
    const today = "2026-11-05";
    assert.deepEqual(followUpText(today, today), { tone: "today", text: "Follow up today" });
    assert.deepEqual(followUpText("2026-11-04", today), { tone: "overdue", text: "Overdue by 1 day" });
    assert.deepEqual(followUpText("2026-10-26", today), { tone: "overdue", text: "Overdue by 10 days" });
    assert.deepEqual(followUpText("2026-11-06", today), { tone: "later", text: "Follow up tomorrow" });
    assert.equal(followUpText("2026-12-01", today).tone, "later");
    assert.match(followUpText("2026-12-01", today).text, /^Follow up on 1 Dec 2026$/);
    assert.deepEqual(followUpText("2027-01-01", "2026-12-31"), { tone: "later", text: "Follow up tomorrow" }, "across a year end");
  });
});

describe("referrerText", () => {
  it("names a member referrer, else shows the number, and nothing without a referral", () => {
    assert.equal(referrerText({ phone: "+919876543210", member: { name: "Ravi Kumar", code: "FOR-TUM-0003" } }), "Referred by Ravi Kumar (FOR-TUM-0003)");
    assert.equal(referrerText({ phone: "+919876543210", member: null }), "Referred by +91 98765 43210");
    assert.equal(referrerText(null), null);
  });
});
