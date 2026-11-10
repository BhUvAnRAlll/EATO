import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CART_REMINDER_ID, ORDER_REMINDER_PREFIX, cartReminderText, indiaClock, orderReminders } from "../orderReminderRules.ts";

// Today 10 Nov: breakfast closes 5:00 AM, lunch 10:30 AM, dinner 5:00 PM India time (UTC+5:30)
type Slot = { slot: "breakfast" | "lunch" | "dinner"; open: boolean; closesAt: string; full?: boolean };
const day = (date: string, extra: Partial<{ holiday: string }> = {}): { date: string; holiday?: string; slots: Slot[] } => ({
  date,
  ...extra,
  slots: [
    { slot: "breakfast", open: true, closesAt: `${prev(date)}T23:30:00.000Z` },
    { slot: "lunch", open: true, closesAt: `${date}T05:00:00.000Z` },
    { slot: "dinner", open: true, closesAt: `${date}T11:30:00.000Z` },
  ],
});
function prev(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

describe("order reminders", () => {
  it("writes India's clock", () => {
    assert.equal(indiaClock("2026-11-10T05:00:00.000Z"), "10:30 AM");
    assert.equal(indiaClock("2026-11-10T11:30:00.000Z"), "5:00 PM");
    assert.equal(indiaClock("2026-11-09T18:30:00.000Z"), "12:00 AM");
  });

  it("reminds 30 minutes before orders close, for meal times not ordered yet", () => {
    const now = new Date("2026-11-10T03:00:00.000Z"); // 8:30 AM India
    const list = orderReminders({ days: [day("2026-11-10"), day("2026-11-11")], ordered: new Set(["2026-11-10:dinner"]), pick: { name: "Paneer Tikka Bowl", price: 199 }, now });
    assert.deepEqual(list.map((r) => r.id), ["justfit-order-2026-11-10-lunch", "justfit-order-2026-11-11-breakfast", "justfit-order-2026-11-11-lunch"]);
    assert.equal(list[0].at.toISOString(), "2026-11-10T04:30:00.000Z", "10:00 AM India, half an hour before lunch closes");
    assert.equal(list[0].title, "Lunch orders close at 10:30 AM");
    assert.equal(list[0].body, "Paneer Tikka Bowl fits your day · ₹199. Order now on justFit.");
    assert.equal(list[1].body, "Order a meal that fits your goal on justFit.", "only the first names the meal");
  });

  it("skips the past, closed, full and holiday meal times", () => {
    const now = new Date("2026-11-10T04:45:00.000Z"); // past lunch's reminder time
    const today = day("2026-11-10");
    today.slots[2] = { ...today.slots[2], full: true };
    const list = orderReminders({ days: [today, day("2026-11-11", { holiday: "Diwali" })], ordered: new Set(), pick: null, now });
    assert.deepEqual(list, []);
    const closed = day("2026-11-10");
    closed.slots = closed.slots.map((s) => ({ ...s, open: false }));
    assert.deepEqual(orderReminders({ days: [closed], ordered: new Set(), pick: null, now: new Date("2026-11-10T00:00:00Z") }), []);
  });

  it("nudges about a cart left waiting", () => {
    assert.deepEqual(cartReminderText(["Paneer Tikka Bowl"]), { title: "Your Paneer Tikka Bowl is waiting", body: "Finish your order on justFit before the meal time closes." });
    assert.equal(cartReminderText(["Dal Rice", "Egg Bhurji", "Poha"])?.title, "Your Dal Rice and 2 more are waiting");
    assert.equal(cartReminderText([]), null);
    assert.ok(CART_REMINDER_ID.startsWith(ORDER_REMINDER_PREFIX), "cleared with the order reminders (switch off, sign-out)");
  });
});
