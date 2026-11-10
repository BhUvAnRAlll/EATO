import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { Intake, IntakePrefill, IntakeProfile } from "@/lib/coach";
import type { FoodAnswers } from "@/lib/profile";
import type { ActivityLevel, Gender, HealthFlag } from "@/types/profile";

// The intake while the member moves through its steps. Nothing is saved until the last step.
// `null` means "not answered yet". Since 2026-11-10 the intake also asks the activity level, the
// health check and the food answers (setup asks only the personal details); the backup spot,
// stress, sleep and plan notes were removed (the server keeps any older answers' columns empty).
type Asked = Pick<Intake, "goal" | "experience" | "currentlyTraining" | "sessionMinutes" | "mainSpot" | "mainEquipment" | "cookingTime" | "foodBudget" | "coach" | "coachStyle">;
export type IntakeDraft = { [K in keyof Asked]: Asked[K] | null } & {
  weekdays: number[];
  joints: Intake["joints"];
  conditions: Intake["conditions"];
  limitationNotes: string;
  activity: ActivityLevel | null;
  healthFlags: HealthFlag[];
  food: FoodAnswers;
  // The member's gender from setup: pregnancy and breastfeeding aren't asked when it is male
  gender: Gender | null;
  acceptedDisclaimer: boolean;
  editing: boolean;
};

const emptyFood: FoodAnswers = { diet: null, cuisines: [], dislikes: "", allergies: "", mealsPerDay: null };
const empty: IntakeDraft = {
  goal: null,
  experience: null,
  currentlyTraining: null,
  weekdays: [],
  sessionMinutes: null,
  mainSpot: null,
  mainEquipment: null,
  joints: [],
  conditions: [],
  limitationNotes: "",
  cookingTime: null,
  foodBudget: null,
  coach: null,
  coachStyle: null,
  activity: null,
  healthFlags: [],
  food: emptyFood,
  gender: null,
  acceptedDisclaimer: false,
  editing: false,
};

type IntakeState = {
  draft: IntakeDraft;
  // A fresh start from what justFit already knows, or editing the saved answers; `profile` is the
  // activity, health and food answers already on the member's profile
  start: (saved: Intake | null, prefill: IntakePrefill, profile?: Partial<IntakeProfile>, gender?: Gender | null) => void;
  update: (changes: Partial<IntakeDraft>) => void;
  updateFood: (changes: Partial<FoodAnswers>) => void;
  toggle: (key: "weekdays" | "joints" | "conditions" | "healthFlags", value: number | string) => void;
};

export const useCoachIntakeStore = create<IntakeState>((set) => ({
  draft: empty,
  start: (saved, prefill, profile = {}, gender = null) => {
    const fromProfile = {
      activity: profile.activity ?? null,
      healthFlags: profile.healthFlags ?? [],
      food: {
        diet: profile.diet ?? null,
        cuisines: profile.cuisines ?? [],
        dislikes: profile.dislikes ?? "",
        allergies: profile.allergies ?? "",
        mealsPerDay: profile.mealsPerDay ?? null,
      },
      gender,
    };
    set({
      draft: saved
        ? {
            ...empty,
            ...pick(saved),
            limitationNotes: saved.limitationNotes ?? "",
            ...fromProfile,
            acceptedDisclaimer: false,
            editing: true,
          }
        : { ...empty, ...prefill, ...fromProfile },
    });
  },
  update: (changes) => set((state) => ({ draft: { ...state.draft, ...changes } })),
  updateFood: (changes) => set((state) => ({ draft: { ...state.draft, food: { ...state.draft.food, ...changes } } })),
  toggle: (key, value) =>
    set((state) => {
      const list = state.draft[key] as (number | string)[];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { draft: { ...state.draft, [key]: next } };
    }),
}));

// The saved answers the intake still asks (older ones, like the backup spot, are left behind)
function pick(saved: Intake) {
  const { goal, experience, currentlyTraining, weekdays, sessionMinutes, mainSpot, mainEquipment, joints, conditions, cookingTime, foodBudget, coach, coachStyle } = saved;
  return { goal, experience, currentlyTraining, weekdays, sessionMinutes, mainSpot, mainEquipment, joints, conditions, cookingTime, foodBudget, coach, coachStyle };
}

// The answers (goals, health conditions) never carry over to another account
onAccountCleared(() => useCoachIntakeStore.setState({ draft: empty }));

// The draft as the server wants it, or null while something required is missing
export function intakeFromDraft(draft: IntakeDraft): (Intake & { acceptedDisclaimer: boolean; profile: IntakeProfile }) | null {
  const { goal, experience, currentlyTraining, sessionMinutes, mainSpot, mainEquipment, cookingTime, foodBudget, coach, coachStyle, activity, food } = draft;
  if (!goal || !experience || currentlyTraining === null || !sessionMinutes || !mainSpot || !mainEquipment || !cookingTime || !foodBudget || !coach || !coachStyle) return null;
  if (draft.weekdays.length === 0 || !activity || !food.diet || !food.mealsPerDay) return null;
  const healthFlags = draft.gender === "male" ? draft.healthFlags.filter((f) => f !== "pregnant" && f !== "breastfeeding") : draft.healthFlags;
  return {
    goal, experience, currentlyTraining, sessionMinutes, mainSpot, mainEquipment, cookingTime, foodBudget, coach, coachStyle,
    weekdays: draft.weekdays,
    backupSpot: null,
    backupEquipment: null,
    joints: draft.joints,
    conditions: draft.conditions,
    limitationNotes: draft.limitationNotes.trim() || null,
    stress: null,
    sleep: null,
    planNotes: null,
    acceptedDisclaimer: draft.acceptedDisclaimer,
    profile: {
      activity,
      healthFlags,
      diet: food.diet,
      cuisines: food.cuisines,
      dislikes: food.dislikes.trim(),
      allergies: food.allergies.trim(),
      mealsPerDay: food.mealsPerDay,
    },
  };
}
