import type { Membership, MembershipPause, PauseAllowance } from "@/lib/membershipApi";

// Words for the Membership screens (pure): dates, the plan's length, the status badge and the
// one line that says where a pause stands.

// "7 Nov 2026" from YYYY-MM-DD (read as a plain date, whatever the phone's zone)
export const prettyDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const planText = ({ duration, unit }: Membership["planLength"]) => `${duration} ${unit === "days" ? (duration === 1 ? "day" : "days") : duration === 1 ? "month" : "months"}`;

// Whole days from `from` to `until`, both included
export const daysBetween = (from: string, until: string) => Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
export const addDays = (iso: string, count: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

export type BadgeTone = "active" | "pending" | "expired" | "paused";
// The badge on a membership card: paused wins over the plan's own state
export function membershipBadge(m: Pick<Membership, "status" | "pausedNow" | "pause" | "daysLeft" | "standing">): { label: string; tone: BadgeTone } {
  if (m.standing === "suspended") return { label: "Suspended", tone: "expired" };
  if (m.standing === "cancelled") return { label: "Cancelled", tone: "expired" };
  if (m.pausedNow && m.pause) return { label: `Paused until ${prettyDate(m.pause.until)}`, tone: "paused" };
  if (m.status === "expired") return { label: "Expired", tone: "expired" };
  if (m.status === "expiring") return { label: "Expires today", tone: "pending" };
  return { label: m.daysLeft === 1 ? "1 day left" : `${m.daysLeft} days left`, tone: "active" };
}

// Where the open pause stands, for the card
export function pauseLine(pause: MembershipPause, gym: string, today: string): string {
  const span = `${prettyDate(pause.from)} to ${prettyDate(pause.until)} (${pause.days} ${pause.days === 1 ? "day" : "days"})`;
  if (pause.status === "pending") return `Pause requested for ${span}. Waiting for ${gym} to approve.`;
  if (pause.from > today) return `Paused from ${span}. Those days are added to your plan.`;
  return `Paused until ${prettyDate(pause.until)}. Those days are added to your plan.`;
}

// A past decision, for the history list
export function historyLine(pause: MembershipPause): string {
  const span = `${prettyDate(pause.from)} to ${prettyDate(pause.until)}`;
  if (pause.status === "rejected") return `Not approved · ${span}${pause.note ? ` · “${pause.note}”` : ""}`;
  if (pause.status === "cancelled") return `Cancelled · ${span}`;
  if (pause.status === "approved") return `${pause.by === "staff" ? "Paused by the gym" : "Paused"} · ${span}`;
  return `Requested · ${span}`;
}

// What the gym's pause limits leave, or null when the gym has none: "1 pause and 10 days left in 12 months"
export function allowanceLine(a: PauseAllowance | undefined): string | null {
  if (!a || (a.pausesLeft === null && a.daysLeft === null)) return null;
  const parts: string[] = [];
  if (a.pausesLeft !== null) parts.push(`${a.pausesLeft} ${a.pausesLeft === 1 ? "pause" : "pauses"}`);
  if (a.daysLeft !== null) parts.push(`${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"}`);
  return `${parts.join(" and ")} left in these 12 months · up to ${a.policy.maxDaysEach} days a pause`;
}
