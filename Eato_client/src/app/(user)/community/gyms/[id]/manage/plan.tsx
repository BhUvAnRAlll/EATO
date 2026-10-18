import { GymPlanPicker } from "@/components/gyms/GymSettingsForm";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Subscription: the plan shown for the gym (display only: no payment exists)
export default function ManagePlan() {
  const getToken = useSessionToken();
  return <ManageShell title="Subscription">{(gym, _reload, setGym) => <GymPlanPicker gym={gym} getToken={getToken} onSaved={setGym} />}</ManageShell>;
}
