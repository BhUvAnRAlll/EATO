// QR attendance's words for times and lengths, shared by the gym portal and the member app.
// Gyms are in India, so clock times are India's (UTC+5:30) whatever the phone's own zone.

const IST_OFFSET_MS = 330 * 60 * 1000;

// "6:05 pm" from an ISO instant
export function clockTime(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

// "4 Nov" from an ISO instant (India's date)
export function dayOf(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

// "45 min", "1 h", "1 h 15 min"
export function durationText(minutes: number | null): string {
  if (minutes === null || minutes < 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// India's date, n days from today, as YYYY-MM-DD
export function indiaDay(offsetDays = 0, now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}

export const STATUS_TEXT = { inside: "Inside", completed: "Completed", no_checkout: "No check-out" } as const;
