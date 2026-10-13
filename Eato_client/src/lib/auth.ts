import { router } from "expo-router";

// Clears the onboarding/auth/setup screens from the stack and opens the start
// screen, which sends the person to the right place for their role
// (see `getHomeRoute` in lib/roles.ts).
function resetToStart() {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/");
}

// Open home (used when profile setup is finished)
export function goHome() {
  resetToStart();
}

// After signing in or up: the dashboard for their role (users finish profile setup first)
export function goAfterSignIn() {
  resetToStart();
}
