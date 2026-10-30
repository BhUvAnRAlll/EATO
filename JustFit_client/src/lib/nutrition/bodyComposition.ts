import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import { katchMcArdleRmr } from "./energy.ts";
import type { BodyCompositionReport, BodySegment } from "./types.ts";

// Pure logic for body composition reports. Reading the sheet (OCR / layout parsing)
// lives elsewhere and only ever produces an unconfirmed BodyCompositionReport.

export type ReportField = keyof BodyCompositionReport;

export const bodySegments: BodySegment[] = ["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"];

// True when the report has at least one segment mass to show
export function hasSegmentalData(report: BodyCompositionReport): boolean {
  const segmental = report.segmental;
  if (!segmental) return false;
  return bodySegments.some((segment) => segmental.leanMass[segment]?.kg != null || segmental.fatMass[segment]?.kg != null);
}

export type ReportIssue = { fields: ReportField[]; message: string };

export type ReportStatus =
  | { status: "usable"; fatFreeMassKg: number; ageDays: number }
  | { status: "unconfirmed" }
  | { status: "incomplete"; issues: ReportIssue[] }
  | { status: "inconsistent"; issues: ReportIssue[] }
  | { status: "expired"; ageDays: number };

// fat-free mass = weight × (1 − PBF / 100)
export function fatFreeMassFromPbf(weightKg: number, percentBodyFat: number) {
  return weightKg * (1 - percentBodyFat / 100);
}

// Fat-free mass from whatever the report has: printed value, weight − fat mass, or weight + PBF
export function resolveFatFreeMass(report: BodyCompositionReport): number | null {
  if (report.fatFreeMassKg != null) return report.fatFreeMassKg;
  if (report.weightKg != null && report.bodyFatMassKg != null) return report.weightKg - report.bodyFatMassKg;
  if (report.weightKg != null && report.percentBodyFat != null) {
    return fatFreeMassFromPbf(report.weightKg, report.percentBodyFat);
  }
  return null;
}

// Values that are missing (unreadable) or impossible
export function reportCompletenessIssues(
  report: BodyCompositionReport,
  config: CalculatorConfig = calculatorConfig,
): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const positive = (n: number | null) => n != null && Number.isFinite(n) && n > 0;

  if (!report.testDate || Number.isNaN(Date.parse(report.testDate))) {
    issues.push({ fields: ["testDate"], message: "Enter the test date from the report." });
  }
  if (!positive(report.weightKg)) issues.push({ fields: ["weightKg"], message: "Enter your weight from the report." });
  if (resolveFatFreeMass(report) == null) {
    issues.push({
      fields: ["fatFreeMassKg", "bodyFatMassKg", "percentBodyFat"],
      message: "Enter your fat-free mass, body fat mass or body fat % from the report.",
    });
  }
  const { min, max } = config.bodyComposition.bounds.percentBodyFat;
  if (report.percentBodyFat != null && (report.percentBodyFat < min || report.percentBodyFat > max)) {
    issues.push({ fields: ["percentBodyFat"], message: `Body fat % should be between ${min} and ${max}.` });
  }
  const ffm = resolveFatFreeMass(report);
  if (ffm != null && report.weightKg != null && (ffm <= 0 || ffm >= report.weightKg)) {
    issues.push({ fields: ["fatFreeMassKg", "weightKg"], message: "Fat-free mass must be less than your weight." });
  }
  return issues;
}

// Cross-checks between the confirmed values (configurable tolerances). A failure
// usually means a misread digit, so the user is asked to recheck those fields.
export function reportConsistencyIssues(
  report: BodyCompositionReport,
  config: CalculatorConfig = calculatorConfig,
): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const { tolerances } = config.bodyComposition;
  const { weightKg, bodyFatMassKg, percentBodyFat, fatFreeMassKg, printedBmrKcal } = report;

  if (weightKg != null && bodyFatMassKg != null && fatFreeMassKg != null) {
    if (Math.abs(weightKg - bodyFatMassKg - fatFreeMassKg) > tolerances.fatFreeMassKg) {
      issues.push({
        fields: ["weightKg", "bodyFatMassKg", "fatFreeMassKg"],
        message: "Weight minus body fat mass should equal fat-free mass. Please check these against your sheet.",
      });
    }
  }
  if (weightKg != null && bodyFatMassKg != null && percentBodyFat != null) {
    if (Math.abs((bodyFatMassKg / weightKg) * 100 - percentBodyFat) > tolerances.percentBodyFatPoints) {
      issues.push({
        fields: ["weightKg", "bodyFatMassKg", "percentBodyFat"],
        message: "Body fat mass and body fat % don't match your weight. Please check these against your sheet.",
      });
    }
  }
  const ffm = resolveFatFreeMass(report);
  if (printedBmrKcal != null && ffm != null) {
    if (Math.abs(printedBmrKcal - katchMcArdleRmr(ffm, config)) > tolerances.printedBmrKcal) {
      issues.push({
        fields: ["printedBmrKcal", "fatFreeMassKg"],
        message: "The printed BMR doesn't match your fat-free mass. Please check both against your sheet.",
      });
    }
  }
  return issues;
}

export function reportAgeDays(testDate: string, asOf: Date) {
  const tested = Date.parse(`${testDate}T00:00:00Z`);
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((today - tested) / 86_400_000);
}

// Whether a report can be used for Katch–McArdle right now
export function reportStatus(
  report: BodyCompositionReport,
  asOf: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
): ReportStatus {
  if (!report.confirmed) return { status: "unconfirmed" };
  const incomplete = reportCompletenessIssues(report, config);
  if (incomplete.length > 0) return { status: "incomplete", issues: incomplete };
  const inconsistent = reportConsistencyIssues(report, config);
  if (inconsistent.length > 0) return { status: "inconsistent", issues: inconsistent };

  const ageDays = reportAgeDays(report.testDate as string, asOf);
  if (ageDays > config.bodyComposition.maxReportAgeDays) return { status: "expired", ageDays };
  return { status: "usable", ageDays, fatFreeMassKg: resolveFatFreeMass(report) as number };
}

// A typed-in body fat % (no sheet). Treated as confirmed by the user, dated today.
export function manualBodyFatReport(weightKg: number, percentBodyFat: number, asOf: Date = new Date()): BodyCompositionReport {
  return {
    id: "manual-body-fat",
    source: "manual",
    testDate: asOf.toISOString().slice(0, 10),
    heightCm: null,
    age: null,
    gender: null,
    weightKg,
    bodyFatMassKg: null,
    percentBodyFat,
    fatFreeMassKg: null,
    skeletalMuscleMassKg: null,
    printedBmrKcal: null,
    printedRecommendedIntakeKcal: null,
    confirmed: true,
    confirmedAt: asOf.toISOString(),
  };
}
