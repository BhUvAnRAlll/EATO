// Gym Hub › Book a free trial (2026-11-10; pure, unit-tested): the choices on the trial sheet, the
// details filled in from the member's profile, the next days to pick from, and where a trial stands
// in the member's words. The server checks everything again (gym/trialRules.js).

export type TrialGender = "male" | "female" | "other";
export type TrialGoal = "lose_weight" | "build_muscle" | "get_fit" | "strength" | "other";
export type TrialExperience = "new" | "some" | "regular";
export type TrialTime = "morning" | "afternoon" | "evening";
export type TrialStatus = "requested" | "scheduled" | "done" | "no_show" | "cancelled";
export type TrialInfo = {
  status: TrialStatus;
  details: { age: number | null; gender: TrialGender | null; goal: TrialGoal | null; experience: TrialExperience | null; day: string; time: TrialTime } | null;
  preferred: string | null;
  at: { day: string; time: string; text: string } | null;
};

export const TRIAL_GENDERS: { id: TrialGender; label: string }[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
];
export const TRIAL_GOALS: { id: TrialGoal; label: string }[] = [
  { id: "lose_weight", label: "Lose weight" },
  { id: "build_muscle", label: "Build muscle" },
  { id: "get_fit", label: "Get fit" },
  { id: "strength", label: "Get stronger" },
  { id: "other", label: "Other" },
];
export const TRIAL_EXPERIENCE: { id: TrialExperience; label: string }[] = [
  { id: "new", label: "New to the gym" },
  { id: "some", label: "Trained before" },
  { id: "regular", label: "Train regularly" },
];
export const TRIAL_TIMES: { id: TrialTime; label: string; hint: string }[] = [
  { id: "morning", label: "Morning", hint: "Before 12" },
  { id: "afternoon", label: "Afternoon", hint: "12 to 5" },
  { id: "evening", label: "Evening", hint: "After 5" },
];
export const TRIAL_AHEAD_DAYS = 14;
export const TRIAL_NOTE_MAX = 200;

type ProfileBits = { fullName?: string | null; dob?: string | null; gender?: string | null; goal?: string | null } | null;

/** Whole years from a YYYY-MM-DD birthday to today, or null outside 13-90 */
export function ageOn(dob: string | null | undefined, today: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age >= 13 && age <= 90 ? age : null;
}

// The setup goal → the trial's closest goal
const GOAL_FROM_PROFILE: Record<string, TrialGoal> = { fat_loss: "lose_weight", muscle_gain: "build_muscle", maintenance: "get_fit", healthy_eating: "get_fit" };

/** The sheet's starting values from what justFit already knows (everything can be changed) */
export function trialPrefill(profile: ProfileBits, accountName: string | null | undefined, today: string) {
  const gender = profile?.gender;
  return {
    name: (profile?.fullName?.trim() || accountName?.trim() || "").slice(0, 80),
    age: ageOn(profile?.dob, today),
    gender: gender === "male" || gender === "female" || gender === "other" ? (gender as TrialGender) : null,
    goal: profile?.goal ? GOAL_FROM_PROFILE[profile.goal] ?? null : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Today and the next days to pick from: [{ day, top: "Today" | "Mon", bottom: "15 Nov" }] */
export function trialDays(today: string, count = TRIAL_AHEAD_DAYS + 1) {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(today, i);
    const d = new Date(`${day}T00:00:00Z`);
    return { day, top: i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[d.getUTCDay()], bottom: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
  });
}

/** Where the trial stands, for the gym's page */
export function trialStateText(trial: TrialInfo, gym: string): { label: string; line: string; tone: "pending" | "active" | "paused" } {
  switch (trial.status) {
    case "scheduled": return { label: "Booked", line: trial.at ? `Your trial at ${gym} is on ${trial.at.text}.` : `${gym} booked your trial.`, tone: "active" };
    case "done": return { label: "Done", line: `Hope you enjoyed the trial at ${gym}. They'll help you join.`, tone: "active" };
    case "no_show": return { label: "Missed", line: `You missed the trial at ${gym}. They'll be in touch.`, tone: "paused" };
    case "cancelled": return { label: "Cancelled", line: "You cancelled this trial. You can ask for another.", tone: "paused" };
    default: return { label: "Requested", line: `${gym} will call you to fix the time${trial.preferred ? ` (you asked for ${trial.preferred})` : ""}.`, tone: "pending" };
  }
}

export const openTrial = (trial: TrialInfo | null | undefined) => trial?.status === "requested" || trial?.status === "scheduled";

// ---- the gym's side ----

const label = <T extends string>(list: { id: T; label: string }[], id: T | null | undefined) => list.find((o) => o.id === id)?.label ?? null;

/** The member's details on one line for the gym: "27 · Male · Build muscle · Trained before" */
export function trialDetailsText(trial: TrialInfo): string | null {
  const d = trial.details;
  if (!d) return null;
  const parts = [d.age !== null ? `${d.age} yrs` : null, label(TRIAL_GENDERS, d.gender), label(TRIAL_GOALS, d.goal), label(TRIAL_EXPERIENCE, d.experience)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The trial line on an enquiry card */
export function trialCardText(trial: TrialInfo): string {
  switch (trial.status) {
    case "scheduled": return trial.at ? `Free trial booked · ${trial.at.text}` : "Free trial booked";
    case "done": return "Free trial done · follow up to join";
    case "no_show": return "Free trial missed";
    case "cancelled": return "Free trial cancelled by the member";
    default: return `Free trial requested${trial.preferred ? ` · prefers ${trial.preferred}` : ""}`;
  }
}

// Quick times for booking, by the time of day the member asked for (all of them when unknown)
const QUICK: Record<TrialTime, string[]> = { morning: ["06:00", "07:00", "08:00", "10:00"], afternoon: ["12:00", "14:00", "15:00", "16:00"], evening: ["17:00", "18:00", "18:30", "19:30"] };
export const quickTimes = (time: TrialTime | null | undefined): string[] => (time ? QUICK[time] : ["07:00", "10:00", "17:00", "18:30"]);

/** "18:30" → "6:30 PM" */
export function clockText(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
