import type { SymbolViewProps } from "expo-symbols";

import type { ActivityLevel, EquationGender, FitnessGoal, Gender, HealthFlag } from "@/lib/nutrition";

export type { ActivityLevel, EquationGender, FitnessGoal, Gender, HealthFlag };

export type Icon = SymbolViewProps["name"];

export type DietId = "vegetarian" | "non-vegetarian" | "eggetarian" | "vegan";
export type WorkoutFrequency = "1-2" | "3-4" | "5-6" | "7";
export type WorkoutType = "gym" | "home" | "cardio" | "other";
export type WorkoutTime = "morning" | "afternoon" | "evening";
export type MealsPerDay = "3" | "4" | "5" | "6+";

// Everything collected by the profile setup steps
export type Profile = {
  fullName: string;
  dob: string; // DD/MM/YYYY
  gender: Gender | null;
  phone: string; // 10 digits, +91 implied
  email: string;
  goal: FitnessGoal | null;
  heightCm: string;
  weightKg: string;
  // Optional measured body fat % (no sheet); enables Katch–McArdle
  bodyFatPercent: string;
  age: string; // worked out from dob
  activity: ActivityLevel | null;
  // Optional; any of these routes the targets to professional guidance
  healthFlags: HealthFlag[];
  diet: DietId | null;
  cuisines: string[];
  dislikes: string;
  allergies: string;
  workoutFrequency: WorkoutFrequency | null;
  workoutType: WorkoutType | null;
  workoutTime: WorkoutTime | null;
  mealsPerDay: MealsPerDay | null;
};

export type Option<T extends string> = {
  id: T;
  label: string;
  description?: string;
  icon?: Icon;
};
