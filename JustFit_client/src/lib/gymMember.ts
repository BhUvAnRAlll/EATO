import type { GymMember } from "@/lib/gymApi";

export type MemberStatusId = "active" | "due" | "expiring" | "expired";

// The one-word status a member's card shows: expired first, then owing, then ending soon
export function memberStatus(member: GymMember): { id: MemberStatusId; label: string } {
  if (member.status === "expired") return { id: "expired", label: "Expired" };
  if (member.due > 0) return { id: "due", label: "Due" };
  if (member.status === "expiring") return { id: "expiring", label: "Expiring" };
  return { id: "active", label: "Active" };
}
