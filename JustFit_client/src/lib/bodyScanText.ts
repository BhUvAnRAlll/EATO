// Words for a kept body scan (pure, unit-tested): the date line and the report's numbers as rows
import type { BodyScanReport } from "./bodyScanRules.ts";

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** "10 Nov 2026, 4:05 pm" in India's time */
export function scanWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateTime.format(date);
}

const kg = (v: number | null) => (v == null ? null : `${v.toFixed(1)} kg`);
const kcal = (v: number | null) => (v == null ? null : `${v.toLocaleString("en-IN")} kcal`);

/** The report's main numbers, leaving out any the scan didn't produce */
export function scanReportRows(report: BodyScanReport): { label: string; value: string }[] {
  const rows: [string, string | null][] = [
    ["Body score", report.score == null ? null : `${report.score} / 100`],
    ["Fat mass", kg(report.fatMassKg)],
    ["Lean mass", kg(report.leanMassKg)],
    ["Skeletal muscle", kg(report.skeletalMuscleKg)],
    ["Body water", kg(report.bodyWaterKg)],
    ["Protein", kg(report.proteinKg)],
    ["Minerals", kg(report.mineralsKg)],
    ["BMI", report.bmi == null ? null : report.bmi.toFixed(1)],
    ["Waist (estimated)", report.waistCm == null ? null : `${Math.round(report.waistCm)} cm`],
    ["Waist-to-height", report.waistToHeight == null ? null : report.waistToHeight.toFixed(2)],
    ["Visceral fat level", report.visceralFatLevel == null ? null : `${report.visceralFatLevel} / 20`],
    ["Resting energy (BMR)", kcal(report.bmrKcal)],
    ["Daily energy (TDEE)", kcal(report.dailyEnergyKcal)],
    ["Suggested intake", kcal(report.suggestedIntakeKcal)],
    ["Target weight", kg(report.targetWeightKg)],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null).map(([label, value]) => ({ label, value }));
}
