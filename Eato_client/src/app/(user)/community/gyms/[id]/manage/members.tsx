import { useLocalSearchParams } from "expo-router";

import { GymMembersManager } from "@/components/gyms/GymMembersManager";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Members (or Trainers, with ?staff=1): search, active and pending, approve or decline,
// change roles, suspend or remove. The owner is protected; the server checks every change.
export default function ManageMembers() {
  const { staff, list } = useLocalSearchParams<{ staff?: string; list?: string }>();
  const getToken = useSessionToken();
  const staffOnly = staff === "1";
  return (
    <ManageShell title={staffOnly ? "Trainers" : "Members"}>
      {(gym, reload) => <GymMembersManager gym={gym} getToken={getToken} onChanged={reload} staffOnly={staffOnly} start={list === "pending" ? "pending" : "active"} />}
    </ManageShell>
  );
}
