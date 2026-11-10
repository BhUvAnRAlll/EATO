import { router } from "expo-router";

import { fetchProfile, type SavedProfile } from "@/lib/profile";
import { profileFromSaved, type EditOrigin } from "@/lib/profileScan";
import { useSetupStore } from "@/store/setup";

// Profile › Goal & activity (2026-11-10): the goal → activity and health check → targets
// screens, run after setup with the saved answers. They read the setup store, so it is filled
// from the saved profile first; the targets screen saves and returns to `origin`.
export function startGoalEdit(saved: SavedProfile, origin: EditOrigin, { replace = false } = {}) {
  useSetupStore.getState().reset();
  useSetupStore.getState().update(profileFromSaved(saved));
  const href = { pathname: "/setup/goal", params: { from: origin } } as const;
  if (replace) router.replace(href);
  else router.push(href);
}

/** From a card that has no profile at hand (Home, Macro): read it, then open the edit */
export async function openGoalEdit(token: string | null, origin: EditOrigin, options: { replace?: boolean } = {}): Promise<string | null> {
  const result = await fetchProfile(token);
  if (!result.ok) return result.error;
  if (!result.data.profile) return "Finish your personal details first.";
  startGoalEdit(result.data.profile, origin, options);
  return null;
}
