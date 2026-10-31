// The numbers the AI Usage screens show, made safe to read. Pure: no React Native imports, so it
// is unit-tested on its own (lib/aiUsage.ts runs every summary through it).
//
// A server that is older than the app (a field added after it last started), or a database with
// no AI activity yet, may leave a number out or send null. The screen formats every one of them
// (`toLocaleString`, `toFixed`), so a missing value must become 0 here, not a crash there.
import type { AiSummary, Totals } from "./aiUsage";

const TOTAL_KEYS: (keyof Totals)[] = ["requests", "inputTokens", "cachedInputTokens", "outputTokens", "tokens", "costInr", "fromCache", "avgCostInr"];

export const num = (value: unknown): number => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

// Every total as a finite number; other fields (model, feature, userName, ...) pass through
export function totalsOf<T extends Partial<Totals>>(source: T | null | undefined): T & Totals {
  const base = (source ?? {}) as T;
  const filled = Object.fromEntries(TOTAL_KEYS.map((key) => [key, num(base[key])])) as Totals;
  return { ...base, ...filled };
}

export function normalizeSummary(summary: AiSummary): AiSummary {
  const list = <T extends Partial<Totals>>(rows: T[] | null | undefined) => (Array.isArray(rows) ? rows.map((row) => totalsOf(row)) : []);
  const budget = summary.budget ?? {};
  return {
    ...summary,
    allTime: totalsOf(summary.allTime),
    today: { costInr: num(summary.today?.costInr), requests: num(summary.today?.requests) },
    month: { costInr: num(summary.month?.costInr), requests: num(summary.month?.requests) },
    current: totalsOf(summary.current),
    previous: totalsOf(summary.previous),
    features: list(summary.features).map((f) => ({ ...f, ok: num(f.ok), failed: num(f.failed), refused: num(f.refused), models: list(f.models) })),
    byModel: list(summary.byModel),
    topMembers: list(summary.topMembers),
    series: Array.isArray(summary.series) ? summary.series : [],
    budget: {
      monthlyLimitInr: num(budget.monthlyLimitInr),
      spentInr: num(budget.spentInr),
      remainingInr: num(budget.remainingInr),
      percent: num(budget.percent),
      openAlerts: num(budget.openAlerts),
    },
  };
}

// One row per model for a section that spans several features (the Coach section: plan, meal
// swap and chat all use the same model). Requests and cost add up; the first row's provider stays.
export function mergeModels<T extends { model: string; requests: number; costInr: number; tokens: number }>(rows: T[]): T[] {
  const byModel = new Map<string, T>();
  for (const row of rows) {
    const seen = byModel.get(row.model);
    if (!seen) byModel.set(row.model, { ...row });
    else byModel.set(row.model, { ...seen, requests: seen.requests + row.requests, costInr: seen.costInr + row.costInr, tokens: seen.tokens + row.tokens });
  }
  return [...byModel.values()].sort((a, b) => b.costInr - a.costInr);
}
