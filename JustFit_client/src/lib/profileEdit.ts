import { router } from "expo-router";

import { fetchProfile, type SavedProfile } from "@/lib/profile";
import { profileFromSaved, type EditOrigin } from "@/lib/profileScan";
import { useSetupStore } from "@/store/setup";

// The goal and activity are set by the AI Coach intake only (2026-11-10, the user's choice: no
// second way). The targets screen stays for what the intake can't finish on its own: picking an
// estimate (gender other / prefer not to say) or entering a doctor's target. It reads the setup
// store, so the store is filled from the saved profile first; it saves and returns to `origin`.
export function startTargets(saved: SavedProfile, origin: EditOrigin, { replace = false } = {}) {
  useSetupStore.getState().reset();
  useSetupStore.getState().update(profileFromSaved(saved));
  const href = { pathname: "/setup/targets", params: { from: origin } } as const;
  if (replace) router.replace(href);
  else router.push(href);
}

/** From a card or link with no profile at hand: without the intake's goal and activity, the AI
 *  Coach (its tab starts the intake); with them, the targets screen to finish. */
export async function openTargets(token: string | null, origin: EditOrigin, options: { replace?: boolean } = {}): Promise<string | null> {
  const result = await fetchProfile(token);
  if (!result.ok) return result.error;
  const saved = result.data.profile;
  if (!saved) return "Finish your personal details first.";
  if (!saved.goal || !saved.activity) {
    if (options.replace) router.replace("/coach");
    else router.navigate("/coach");
    return null;
  }
  startTargets(saved, origin, options);
  return null;
}
