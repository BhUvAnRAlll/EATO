import type { PlanLength, PlanUnit } from "@/lib/gymApi";

// Date arithmetic on YYYY-MM-DD strings, the same rules as the server's gym/rules.js, so the
// end date the form shows is the one the server will save.

const MAX_MONTHS = 24;
const MAX_DAYS = 365;

export const addDaysIso = (iso: string, count: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

// Whole months on, kept on a real day (31 Jan + 1 month → 28/29 Feb)
export function addMonthsIso(iso: string, count: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// The last day a plan or PT starting on `start` covers: `count` months end the day before the
// same date; `count` days include the start day
export const planEndIso = (start: string, count: number, unit: PlanUnit) => (unit === "days" ? addDaysIso(start, count - 1) : addDaysIso(addMonthsIso(start, count), -1));

// The latest end date a period starting on `start` may have (24 months)
export const latestEndIso = (start: string) => planEndIso(start, MAX_MONTHS, "months");

// The length that runs from `start` to `end` inclusive: whole months when the end falls on one
// (1 Jan to 31 Jan is 1 month), else days up to a year; null when it's neither (a span over a
// year that isn't whole months, or an end before the start).
export function lengthBetween(start: string, end: string): PlanLength | null {
  if (end < start) return null;
  for (let months = 1; months <= MAX_MONTHS; months += 1) {
    const monthEnd = planEndIso(start, months, "months");
    if (monthEnd === end) return { unit: "months", duration: months };
    if (monthEnd > end) break;
  }
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return days <= MAX_DAYS ? { unit: "days", duration: days } : null;
}
