import { useCallback, useRef } from "react";
import { useLocalSearchParams } from "expo-router";

import { GymMembersManager } from "@/components/gyms/GymMembersManager";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Members: search, active and pending, approve or decline,
// change roles, suspend or remove. The owner is protected; the server checks every change.
export default function ManageMembers() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const getToken = useSessionToken();
  // A pull on the shell reads the member lists again as well as the gym
  const reloadLists = useRef<(() => Promise<unknown>) | null>(null);
  const onRefresh = useCallback(() => reloadLists.current?.() ?? Promise.resolve(), []);
  return (
    <ManageShell title="Members" onRefresh={onRefresh}>
      {(gym, reload) => <GymMembersManager gym={gym} getToken={getToken} onChanged={reload} start={list === "pending" ? "pending" : "active"} reloadRef={reloadLists} />}
    </ManageShell>
  );
}
