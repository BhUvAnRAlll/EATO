import { GymProfileForm } from "@/components/gyms/GymProfileForm";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";

// Manage › Gym Profile: name, images, location, hours, facilities, plans, contact, guidelines
export default function ManageProfile() {
  const getToken = useSessionToken();
  return <ManageShell title="Gym Profile">{(gym, _reload, setGym) => <GymProfileForm key={gym.id} gym={gym} getToken={getToken} onSaved={setGym} />}</ManageShell>;
}
