import { Redirect } from "expo-router";

// Profile › Gym membership became Gym Hub (2026-11-09): every membership, its visits, payments and
// pauses now live there. This address stays so older links and reminders still open it.
export default function GymMembership() {
  return <Redirect href="/gym-hub" />;
}
