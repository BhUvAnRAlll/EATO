// Formatting for the AI Coach's Insights tab (components/coach/InsightsTab.tsx). Pure: no React
// Native imports, so it is unit-tested on its own.
import type { WeightInsights } from "./coachInsights";

const DAY_MS = 24 * 60 * 60 * 1000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "2 – 8 Nov" or "27 Oct – 2 Nov" */
export function weekRange(start: string, end: string): string {
  const s = utc(start);
  const e = utc(end);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return s.getUTCMonth() === e.getUTCMonth() ? `${s.getUTCDate()} – ${e.getUTCDate()} ${month(e)}` : `${s.getUTCDate()} ${month(s)} – ${e.getUTCDate()} ${month(e)}`;
}

/** One-letter weekday for a date ("M") */
export const weekdayLetter = (iso: string) => "SMTWTFS"[utc(iso).getUTCDay()];

/** "12 Oct" */
export const shortDay = (iso: string) => utc(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Whole days between two dates */
export const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);

/** "+1.2 kg", "−0.8 kg", "No change" */
export function kgChange(change: number): string {
  if (change === 0) return "No change";
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} kg`;
}

/** Is this weight change the way the member wants to go? null when they didn't say, or no change */
export function changeIsGood(change: number, direction: WeightInsights["direction"]): boolean | null {
  if (change === 0 || !direction) return null;
  if (direction === "maintain") return Math.abs(change) <= 0.5;
  return direction === "lose" ? change < 0 : change > 0;
}
