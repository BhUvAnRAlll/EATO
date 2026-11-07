// Date arithmetic on YYYY-MM-DD strings, the same rules as the server's gym/rules.js, so the
// end date the form shows is the one the server will save. No `@/` imports: node runs the tests
// on this file directly.

// New plans and PT packages are whole months, 1 to 24 (day plans ended on 2026-11-07)
export const PLAN_MAX_MONTHS = 24;

export const addDaysIso = (iso: string, count: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

// Whole months on, kept on a real day (31 Jan + 1 month → 28/29 Feb)
export function addMonthsIso(iso: string, count: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// The last day a plan or PT starting on `start` covers: `months` months end the day before the
// same date (1 Jan for 1 month ends on 31 Jan)
export const planEndIso = (start: string, months: number) => addDaysIso(addMonthsIso(start, months), -1);

// The latest end date a period starting on `start` may have (24 months)
export const latestEndIso = (start: string) => planEndIso(start, PLAN_MAX_MONTHS);

// The whole months that run from `start` to `end` inclusive (1 Jan to 31 Jan is 1), or null when
// the end doesn't fall on a whole month, is past 24 months, or is before the start
export function monthsBetween(start: string, end: string): number | null {
  if (end < start) return null;
  for (let months = 1; months <= PLAN_MAX_MONTHS; months += 1) {
    const monthEnd = planEndIso(start, months);
    if (monthEnd === end) return months;
    if (monthEnd > end) break;
  }
  return null;
}
