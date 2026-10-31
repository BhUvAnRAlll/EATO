import { apiFetch, type ApiResult } from "@/lib/api";
import { normalizeSummary } from "@/lib/aiUsageRules";

// Super Admin › AI Usage (JustFit_server/admin/aiUsage.js, under /api/admin/portal/ai-usage).
// The server checks the admin role on every request; nothing here decides who may see what.

export type AiFeature = "gym_assistant" | "coach_plan" | "coach_meal" | "coach_chat" | "food_scan" | "body_scan" | "body_report";
export type AiProvider = "openai" | "forma";
export type AiStatus = "ok" | "failed" | "refused";
export type Period = "day" | "week" | "month";

// cachedInputTokens: the part of the input OpenAI served from its prompt cache (cheaper);
// fromCache: calls the server answered from its own cache (no model call, ₹0); avgCostInr: per call
export type Totals = { requests: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; tokens: number; costInr: number; fromCache: number; avgCostInr: number };
export type ModelTotals = Totals & { model: string; provider: AiProvider };
export type MemberTotals = Totals & { userId: string; userName: string | null };
export type FeatureTotals = Totals & { feature: AiFeature; ok: number; failed: number; refused: number; models: ModelTotals[] };
export type SeriesPoint = { key: string; requests: number; tokens: number; costInr: number };
export type BudgetStatus = { monthlyLimitInr: number; spentInr: number; remainingInr: number; percent: number; openAlerts: number };

export type AiSummary = {
  period: Period;
  range: { from: string; to: string };
  allTime: Totals;
  today: { costInr: number; requests: number };
  month: { costInr: number; requests: number };
  current: Totals;
  previous: Totals;
  features: FeatureTotals[];
  byModel: ModelTotals[];
  // The members who cost the most in the period, dearest first
  topMembers: MemberTotals[];
  series: SeriesPoint[];
  budget: BudgetStatus;
};

export type HistoryRow = {
  id: string;
  at: string;
  userId: string | null;
  userName: string | null;
  gymId: string | null;
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costInr: number;
  status: AiStatus;
  fromCache: boolean;
  durationMs: number | null;
};
export type HistorySort = "newest" | "oldest" | "cost" | "tokens";
export type HistoryFilters = { search: string; feature: AiFeature | null; status: AiStatus | null; sort: HistorySort; page: number };
export type HistoryPage = { page: number; pageSize: number; total: number; rows: HistoryRow[] };

export type BudgetSettings = { monthlyLimitInr: number; usdToInr: number; alert50: boolean; alert75: boolean; alert90: boolean; alert100: boolean; spikeAlerts: boolean };
export type BudgetAlert = { id: string; kind: "threshold" | "spike"; period: string; threshold: number; spentInr: number; detail: string; at: string; acknowledgedAt: string | null };
export type BudgetView = { settings: BudgetSettings & { updatedBy: string | null; updatedAt: string | null }; month: BudgetStatus; alerts: BudgetAlert[] };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const query = (params: Record<string, string | number | null>) =>
  Object.entries(params)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");

export const aiUsage = {
  // Every number is filled in (0 when the server left it out) before the screen formats it
  async summary(token: string | null, period: Period): Promise<ApiResult<AiSummary>> {
    if (!token) return signedOut();
    const result = await apiFetch<AiSummary>(`/api/admin/portal/ai-usage/summary?period=${period}`, { token });
    return result.ok ? { ok: true, data: normalizeSummary(result.data) } : result;
  },
  history(token: string | null, filters: HistoryFilters): Promise<ApiResult<HistoryPage>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/ai-usage/history?${query(filters)}`, { token });
  },
  budget(token: string | null): Promise<ApiResult<BudgetView>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/ai-usage/budget", { token });
  },
  saveBudget(token: string | null, settings: BudgetSettings): Promise<ApiResult<BudgetView>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/ai-usage/budget", { method: "PUT", body: settings, token });
  },
  acknowledge(token: string | null, alertId: string): Promise<ApiResult<BudgetView>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/ai-usage/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: "POST", token });
  },
};

// ---- formatting ------------------------------------------------------------------------

// Rupees with Indian grouping: whole rupees from ₹1,000, paise below that
export const inr = (value: number) => {
  if (value >= 1000) return `₹${Math.round(value).toLocaleString("en-IN")}`;
  return `₹${value.toFixed(2)}`;
};

// 1,234 → "1.2k", 3,400,000 → "3.4M"
export const compact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
};

// The change against the previous period: "+25%", "−40%", or null when there is nothing to compare with
export const changeLabel = (current: number, previous: number): string | null => {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  return percent === 0 ? "No change" : percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`;
};
