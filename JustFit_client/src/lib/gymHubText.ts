// Gym Hub's words and the attendance calendar (pure, unit-tested; no React Native). Times are
// India's whatever the phone's zone, as the gym's own records are.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const IST_OFFSET_MS = 330 * 60_000;

// "2026-11" → "November 2026"
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// A month as weeks of 7, Monday first, null where the month hasn't started or has ended
export function monthGrid(month: string): (string | null)[][] {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7; // Monday 0
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// An ISO time as India's clock: "6:05 pm"
export function timeText(iso: string): string {
  const t = new Date(Date.parse(iso) + IST_OFFSET_MS);
  const h = t.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(t.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// 75 → "1 h 15 min", 40 → "40 min"
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

// How much of the plan has gone, 0 to 1, for the progress bar
export function planProgress(joinedOn: string, expiresOn: string, today: string): number {
  const start = Date.parse(`${joinedOn}T00:00:00Z`);
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// "Paused once", "Paused 3 times", "Never paused"
export const pausedTimes = (count: number) => (count === 0 ? "Never paused" : count === 1 ? "Paused once" : `Paused ${count} times`);
