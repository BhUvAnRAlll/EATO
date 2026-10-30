// Pure rules for the photo body-fat scan (no React Native imports, so the server-side
// style unit tests can load this file). The picker and the API call live in bodyScan.ts.
import type { Gender } from "@/lib/nutrition";

export type ScanSex = "male" | "female";

export type ScanInputs = { heightCm: number; weightKg: number; age: number; sex: ScanSex };

export type RegionStatus = "under" | "normal" | "over";
export type BodyRegion = "rightArm" | "leftArm" | "trunk" | "rightLeg" | "leftLeg";
export type RegionReadings = Record<BodyRegion, { kg: number | null; status: RegionStatus | null }>;

// The body composition report from a scan. Every value can be missing (null)
export type BodyScanReport = {
  score: number | null;
  fatMassKg: number | null;
  leanMassKg: number | null;
  skeletalMuscleKg: number | null;
  bodyWaterKg: number | null;
  proteinKg: number | null;
  mineralsKg: number | null;
  bmi: number | null;
  waistCm: number | null;
  waistToHeight: number | null;
  visceralFatLevel: number | null;
  bmrKcal: number | null;
  dailyEnergyKcal: number | null;
  suggestedIntakeKcal: number | null;
  targetWeightKg: number | null;
  weightChangeKg: number | null;
  fatChangeKg: number | null;
  muscleChangeKg: number | null;
  leanByRegion: RegionReadings | null;
  fatByRegion: RegionReadings | null;
  // Healthy [low, high] for this person, from the scan server (Forma's own ranges)
  healthy: {
    weightKg: [number, number];
    skeletalMuscleKg: [number, number];
    fatMassKg: [number, number];
    bodyFatPercent: [number, number];
    bmi: [number, number];
    waistToHeight: [number, number];
  };
  // Who was scanned (the values the scan used)
  sex: ScanSex;
  heightCm: number;
  weightKg: number;
  age: number;
};

// What the server answers from POST /api/body-composition/scan
export type BodyScanEstimate = {
  percentBodyFat: number;
  report: BodyScanReport;
};

// Same limit the server enforces per photo; checked here too so users get a quick answer
export const SCAN_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// The same ranges the server (and Forma) enforce
const ranges = { heightCm: [100, 250], weightKg: [20, 300], age: [5, 120] } as const;

// The model has a male and a female version only; anyone else picks the closer one on the screen
export function scanSexFromGender(gender: Gender | null): ScanSex | null {
  return gender === "male" || gender === "female" ? gender : null;
}

// The setup answers (typed text) as the numbers the scan needs, or why it can't run yet
export function scanInputs(profile: { heightCm: string; weightKg: string; age: string }, sex: ScanSex | null): { ok: true; inputs: ScanInputs } | { ok: false; error: string } {
  const read = (text: string) => (text.trim() === "" ? NaN : Number(text));
  const heightCm = read(profile.heightCm);
  const weightKg = read(profile.weightKg);
  const age = read(profile.age);
  const within = (value: number, [min, max]: readonly [number, number]) => Number.isFinite(value) && value >= min && value <= max;

  if (!within(heightCm, ranges.heightCm)) return { ok: false, error: "Enter your height (100–250 cm) first." };
  if (!within(weightKg, ranges.weightKg)) return { ok: false, error: "Enter your weight (20–300 kg) first." };
  if (!Number.isInteger(age) || !within(age, ranges.age)) return { ok: false, error: "Your date of birth is needed for the scan. Go back to Personal details." };
  if (sex === null) return { ok: false, error: "Choose which version of the model to use." };
  return { ok: true, inputs: { heightCm, weightKg, age, sex } };
}

// A base64 string's decoded size is 3/4 of its length
export function photoTooLarge(base64: string): boolean {
  return base64.length * 0.75 > SCAN_MAX_IMAGE_BYTES;
}

// A change with its sign and one decimal, as on the report: "-10.0 kg", "+1.5 kg", "0.0 kg"
export function changeText(kg: number): string {
  if (!Number.isFinite(kg) || Math.abs(kg) < 0.05) return "0.0 kg";
  return `${kg > 0 ? "+" : ""}${kg.toFixed(1)} kg`;
}

// The value as the body-fat field stores it (one decimal, no unit)
export function estimateFieldText(estimate: BodyScanEstimate): string {
  return String(Math.round(estimate.percentBodyFat * 10) / 10);
}

// ---------------------------------------------------------------------------
// Graphs in the body composition report (setup/scan-report). The healthy ranges come from the
// scan server; these rules only place values and name them, the same way the scan's own report does.

export type Range = [number, number];

// Under / normal / over against a healthy [low, high] (both ends count as normal)
export function rangeStatus(value: number, [low, high]: Range): RegionStatus {
  if (value < low) return "under";
  if (value > high) return "over";
  return "normal";
}

export type BodyFatCategory = "low" | "healthy" | "elevated" | "high";

// Body fat: below the healthy range, in it, up to 5 points above it, or higher
export function bodyFatCategory(percent: number, [low, high]: Range): BodyFatCategory {
  if (percent < low) return "low";
  if (percent <= high) return "healthy";
  return percent <= high + 5 ? "elevated" : "high";
}

export type VisceralStatus = "low" | "normal" | "high";

// Visceral fat level (1–20): under 7 is low, over 13 is high
export function visceralStatus(level: number): VisceralStatus {
  if (level < 7) return "low";
  return level > 13 ? "high" : "normal";
}

// Where a value sits on a bar from min to max, as 0–1 (clamped to the ends)
export function barPosition(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// Each bar's scale on the report: [min, max]
export const reportBarScales = {
  weightKg: [40, 130],
  skeletalMuscleKg: [10, 50],
  fatMassKg: [0, 50],
  bodyFatPercent: [0, 50],
} as const;

const isRange = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));

// True when a scan answer has everything the report screen draws. An older server sends only
// the body fat %, which would otherwise crash the report, so such an answer is refused instead.
export function isCompleteEstimate(value: unknown): value is BodyScanEstimate {
  if (!value || typeof value !== "object") return false;
  const { percentBodyFat, report } = value as { percentBodyFat?: unknown; report?: unknown };
  if (typeof percentBodyFat !== "number" || !Number.isFinite(percentBodyFat) || !report || typeof report !== "object") return false;
  const r = report as Record<string, unknown>;
  const healthy = r.healthy as Record<string, unknown> | undefined;
  return (
    (r.sex === "male" || r.sex === "female") &&
    typeof r.weightKg === "number" &&
    typeof r.heightCm === "number" &&
    typeof r.age === "number" &&
    !!healthy &&
    ["weightKg", "skeletalMuscleKg", "fatMassKg", "bodyFatPercent", "bmi", "waistToHeight"].every((key) => isRange(healthy[key]))
  );
}
