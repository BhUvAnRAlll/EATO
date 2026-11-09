// A branch's public profile (Gym Hub phase 2; pure, unit-tested, no React Native): the facility
// labels, the weekdays, and the opening hours' times and checks. The server's gym/profileRules.js
// holds the same lists and checks again; these only shape the screen.

export type FacilityId =
  | "cardio" | "weights" | "machines" | "functional" | "personal_training" | "group_classes" | "yoga" | "zumba" | "steam"
  | "lockers" | "showers" | "changing_rooms" | "ac" | "parking" | "drinking_water" | "wifi" | "women_batch" | "supplements";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
// Up to two sessions a day, each [opens, closes] as "HH:MM"; [] is closed that day
export type Session = [string, string];
export type OpeningHours = Record<Day, Session[]>;

export const FACILITIES: { id: FacilityId; label: string }[] = [
  { id: "cardio", label: "Cardio machines" },
  { id: "weights", label: "Free weights" },
  { id: "machines", label: "Strength machines" },
  { id: "functional", label: "Functional training" },
  { id: "personal_training", label: "Personal training" },
  { id: "group_classes", label: "Group classes" },
  { id: "yoga", label: "Yoga" },
  { id: "zumba", label: "Zumba / dance" },
  { id: "steam", label: "Steam / sauna" },
  { id: "lockers", label: "Lockers" },
  { id: "showers", label: "Showers" },
  { id: "changing_rooms", label: "Changing rooms" },
  { id: "ac", label: "Air conditioned" },
  { id: "parking", label: "Parking" },
  { id: "drinking_water", label: "Drinking water" },
  { id: "wifi", label: "Wi-Fi" },
  { id: "women_batch", label: "Women-only batch" },
  { id: "supplements", label: "Supplement counter" },
];

export const DAYS: { id: Day; short: string; label: string }[] = [
  { id: "mon", short: "Mon", label: "Monday" },
  { id: "tue", short: "Tue", label: "Tuesday" },
  { id: "wed", short: "Wed", label: "Wednesday" },
  { id: "thu", short: "Thu", label: "Thursday" },
  { id: "fri", short: "Fri", label: "Friday" },
  { id: "sat", short: "Sat", label: "Saturday" },
  { id: "sun", short: "Sun", label: "Sunday" },
];

export const ABOUT_MAX = 500;
export const DETAILS_MAX = 300;
export const MAX_SESSIONS = 2;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, "0");

// Every half hour from 04:00 to 23:30, the times the picker offers
export const TIME_SLOTS: string[] = Array.from({ length: 40 }, (_, i) => `${pad(4 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);

// "05:30" → "5:30 am", "12:00" → "12 pm", "22:00" → "10 pm"
export function timeLabel(time: string): string {
  const h = Number(time.slice(0, 2));
  const m = time.slice(3, 5);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m === "00" ? "" : `:${m}`} ${h < 12 ? "am" : "pm"}`;
}

// "5:30 am – 11 am, 4 pm – 10 pm" or "Closed"
export function dayText(sessions: Session[]): string {
  return sessions.length === 0 ? "Closed" : sessions.map(([open, close]) => `${timeLabel(open)} – ${timeLabel(close)}`).join(", ");
}

// A typical Indian gym's week to start from: mornings and evenings Monday to Saturday, Sunday morning
export function startingHours(): OpeningHours {
  const weekday: Session[] = [["05:30", "10:30"], ["16:30", "21:30"]];
  return { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: weekday, sun: [["06:00", "10:00"]] };
}

// Monday's sessions on every day (the rest keep nothing of their own)
export function copyToAll(hours: OpeningHours, from: Day): OpeningHours {
  return Object.fromEntries(DAYS.map((d) => [d.id, hours[from].map((s) => [...s] as Session)])) as OpeningHours;
}

// The first thing wrong with a day's sessions, or null (the server's rules)
export function sessionsProblem(sessions: Session[]): string | null {
  if (sessions.length > MAX_SESSIONS) return `A day can have up to ${MAX_SESSIONS} sessions.`;
  let lastClose = -1;
  for (const [open, close] of sessions) {
    if (minutes(open) >= minutes(close)) return "Each session must open before it closes.";
    if (minutes(open) <= lastClose) return "The second session must start after the first one ends.";
    lastClose = minutes(close);
  }
  return null;
}

// The week's first problem as "Monday: …", or null
export function hoursProblem(hours: OpeningHours): string | null {
  for (const day of DAYS) {
    const problem = sessionsProblem(hours[day.id]);
    if (problem) return `${day.label}: ${problem}`;
  }
  return null;
}

// A second session after the first: an hour after it closes, three hours long, within the slots
export function nextSession(sessions: Session[]): Session {
  if (sessions.length === 0) return ["06:00", "10:00"];
  const after = Math.min(minutes(sessions[sessions.length - 1][1]) + 60, 22 * 60);
  const end = Math.min(after + 180, 23 * 60 + 30);
  const at = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return [at(after), at(end)];
}

// Whether two weeks are the same (to know if anything changed)
export const sameHours = (a: OpeningHours | null, b: OpeningHours | null) => JSON.stringify(a) === JSON.stringify(b);
