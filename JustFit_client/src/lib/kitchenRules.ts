// Kitchens' small rules for the Super Admin's screens (pure, unit-tested in
// lib/__tests__/kitchenRules.test.ts). The server checks everything again (kitchens/rules.js).
import type { Day, OpeningHours } from "./gymProfile.ts";

export const WEEK: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_SHORT: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** One opening and closing time for the open days; closed days are empty */
export function hoursFrom(opens: string, closes: string, closed: Day[]): OpeningHours {
  return Object.fromEntries(WEEK.map((d) => [d, closed.includes(d) ? [] : [[opens, closes]]])) as OpeningHours;
}

/** The form's view of saved hours: the first open day's first session, and the closed days */
export function hoursToForm(hours: OpeningHours | null | undefined): { opens: string; closes: string; closed: Day[] } {
  const first = WEEK.map((d) => hours?.[d]?.[0]).find(Boolean);
  return { opens: first?.[0] ?? "06:00", closes: first?.[1] ?? "22:00", closed: hours ? WEEK.filter((d) => (hours[d] ?? []).length === 0) : [] };
}

/** Why the hours can't be saved, or null */
export function hoursProblem(opens: string, closes: string, closed: Day[]): string | null {
  if (!TIME.test(opens) || !TIME.test(closes)) return "Write the times like 06:00 or 22:30.";
  if (opens >= closes) return "The kitchen must open before it closes.";
  if (closed.length === WEEK.length) return "Keep the kitchen open on at least one day.";
  return null;
}

/** "560095, 560034 560095" → ["560034", "560095"]; null when any isn't a 6-digit pincode */
export function parsePincodes(text: string): string[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0 || parts.some((p) => !/^[1-9][0-9]{5}$/.test(p))) return null;
  return [...new Set(parts)].sort();
}

/** "Mon–Sat 6:00 am – 10:00 pm · Sun closed" style line for a kitchen's hours */
export function hoursLine(hours: OpeningHours): string {
  const { opens, closes, closed } = hoursToForm(hours);
  const clock = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };
  const time = `${clock(opens)} – ${clock(closes)}`;
  if (closed.length === 0) return `Every day ${time}`;
  if (closed.length === WEEK.length) return "Closed every day";
  return `${time} · closed ${closed.map((d) => DAY_SHORT[d]).join(", ")}`;
}

/** How full the kitchens are: "62% of today's capacity" or null */
export function loadText(load: number | null): string | null {
  return load === null ? null : `${load}% of today's capacity`;
}
