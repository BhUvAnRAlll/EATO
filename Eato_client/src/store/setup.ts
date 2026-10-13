import { create } from "zustand";

import type { BodyCompositionReport } from "@/lib/nutrition";
import type { HealthFlag, Profile } from "@/types/profile";

// Answers collected while the user moves through the profile setup steps
type SetupState = {
  profile: Profile;
  // Calorie target after the user adjusts it on the last step (null = use the calculated one)
  calorieOverride: number | null;
  // Body composition report: values read from an upload, awaiting the user's check
  reportDraft: BodyCompositionReport | null;
  // ...and after the user confirmed every value (only this one is ever used)
  report: BodyCompositionReport | null;
  update: (changes: Partial<Profile>) => void;
  toggleCuisine: (cuisine: string) => void;
  toggleHealthFlag: (flag: HealthFlag) => void;
  setCalorieOverride: (calories: number | null) => void;
  setReportDraft: (draft: BodyCompositionReport | null) => void;
  confirmReport: (report: BodyCompositionReport) => void;
  removeReport: () => void;
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
  reportDraft: null,
  report: null,
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
  setReportDraft: (draft) => set({ reportDraft: draft }),
  // Confirmed values also fill in the matching profile fields (the user can still edit them)
  confirmReport: (report) =>
    set((state) => ({
      report,
      reportDraft: null,
      calorieOverride: null,
      profile: {
        ...state.profile,
        gender: report.gender ?? state.profile.gender,
        heightCm: report.heightCm != null ? String(report.heightCm) : state.profile.heightCm,
        weightKg: report.weightKg != null ? String(report.weightKg) : state.profile.weightKg,
        bodyFatPercent: "",
      },
    })),
  removeReport: () => set({ report: null, reportDraft: null, calorieOverride: null }),
  reset: () => set({ profile: emptyProfile, calorieOverride: null, reportDraft: null, report: null }),
}));
