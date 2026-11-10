// Order reminders (pure, unit-tested; 2026-11-10): "Lunch orders close at 10:30 AM", 30 minutes
// before each of today's and tomorrow's meal times stops taking orders, for a meal time the member
// hasn't ordered yet and justFit is still taking orders for. The first one names a meal picked for
// them. The phone schedules them itself (lib/orderReminders.ts); nothing goes through a server.

export const ORDER_REMINDER_PREFIX = "justfit-order-";
export const ORDER_REMINDER_LEAD_MIN = 30;
export const ORDER_REMINDER_ROUTE = "/meals";

type Slot = "breakfast" | "lunch" | "dinner";
type OrderDaySlots = { date: string; holiday?: string | null; slots: { slot: Slot; open: boolean; closesAt: string; full?: boolean }[] };
export type OrderReminder = { id: string; at: Date; title: string; body: string };

const LABEL: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

/** "2026-11-10T05:00:00.000Z" → "10:30 AM", in India's time (UTC+5:30) whatever the phone's zone */
export function indiaClock(iso: string): string {
  const minutes = Math.floor(Date.parse(iso) / 60000 + 330);
  const inDay = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(inDay / 60);
  const m = inDay % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The reminders to schedule now. `days`: GET /api/orders/options' days (today first); `ordered`:
 * "date:slot" of the member's orders that aren't cancelled; `pick`: a meal to name in the first one.
 * At most `max`, soonest first, never in the past (or within a minute).
 */
export function orderReminders({ days, ordered, pick, now, max = 3 }: { days: OrderDaySlots[]; ordered: Set<string>; pick: { name: string; price: number } | null; now: Date; max?: number }): OrderReminder[] {
  const list: OrderReminder[] = [];
  for (const day of days.slice(0, 2)) {
    if (day.holiday) continue;
    for (const s of day.slots) {
      if (!s.open || s.full || ordered.has(`${day.date}:${s.slot}`)) continue;
      const at = new Date(Date.parse(s.closesAt) - ORDER_REMINDER_LEAD_MIN * 60000);
      if (!(at.getTime() > now.getTime() + 60000)) continue;
      list.push({ id: `${ORDER_REMINDER_PREFIX}${day.date}-${s.slot}`, at, title: `${LABEL[s.slot]} orders close at ${indiaClock(s.closesAt)}`, body: "" });
    }
  }
  return list
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, max)
    .map((r, i) => ({ ...r, body: i === 0 && pick ? `${pick.name} fits your day · ₹${pick.price}. Order now on justFit.` : "Order a meal that fits your goal on justFit." }));
}
