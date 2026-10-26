// Pure rules for running the body scan from Profile, after setup (no React Native imports, so
// the unit tests can load this file). The saved profile lives on the server, so a scanned body
// fat % is saved the way setup saves: the whole profile plus a target record recalculated with
// the new value (body fat lets the calculator use fat-free mass).
import { ageFromDob } from "./date.ts";
import { manualBodyFatReport } from "./nutrition/bodyComposition.ts";
import { createManualRecord, recalculateRecord, type TargetRecord } from "./nutrition/record.ts";
import type { SavedProfile } from "./profile.ts";
import type { Profile } from "../types/profile.ts";

const round1 = (n: number) => Math.round(n * 10) / 10;

// The server's YYYY-MM-DD as the app's DD/MM/YYYY ("" when it isn't a date)
export function dobFromSaved(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

// What the scan screens read from the setup store (height, weight, age, gender), from the saved profile
export function scanFieldsFromSaved(saved: SavedProfile): Pick<Profile, "heightCm" | "weightKg" | "age" | "gender" | "dob"> {
  const dob = dobFromSaved(saved.dob);
  const age = ageFromDob(dob);
  return {
    heightCm: saved.heightCm == null ? "" : String(saved.heightCm),
    weightKg: saved.weightKg == null ? "" : String(saved.weightKg),
    age: age == null ? "" : String(age),
    gender: saved.gender,
    dob,
  };
}

export type MeasurementSave =
  | { ok: true; body: { profile: Profile; nutrition: TargetRecord }; changes: string[] }
  | { ok: false; error: string };
export type BodyFatSave = MeasurementSave;

export type MeasurementChange = { heightCm?: number; weightKg?: number; bodyFatPercent?: number };

// The same ranges the setup screens accept
const limits = { heightCm: [100, 250], weightKg: [30, 300], bodyFatPercent: [3, 70] } as const;
const within = (n: number, [min, max]: readonly [number, number]) => Number.isFinite(n) && n >= min && n <= max;

// The saved profile and targets with a new height, weight and/or body fat % → the POST
// /api/profile body, and the changes to show before saving. Each of those feeds the calorie
// calculation, so a calculated target is recalculated; a target the user entered themselves
// stays as it is, and a trainer's target can't be saved this way (the server refuses it).
export function measurementSave(saved: SavedProfile | null, record: TargetRecord | null, change: MeasurementChange, now: Date = new Date()): MeasurementSave {
  if (!saved || !record) return { ok: false, error: "Finish setting up your profile first." };
  if (record.active.source === "trainer_adjusted") {
    const what = change.heightCm === undefined && change.weightKg === undefined ? "a scan" : "your height and weight";
    return { ok: false, error: `Your trainer set your current targets, so ${what} can't change them here. Ask your trainer to update them.` };
  }
  const dob = dobFromSaved(saved.dob);
  const age = ageFromDob(dob);
  if (age == null) return { ok: false, error: "Your date of birth is missing from your profile." };

  const heightCm = change.heightCm ?? saved.heightCm;
  const weightKg = change.weightKg ?? saved.weightKg;
  if (heightCm == null || weightKg == null) return { ok: false, error: "Add your height and weight to your profile first." };
  if (!within(heightCm, limits.heightCm)) return { ok: false, error: "Height must be between 100 and 250 cm." };
  if (!within(weightKg, limits.weightKg)) return { ok: false, error: "Weight must be between 30 and 300 kg." };
  if (change.bodyFatPercent !== undefined && !within(change.bodyFatPercent, limits.bodyFatPercent)) return { ok: false, error: "That body fat % can't be saved." };

  const height = round1(heightCm);
  const weight = round1(weightKg);
  const bodyFat = change.bodyFatPercent !== undefined ? round1(change.bodyFatPercent) : saved.bodyFatPercent;

  const changes: string[] = [];
  if (height !== saved.heightCm) changes.push(`Your height becomes ${height} cm.`);
  if (weight !== saved.weightKg) changes.push(`Your weight becomes ${weight} kg.`);
  if (change.bodyFatPercent !== undefined) changes.push(`Your body fat becomes ${bodyFat}%.`);
  if (changes.length === 0) return { ok: false, error: "Nothing has changed." };

  // A body fat % is re-read against the new weight; without one, any earlier report stays as it was
  const bodyComposition = bodyFat != null ? manualBodyFatReport(weight, bodyFat, now) : record.inputs.bodyComposition;
  const inputs = { ...record.inputs, age, heightCm: height, weightKg: weight, bodyComposition };

  let nutrition: TargetRecord;
  if (record.calculated === null) {
    // A target the user entered (their own, or from a health professional) is kept
    const kept = createManualRecord(inputs, record.active.calories, record.active.reason ?? "Entered by the user", record.active.actor ?? "user", now);
    if (!kept.ok) return kept;
    nutrition = kept.record;
    changes.push(`Your own target of ${record.active.calories} kcal stays as it is.`);
  } else {
    const next = recalculateRecord(record, inputs, now);
    if (!next.ok) return { ok: false, error: "Your targets need a health professional's guidance, so they can't be recalculated here." };
    nutrition = next.record;
    const before = record.active.calories;
    const after = next.record.active.calories;
    changes.push(before === after ? `Your daily target stays at ${after} kcal.` : `Your daily target moves from ${before} to ${after} kcal.`);
    if (record.active.source === "user_adjusted") changes.push("Your own adjustment is replaced by the new calculation.");
  }

  const profile: Profile = {
    fullName: saved.fullName,
    dob,
    gender: saved.gender,
    phone: saved.phone ?? "",
    email: saved.email,
    goal: saved.goal,
    heightCm: String(height),
    weightKg: String(weight),
    bodyFatPercent: bodyFat == null ? "" : String(bodyFat),
    age: String(age),
    activity: saved.activity,
    healthFlags: saved.healthFlags,
    diet: saved.diet,
    cuisines: saved.cuisines,
    dislikes: saved.dislikes ?? "",
    allergies: saved.allergies ?? "",
    workoutFrequency: saved.workoutFrequency,
    workoutType: saved.workoutType,
    workoutTime: saved.workoutTime,
    mealsPerDay: saved.mealsPerDay,
  };
  return { ok: true, body: { profile, nutrition }, changes };
}

// The body scan's save: only the body fat % changes
export function bodyFatSave(saved: SavedProfile | null, record: TargetRecord | null, percentBodyFat: number, now: Date = new Date()): BodyFatSave {
  return measurementSave(saved, record, { bodyFatPercent: percentBodyFat }, now);
}
