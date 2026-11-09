// Live gym crowd and best time to visit (JustFit_server/gym/crowdRules.js): the shapes the server
// sends and the words the app shows, pure so they are unit-tested (lib/__tests__/gymCrowd.test.ts).
// "Live" is today's estimate from check-ins; "usual" is the forecast from past weeks. The screens
// always say which one a number is.

export type CrowdLevel = "low" | "moderate" | "busy" | "very_busy";
export type LiveCrowd = {
  kind: "live";
  available: boolean;
  reason: "no_attendance" | "no_capacity" | null;
  inside: number;
  leftWithoutCheckout: number;
  capacity: number | null;
  percent: number | null;
  level: CrowdLevel | null;
  updatedAt: string;
  lastCheckInAt: string | null;
};
export type HourCrowd = { hour: number; expected: number; people?: number; level: CrowdLevel };
export type DayForecast = { date: string; weekday: string; enough: boolean; closed?: boolean; hours: HourCrowd[]; busiest: HourCrowd | null; quietest: HourCrowd | null; bestLeft?: HourCrowd | null };
export type CrowdForecast = {
  kind: "forecast";
  enough: boolean;
  basedOnDays: number;
  relativeLevels: boolean;
  today: DayForecast | null;
  tomorrow: DayForecast | null;
  week: { weekday: string; enough: boolean; hours: HourCrowd[] }[];
};
export type CrowdSettings = { capacity: number | null; avgStayMin: number | null; thresholds: { moderate: number; busy: number; veryBusy: number }; customThresholds: boolean };
export type MemberCrowd = { capacity: number | null; live: LiveCrowd; forecast: CrowdForecast };
export type GymCrowd = { settings: CrowdSettings; stay: { minutes: number; source: "gym" | "history" | "default" }; live: LiveCrowd; forecast: CrowdForecast };

export const LEVEL_LABEL: Record<CrowdLevel, string> = { low: "Low", moderate: "Moderate", busy: "Busy", very_busy: "Very busy" };
export const WEEKDAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const DEFAULT_THRESHOLDS = { moderate: 40, busy: 70, veryBusy: 90 };

// "6 am", "12 pm", "6–7 pm" (an hour's slot)
export function hourText(hour: number): string {
  const h = hour % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
}
export function slotText(hour: number): string {
  const next = (hour + 1) % 24;
  const sameHalf = hour < 12 === next < 12 && next !== 0;
  const end = hourText(next);
  return sameHalf ? `${hour % 12 === 0 ? 12 : hour % 12}–${end}` : `${hourText(hour)}–${end}`;
}

// "about 3 people" / "usually no one"
export function peopleText(expected: number): string {
  const n = Math.round(expected);
  if (n <= 0) return expected > 0 ? "a person now and then" : "usually no one";
  return `about ${n} ${n === 1 ? "person" : "people"}`;
}

// The live card's main line and the line under it
export function liveText(live: LiveCrowd): { title: string; line: string } {
  if (live.reason === "no_attendance") return { title: "Live crowd isn't available yet", line: "It appears once members start checking in with the QR code." };
  const inside = `${live.inside} ${live.inside === 1 ? "person" : "people"} inside`;
  if (live.reason === "no_capacity") return { title: inside, line: "The gym hasn't set its capacity yet, so there's no crowd level." };
  return { title: inside, line: `${live.percent}% of ${live.capacity} · ${LEVEL_LABEL[live.level ?? "low"]}` };
}

// The forecast's headline facts, each with what kind of number it is
export function forecastLines(f: CrowdForecast): { label: string; value: string }[] {
  if (!f.enough || !f.today) return [];
  const out: { label: string; value: string }[] = [];
  const t = f.today;
  if (t.enough && !t.closed && t.quietest) out.push({ label: "Quietest today", value: `${slotText(t.quietest.hour)} · ${peopleText(t.quietest.expected)}` });
  if (t.enough && !t.closed && t.busiest) out.push({ label: "Busiest today", value: `${slotText(t.busiest.hour)} · ${peopleText(t.busiest.expected)}` });
  if (t.bestLeft && t.busiest && t.bestLeft.hour !== t.quietest?.hour) out.push({ label: "Best time left today", value: slotText(t.bestLeft.hour) });
  const m = f.tomorrow;
  if (m?.enough && !m.closed && m.quietest) out.push({ label: "Best time tomorrow", value: `${slotText(m.quietest.hour)} · ${peopleText(m.quietest.expected)}` });
  return out;
}

// "Based on 4 weeks of check-ins" (28 days → 4 weeks; fewer → days)
export function basedOnText(days: number): string {
  if (days >= 14 && days % 7 === 0) return `Based on the last ${days / 7} weeks of check-ins`;
  return `Based on the last ${days} ${days === 1 ? "day" : "days"} of check-ins`;
}

// A bar's height as a share of the tallest (0-1); an empty day stays flat
export function barShare(expected: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, Math.min(1, expected / peak));
}
