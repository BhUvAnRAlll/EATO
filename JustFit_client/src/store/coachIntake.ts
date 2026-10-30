import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { Intake, IntakePrefill } from "@/lib/coach";

// The intake while the member moves through its steps. Nothing is saved until the last step.
// `null` means "not answered yet"; the backup spot also has "none" (answered: no backup).
export type IntakeDraft = {
  [K in keyof Intake]: K extends "weekdays" | "joints" | "conditions" ? Intake[K]
    : K extends "limitationNotes" | "planNotes" ? string
    : K extends "backupSpot" ? Intake[K] | "none"
    : Intake[K] | null;
} & { acceptedDisclaimer: boolean; editing: boolean };

const empty: IntakeDraft = {
  goal: null,
  experience: null,
  currentlyTraining: null,
  weekdays: [],
  sessionMinutes: null,
  mainSpot: null,
  backupSpot: null,
  mainEquipment: null,
  backupEquipment: null,
  joints: [],
  conditions: [],
  limitationNotes: "",
  cookingTime: null,
  foodBudget: null,
  stress: null,
  sleep: null,
  coach: null,
  coachStyle: null,
  planNotes: "",
  acceptedDisclaimer: false,
  editing: false,
};

type IntakeState = {
  draft: IntakeDraft;
  // A fresh start from what justFit already knows, or editing the saved answers
  start: (saved: Intake | null, prefill: IntakePrefill) => void;
  update: (changes: Partial<IntakeDraft>) => void;
  toggle: (key: "weekdays" | "joints" | "conditions", value: number | string) => void;
};

export const useCoachIntakeStore = create<IntakeState>((set) => ({
  draft: empty,
  start: (saved, prefill) =>
    set({
      draft: saved
        ? { ...saved, backupSpot: saved.backupSpot ?? "none", limitationNotes: saved.limitationNotes ?? "", planNotes: saved.planNotes ?? "", acceptedDisclaimer: false, editing: true }
        : { ...empty, ...prefill },
    }),
  update: (changes) => set((state) => ({ draft: { ...state.draft, ...changes } })),
  toggle: (key, value) =>
    set((state) => {
      const list = state.draft[key] as (number | string)[];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { draft: { ...state.draft, [key]: next } };
    }),
}));

// The answers (goals, health conditions) never carry over to another account
onAccountCleared(() => useCoachIntakeStore.setState({ draft: empty }));

// The draft as the server wants it, or null while something required is missing
export function intakeFromDraft(draft: IntakeDraft): (Intake & { acceptedDisclaimer: boolean }) | null {
  const { goal, experience, currentlyTraining, sessionMinutes, mainSpot, mainEquipment, cookingTime, foodBudget, coach, coachStyle } = draft;
  if (!goal || !experience || currentlyTraining === null || !sessionMinutes || !mainSpot || !mainEquipment || !cookingTime || !foodBudget || !coach || !coachStyle) return null;
  if (draft.weekdays.length === 0 || draft.backupSpot === null) return null;
  const backupSpot = draft.backupSpot === "none" ? null : draft.backupSpot;
  if (backupSpot && !draft.backupEquipment) return null;
  return {
    goal, experience, currentlyTraining, sessionMinutes, mainSpot, mainEquipment, cookingTime, foodBudget, coach, coachStyle,
    weekdays: draft.weekdays,
    backupSpot,
    backupEquipment: backupSpot ? draft.backupEquipment : null,
    joints: draft.joints,
    conditions: draft.conditions,
    limitationNotes: draft.limitationNotes.trim() || null,
    stress: draft.stress,
    sleep: draft.sleep,
    planNotes: draft.planNotes.trim() || null,
    acceptedDisclaimer: draft.acceptedDisclaimer,
  };
}
