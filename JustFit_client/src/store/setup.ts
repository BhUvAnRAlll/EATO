import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import { estimateFieldText, type BodyScanEstimate } from "@/lib/bodyScanRules";
import type { HealthFlag, Profile } from "@/types/profile";

// Answers collected while the user moves through the profile setup steps
type SetupState = {
  profile: Profile;
  // Calorie target after the user adjusts it on the last step (null = use the calculated one)
  calorieOverride: number | null;
  // Body scan: the result just scanned, waiting for "Use this result", and the one accepted.
  // Kept in memory only; the accepted body fat % is saved with the profile like a typed value.
  scanDraft: BodyScanEstimate | null;
  scan: BodyScanEstimate | null;
  update: (changes: Partial<Profile>) => void;
  toggleCuisine: (cuisine: string) => void;
  toggleHealthFlag: (flag: HealthFlag) => void;
  setCalorieOverride: (calories: number | null) => void;
  setScanDraft: (draft: BodyScanEstimate | null) => void;
  acceptScan: () => void;
  removeScan: () => void;
  reset: () => void;
};

const emptyProfile: Profile = {
  fullName: "",
  dob: "",
  gender: null,
  phone: "",
  email: "",
  goal: null,
  heightCm: "",
  weightKg: "",
  bodyFatPercent: "",
  age: "",
  activity: null,
  healthFlags: [],
  diet: null,
  cuisines: [],
  dislikes: "",
  allergies: "",
  workoutFrequency: null,
  workoutType: null,
  workoutTime: null,
  mealsPerDay: null,
};

export const useSetupStore = create<SetupState>((set) => ({
  profile: emptyProfile,
  calorieOverride: null,
  scanDraft: null,
  scan: null,
  update: (changes) => set((state) => ({ profile: { ...state.profile, ...changes } })),
  toggleCuisine: (cuisine) =>
    set((state) => {
      const { cuisines } = state.profile;
      const next = cuisines.includes(cuisine) ? cuisines.filter((c) => c !== cuisine) : [...cuisines, cuisine];
      return { profile: { ...state.profile, cuisines: next } };
    }),
  toggleHealthFlag: (flag) =>
    set((state) => {
      const { healthFlags } = state.profile;
      const next = healthFlags.includes(flag) ? healthFlags.filter((f) => f !== flag) : [...healthFlags, flag];
      return { profile: { ...state.profile, healthFlags: next } };
    }),
  setCalorieOverride: (calories) => set({ calorieOverride: calories }),
  setScanDraft: (draft) => set({ scanDraft: draft }),
  // The scanned body fat % becomes the profile's, so the targets use it
  acceptScan: () =>
    set((state) =>
      state.scanDraft
        ? {
            scan: state.scanDraft,
            scanDraft: null,
            calorieOverride: null,
            profile: { ...state.profile, bodyFatPercent: estimateFieldText(state.scanDraft) },
          }
        : {},
    ),
  removeScan: () => set((state) => ({ scan: null, scanDraft: null, calorieOverride: null, profile: { ...state.profile, bodyFatPercent: "" } })),
  reset: () => set({ profile: emptyProfile, calorieOverride: null, scanDraft: null, scan: null }),
}));

// Another account's answers (and body scan) never pre-fill the next account's setup
onAccountCleared(() => useSetupStore.getState().reset());
