import { apiFetch, type ApiResult } from "@/lib/api";

// Super Admin › App Usage (JustFit_server/admin/usage.js, GET /api/admin/portal/usage): how
// members use the app, counted from the rows the features write. The server checks the admin
// role on every request; nothing here decides who may see what. Not the AI Usage module
// (lib/aiUsage.ts), which is about tokens and cost.

export type UsageRange = "today" | "yesterday" | "7d" | "30d" | "90d" | "this_month" | "last_month" | "custom";
export type UsageModule = "nutrition" | "workout" | "coach" | "community" | "stories" | "attendance" | "progress";

export type FeatureUsage = {
  id: string;
  module: UsageModule;
  label: string;
  uses: number;
  members: number;
  previousUses: number;
  previousMembers: number;
  // Members who used it, as a share of the members active in the range
  sharePercent: number;
  usesPerMember: number;
  // Change in members from the range before, or null when nobody used it then
  changePercent: number | null;
  declining: boolean;
  unused: boolean;
};

export type ModuleUsage = { id: UsageModule; label: string; uses: number; members: number; features: string[] };

export type UsageSummary = {
  range: { id: UsageRange; from: string; to: string; days: number; previousFrom: string; previousTo: string };
  members: { registered: number; newInPeriod: number; active: number; previousActive: number; activeChangePercent: number | null; activePercent: number };
  totals: { uses: number; usesPerActiveMember: number };
  // Ranked by distinct members, then uses
  features: FeatureUsage[];
  modules: ModuleUsage[];
  // Active members per day across the range
  series: { key: string; members: number }[];
  // Screen visits and app sessions from the app's own events; null until that tracking is set up
  engagement: {
    screens: { screen: string; visits: number; members: number }[];
    sessions: { total: number; previousTotal: number; changePercent: number | null; perMember: number; avgSeconds: number };
  } | null;
  // What the brief asks for but nothing records yet (shown as such, never as zero)
  notTracked: { id: string; label: string; reason: string }[];
};

export type UsageQuery = { range: UsageRange; from?: string; to?: string };

// Phase 3: retention by join cohort, the member-level list, one feature's detail
export type CohortUnit = "week" | "month";
export type Cohort = {
  cohort: string; // the Monday of the week, or the first of the month, members joined
  joined: number;
  // Share (%) active on or after day 1 / 7 / 30; null while the cohort is too young for that day
  retention: { day1: number | null; day7: number | null; day30: number | null };
  // Share (%) active in each later week/month, period 0 being the one they joined in
  periods: number[];
};
export type Retention = { unit: CohortUnit; days: number[]; cohorts: Cohort[] };

export type MemberSort = "last_active" | "sessions" | "interactions" | "active_days" | "name";
export type MemberUsage = {
  id: string;
  name: string;
  joined: string | null;
  lastActive: string | null;
  sessions: number | null; // null until session tracking is set up
  interactions: number;
  activeDays: number;
  mostUsed: { id: string; label: string; uses: number } | null;
};
export type MemberList = { total: number; page: number; pageSize: number; sort: MemberSort; search: string; members: MemberUsage[]; sessionsTracked: boolean };

export type FeatureDetail = {
  feature: { id: string; label: string; module: UsageModule };
  range: UsageSummary["range"];
  tracked: boolean;
  current?: { uses: number; members: number };
  previous?: { uses: number; members: number };
  changePercent?: number | null;
  series?: { key: string; uses: number; members: number }[];
  topMembers?: { id: string; name: string; uses: number; lastAt: string | null }[];
};

export const appUsage = {
  summary(token: string | null, query: UsageQuery): Promise<ApiResult<UsageSummary>> {
    const params = new URLSearchParams({ range: query.range });
    if (query.range === "custom" && query.from && query.to) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    return apiFetch(`/api/admin/portal/usage?${params.toString()}`, { token });
  },
  retention(token: string | null, unit: CohortUnit): Promise<ApiResult<Retention>> {
    return apiFetch(`/api/admin/portal/usage/retention?unit=${unit}`, { token });
  },
  members(token: string | null, query: { sort: MemberSort; search: string; page: number }): Promise<ApiResult<MemberList>> {
    const params = new URLSearchParams({ sort: query.sort, search: query.search, page: String(query.page) });
    return apiFetch(`/api/admin/portal/usage/members?${params.toString()}`, { token });
  },
  feature(token: string | null, id: string, query: UsageQuery): Promise<ApiResult<FeatureDetail>> {
    const params = new URLSearchParams({ range: query.range });
    if (query.range === "custom" && query.from && query.to) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    return apiFetch(`/api/admin/portal/usage/features/${encodeURIComponent(id)}?${params.toString()}`, { token });
  },
};

export const MEMBER_SORT_LABEL: Record<MemberSort, string> = { last_active: "Last active", sessions: "Sessions", interactions: "Interactions", active_days: "Active days", name: "Name" };
export const MEMBER_SORTS: MemberSort[] = ["last_active", "interactions", "active_days", "sessions", "name"];

// "12 Oct" for a cohort's Monday, "Oct 2026" for a month cohort
export function cohortText(cohort: string, unit: CohortUnit): string {
  const d = new Date(`${cohort}T00:00:00`);
  return unit === "week" ? `Week of ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export const RANGE_LABEL: Record<UsageRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

// The ranges offered as segments; custom has its own two date fields
export const RANGE_OPTIONS: UsageRange[] = ["today", "yesterday", "7d", "30d", "90d", "this_month", "last_month", "custom"];

// "+25%" / "−40%" / "new" (nothing in the range before) for a change in members
export function changeText(change: number | null): string {
  if (change === null) return "new";
  if (change === 0) return "±0%";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

// "30 Oct" or "24 Oct – 30 Oct": the range as a person reads it
/** A day key (2026-10-27) as "Mon 27 Oct" */
export function dayName(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function rangeText(from: string, to: string): string {
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

// "4 min 20 s" / "45 s" for an average session
export function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${m} min ${rest} s` : `${m} min`;
}

// Accepts "2026-10-30" only; the server checks again
export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
