import { useLocalSearchParams } from "expo-router";

import { GymMembersManager } from "@/components/gyms/GymMembersManager";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Members: search, active and pending, approve or decline,
// change roles, suspend or remove. The owner is protected; the server checks every change.
export default function ManageMembers() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const getToken = useSessionToken();
  return (
    <ManageShell title="Members">
      {(gym, reload) => <GymMembersManager gym={gym} getToken={getToken} onChanged={reload} start={list === "pending" ? "pending" : "active"} />}
    </ManageShell>
  );
}
