/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attendance, codeFromScan, formatCode, hoursText, isEventPast, membershipButton, parseFacilities, parseHours, parseTiers, splitEvents, tiersText } from "../gymRules.ts";

describe("gym rules", () => {
  it("the membership button follows the membership and how the gym is joined", () => {
    assert.deepEqual(membershipButton(null, "join"), { label: "Join Gym", action: "join", tone: "primary" });
    assert.deepEqual(membershipButton(null, "request"), { label: "Request to Join", action: "request", tone: "primary" });
    assert.equal(membershipButton({ role: "member", status: "pending" }, "request").action, "cancel");
    assert.equal(membershipButton({ role: "member", status: "suspended" }, "join").action, null);
    assert.deepEqual(membershipButton({ role: "member", status: "active" }, "join"), { label: "Joined", action: "leave", tone: "soft" });
    assert.deepEqual(membershipButton({ role: "owner", status: "active" }, "join"), { label: "Owner", action: null, tone: "soft" }, "the owner can't leave");
  });

  it("events split by the member's clock: upcoming soonest first, past latest first", () => {
    const now = new Date(2026, 9, 20, 9, 0);
    const events = [
      { id: "later", date: "2026-10-25", startTime: "07:00", endTime: "08:00" },
      { id: "earlier-today", date: "2026-10-20", startTime: "06:00", endTime: "07:00" },
      { id: "running", date: "2026-10-20", startTime: "08:30", endTime: "10:00" },
      { id: "last-week", date: "2026-10-13", startTime: "06:00", endTime: "07:00" },
    ];
    const { upcoming, past } = splitEvents(events, now);
    assert.deepEqual(upcoming.map((e) => e.id), ["running", "later"]);
    assert.deepEqual(past.map((e) => e.id), ["earlier-today", "last-week"]);
    assert.equal(isEventPast({ date: "2026-10-20", endTime: "09:00" }, now), true, "ending now counts as past");
  });

  it("attendance and codes read naturally", () => {
    assert.equal(attendance({ attendeeCount: 3, maxAttendees: null }), "3 going");
    assert.equal(attendance({ attendeeCount: 3, maxAttendees: 12 }), "3 of 12 going");
    assert.equal(attendance({ attendeeCount: 12, maxAttendees: 12 }), "Full · 12 of 12");
    assert.equal(formatCode("ABCDEFGH"), "ABCD-EFGH");
    assert.equal(formatCode("ABCDE23456"), "ABCDE23456");
  });

  it("the profile editor's plain-text lists round-trip", () => {
    const hours = parseHours("Mon–Fri: 5am–11pm\n\nSat: 6am–8pm\nno colon here\n: missing label");
    assert.deepEqual(hours, [{ label: "Mon–Fri", value: "5am–11pm" }, { label: "Sat", value: "6am–8pm" }]);
    assert.equal(hoursText(hours), "Mon–Fri: 5am–11pm\nSat: 6am–8pm");
    const tiers = parseTiers("Basic | ₹1,499/mo | Floor | lockers\nNo price");
    assert.deepEqual(tiers, [{ name: "Basic", price: "₹1,499/mo", perks: "Floor | lockers" }]);
    assert.equal(tiersText(tiers), "Basic | ₹1,499/mo | Floor | lockers");
    assert.deepEqual(parseFacilities("Free weights, Sauna\nPool,, "), ["Free weights", "Sauna", "Pool"]);
  });

  it("a scanned QR code gives back the gym code, from a link or bare", () => {
    assert.equal(codeFromScan("eato://community/gyms/invite/ABCD2345"), "ABCD2345");
    assert.equal(codeFromScan("http://localhost:8081/community/gyms/invite/abcd2345?x=1"), "ABCD2345");
    assert.equal(codeFromScan(" abcd-2345 "), "ABCD2345");
    assert.equal(codeFromScan("ABCDE23456"), "ABCDE23456");
    assert.equal(codeFromScan("https://example.com/something-else"), null);
    assert.equal(codeFromScan("hello"), null);
  });
});
