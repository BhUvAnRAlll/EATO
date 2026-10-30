import { GymSettingsForm } from "@/components/gyms/GymSettingsForm";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Community Settings: posting, comments, approvals, moderation, events, visibility
export default function ManageSettings() {
  const getToken = useSessionToken();
  return <ManageShell title="Community Settings">{(gym, _reload, setGym) => <GymSettingsForm gym={gym} getToken={getToken} onSaved={setGym} />}</ManageShell>;
}
