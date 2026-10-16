// What EATO already knows about a member, turned into the engine's inputs.
//
// Two sources, in this order of precedence for every field:
//   1. the member's workout answers (workout_profiles: what Preferences and "Rebuild my
//      plan" saved), which only ever shape training;
//   2. the EATO profile from setup (profiles), which also drives nutrition targets and is
//      never written by the workout feature;
// then the engine's own cautious defaults (inputsFromProfile in engine.ts).

import { inputsFromProfile, type BodyType, type EngineProfile, type ExperienceLevel, type FitnessGoal, type Gender, type Pace, type PlanInputs, type PlanSplit, type Score } from "./engine.ts";

/** The setup profile fields the engine can use (server row names, camel-cased). */
export type EatoProfile = {
  dob?: string | null; // YYYY-MM-DD
  gender?: string | null; // 'male' | 'female' | 'other' | 'unspecified'
  goal?: string | null; // 'fat_loss' | 'maintenance' | 'muscle_gain' | 'healthy_eating'
  heightCm?: number | null;
  weightKg?: number | null;
  workoutFrequency?: string | null; // '1-2' | '3-4' | '5-6' | '7'
  healthFlags?: string[] | null;
};

/** The answers saved by the workout feature itself (one workout_profiles row). */
export type WorkoutAnswers = {
  gender?: Gender | null;
  ageYears?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  bodyType?: BodyType | null;
  goal?: FitnessGoal | null;
  experience?: ExperienceLevel | null;
  weekdays?: number[] | null;
  pace?: Pace | null;
  fitnessBase?: Score | null;
  squatScore?: Score | null;
  pushScore?: Score | null;
  pullScore?: Score | null;
  seriousInjury?: boolean | null;
  split?: PlanSplit | null;
};

// EATO's setup goals onto the engine's four. Maintenance and healthy eating both train
// the "stay fit" way in the engine, so the choice between them changes nothing.
const GOAL_FROM_EATO: Record<string, FitnessGoal> = {
  fat_loss: "lose_weight",
  muscle_gain: "build_muscle",
  maintenance: "stay_healthy",
  healthy_eating: "get_fitter",
};

// "How often do you work out?" from setup, as training days: the low end of each range,
// so a silently generated first plan never asks for more than the member said they do
const DAYS_FROM_FREQUENCY: Record<string, number> = { "1-2": 1, "3-4": 3, "5-6": 5, "7": 7 };

const present = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

/** The engine profile for a member: workout answers first, then the setup profile. */
export function engineProfileFor(eato: EatoProfile, answers: WorkoutAnswers = {}): EngineProfile {
  const eatoGender: Gender | undefined = eato.gender === "male" || eato.gender === "female" ? eato.gender : eato.gender ? "other" : undefined;
  const eatoGoal = eato.goal ? GOAL_FROM_EATO[eato.goal] : undefined;
  const flagged = Array.isArray(eato.healthFlags) && eato.healthFlags.length > 0;
  return {
    gender: present(answers.gender) ?? eatoGender,
    dateOfBirth: present(eato.dob),
    weightKg: present(answers.weightKg) ?? present(eato.weightKg),
    heightCm: present(answers.heightCm) ?? present(eato.heightCm),
    bodyType: present(answers.bodyType),
    goal: present(answers.goal) ?? eatoGoal,
    experience: present(answers.experience),
    trainingWeekdays: present(answers.weekdays),
    daysPerWeek: eato.workoutFrequency ? DAYS_FROM_FREQUENCY[eato.workoutFrequency] : undefined,
    pace: present(answers.pace),
    fitnessBase: present(answers.fitnessBase),
    squatScore: present(answers.squatScore),
    pushScore: present(answers.pushScore),
    pullScore: present(answers.pullScore),
    // A health flag from setup (e.g. pregnancy) counts as "train around something" until
    // the member answers the injury question themselves
    seriousInjury: present(answers.seriousInjury) ?? (flagged ? true : undefined),
  };
}

/**
 * The engine inputs for a member on `today` (YYYY-MM-DD). An age the member gave in
 * "Rebuild my plan" wins over the one implied by their date of birth.
 */
export function inputsForMember(eato: EatoProfile, answers: WorkoutAnswers, today: string, overrides: Partial<PlanInputs> = {}): PlanInputs {
  const ageYears = present(answers.ageYears);
  const split = present(answers.split);
  return inputsFromProfile(engineProfileFor(eato, answers), today, {
    ...(ageYears !== undefined ? { ageYears } : {}),
    ...(split !== undefined ? { split } : {}),
    ...overrides,
  });
}
