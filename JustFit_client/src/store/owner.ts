import { create } from "zustand";

import { onAccountCleared, sameAccount } from "@/lib/accountScope";
import { owner, type ManagedGym, type OwnerSummary } from "@/lib/owner";

// The gym owner portal's shared state: which gym it shows, the gyms the caller runs (for the
// switcher), and the Home summary (whose counts also drive the tab badges). Session memory only;
// the server re-checks access to the gym on every call.
type OwnerState = {
  gymId: string | null;
  gyms: ManagedGym[] | null;
  summary: OwnerSummary | null;
  error: string | null;
  // The member code the front desk just scanned (kept here, not in the address bar)
  scan: string | null;
  setScan: (code: string | null) => void;
  // Set by "Scan again" / "Scan next member": the Check-in tab reopens its scanner
  rescan: boolean;
  setRescan: (rescan: boolean) => void;
  // Open a gym (the entry button, the switcher, or Admin › Gyms for a platform admin)
  setGym: (gymId: string) => void;
  // The caller's gyms; with none chosen yet, the first one opens
  loadGyms: (token: string | null) => Promise<void>;
  // Today's summary for the open gym
  loadSummary: (token: string | null) => Promise<void>;
};

const signedOut = { gymId: null, gyms: null, summary: null, error: null, scan: null, rescan: false };

export const useOwnerStore = create<OwnerState>((set, get) => ({
  ...signedOut,
  setScan: (scan) => set({ scan }),
  setRescan: (rescan) => set({ rescan }),
  setGym: (gymId) => set((state) => (state.gymId === gymId ? state : { gymId, summary: null, error: null })),
  loadGyms: async (token) => {
    const stillCurrent = sameAccount();
    const result = await owner.gyms(token);
    if (!stillCurrent()) return; // signed out meanwhile: this answer was for the previous account
    if (!result.ok) return set({ error: result.error });
    set((state) => ({ gyms: result.data.gyms, gymId: state.gymId ?? result.data.gyms[0]?.id ?? null }));
  },
  loadSummary: async (token) => {
    const gymId = get().gymId;
    if (!gymId) return;
    const stillCurrent = sameAccount();
    const result = await owner.summary(token, gymId);
    // Ignore an answer for a gym the owner has switched away from, or signed out of, meanwhile
    if (!stillCurrent() || get().gymId !== gymId) return;
    set(result.ok ? { summary: result.data, error: null } : { error: result.error });
  },
}));

// The next account opens its own gyms, never the previous account's
onAccountCleared(() => useOwnerStore.setState(signedOut));

// The tab badges: join requests on Members, posts to review and reports on Review
export function ownerBadges(summary: OwnerSummary | null): Record<string, number> {
  if (!summary) return {};
  return { members: summary.attention.joinRequests, review: summary.attention.postsToReview + summary.attention.reportedPosts };
}
