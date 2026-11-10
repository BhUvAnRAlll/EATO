// Super Admin › a member's full profile (2026-11-10): the server's answer turned into titled
// sections of label/value rows, with the same words the member saw when answering. Pure and
// unit-tested; anything left unanswered reads "Not set".
import { activityOptions, dietOptions, genderOptions, goalOptions, healthFlagOptions, mealsPerDayOptions } from "../data/setup.ts";
import {
  coachGoals, coaches, coachStyles, conditions, cookingTimes, equipmentBySpot, experienceLevels, foodBudgets, joints, labelOf, sessionLengths, sleepRanges, spots, stressLevels, weekdayChoices,
} from "../data/coach.ts";

export type MemberProfile = {
  id: string;
  contact: { phone: string | null; email: string | null };
  joinedAt: string | null;
  lastActiveAt: string | null;
  profile: {
    complete: boolean; dob: string | null; age: number | null; gender: string | null; heightCm: number | null; weightKg: number | null; bodyFatPercent: number | null;
    goal: string | null; activity: string | null; healthFlags: string[]; diet: string | null; cuisines: string[]; dislikes: string | null; allergies: string | null;
    mealsPerDay: string | null; workoutFrequency: string | null; workoutType: string | null; workoutTime: string | null; updatedAt: string | null;
  } | null;
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number; source: string; formula: string | null; reason: string | null; updatedAt: string | null } | null;
  coach: {
    goal: string; experience: string; currentlyTraining: boolean; weekdays: number[]; sessionMinutes: number; mainSpot: string; backupSpot: string | null;
    mainEquipment: string; backupEquipment: string | null; joints: string[]; conditions: string[]; limitationNotes: string | null; cookingTime: string;
    foodBudget: string; stress: string | null; sleep: string | null; coach: string; coachStyle: string; planNotes: string | null; updatedAt: string | null;
  } | null;
  scans: { id: string; at: string; bodyFatPercent: number }[] | null;
  activity: { kind: string; at: string; title: string; detail?: string | null }[];
};

export type Row = { label: string; value: string };
export type Section = { title: string; rows: Row[] };

const NOT_SET = "Not set";
const or = (value: string | null | undefined) => (value && value.trim() ? value.trim() : NOT_SET);
const label = (list: { id: string; label: string }[], id: string | null | undefined) => (id ? labelOf(list, id) || id : NOT_SET);
const labels = (list: { id: string; label: string }[], ids: string[]) => (ids.length ? ids.map((id) => labelOf(list, id) || id).join(", ") : "None");
const allEquipment = Object.values(equipmentBySpot).flat();

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const dateText = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : NOT_SET);
export const timeText = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : NOT_SET);
// "1998-04-02" → "2 Apr 1998", read as a calendar day (no time zone shift)
const dayText = (ymd: string | null) => (ymd ? dateFmt.format(new Date(`${ymd}T12:00:00+05:30`)) : NOT_SET);

const phoneText = (phone: string | null) => (phone && /^\d{10}$/.test(phone) ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : or(phone));

/** Every section of the member's page, in order; sections with nothing saved say so in one row */
export function memberSections(m: MemberProfile): Section[] {
  const p = m.profile;
  const t = m.targets;
  const c = m.coach;
  const sections: Section[] = [
    {
      title: "Contact",
      rows: [
        { label: "Mobile", value: phoneText(m.contact.phone) },
        { label: "Email", value: or(m.contact.email) },
        { label: "Joined", value: dateText(m.joinedAt) },
        { label: "Last active", value: timeText(m.lastActiveAt) },
      ],
    },
  ];
  if (!p) {
    sections.push({ title: "Profile", rows: [{ label: "Setup", value: "Not started" }] });
  } else {
    sections.push(
      {
        title: "Personal details",
        rows: [
          { label: "Setup", value: p.complete ? "Finished" : "Not finished" },
          { label: "Date of birth", value: p.dob ? `${dayText(p.dob)}${p.age != null ? ` · ${p.age} y` : ""}` : NOT_SET },
          { label: "Gender", value: label(genderOptions, p.gender) },
          { label: "Height", value: p.heightCm != null ? `${p.heightCm} cm` : NOT_SET },
          { label: "Weight", value: p.weightKg != null ? `${p.weightKg} kg` : NOT_SET },
          { label: "Body fat", value: p.bodyFatPercent != null ? `${p.bodyFatPercent}%` : NOT_SET },
        ],
      },
      {
        title: "Goal and health",
        rows: [
          { label: "Goal", value: label(goalOptions, p.goal) },
          { label: "Activity level", value: label(activityOptions, p.activity) },
          { label: "Health", value: labels(healthFlagOptions, p.healthFlags) },
        ],
      },
      {
        title: "Food",
        rows: [
          { label: "Diet", value: label(dietOptions, p.diet) },
          { label: "Food you usually eat", value: p.cuisines.length ? p.cuisines.join(", ") : NOT_SET },
          { label: "Allergies", value: or(p.allergies) },
          { label: "Dislikes", value: or(p.dislikes) },
          { label: "Meals per day", value: label(mealsPerDayOptions, p.mealsPerDay) },
        ],
      },
    );
  }
  sections.push({
    title: "Daily targets",
    rows: t
      ? [
          { label: "Calories", value: `${t.calories.toLocaleString("en-IN")} kcal` },
          { label: "Protein · carbs · fat", value: `${t.proteinG} g · ${t.carbsG} g · ${t.fatG} g` },
          { label: "Set by", value: t.source === "user_adjusted" ? `The member${t.reason ? ` (${t.reason})` : ""}` : t.formula === "katch_mcardle" ? "Calculated with body fat" : "Calculated" },
        ]
      : [{ label: "Targets", value: NOT_SET }],
  });
  sections.push({
    title: "AI Coach intake",
    rows: c
      ? [
          { label: "Goal", value: label(coachGoals, c.goal) },
          { label: "Experience", value: `${label(experienceLevels, c.experience)}${c.currentlyTraining ? " · training now" : ""}` },
          { label: "Training days", value: c.weekdays.length ? weekdayChoices.filter((d) => c.weekdays.includes(d.id)).map((d) => d.label).join(", ") : "None" },
          { label: "Session", value: sessionLengths.find((s) => s.id === c.sessionMinutes)?.label ?? `${c.sessionMinutes} min` },
          { label: "Main spot", value: `${label(spots, c.mainSpot)} · ${label(allEquipment, c.mainEquipment)}` },
          { label: "Backup spot", value: c.backupSpot ? `${label(spots, c.backupSpot)}${c.backupEquipment ? ` · ${label(allEquipment, c.backupEquipment)}` : ""}` : "None" },
          { label: "Joints to protect", value: labels(joints, c.joints) },
          { label: "Health conditions", value: labels(conditions, c.conditions) },
          { label: "Injuries or notes", value: or(c.limitationNotes) },
          { label: "Time to cook", value: label(cookingTimes, c.cookingTime) },
          { label: "Food budget", value: label(foodBudgets, c.foodBudget) },
          { label: "Stress", value: label(stressLevels, c.stress) },
          { label: "Sleep", value: label(sleepRanges, c.sleep) },
          { label: "Coach", value: `${coaches.find((x) => x.id === c.coach)?.name ?? c.coach} · ${label(coachStyles, c.coachStyle)}` },
          { label: "Notes for the plan", value: or(c.planNotes) },
        ]
      : [{ label: "Intake", value: "Not done" }],
  });
  return sections;
}
