import type {
  ActivityLevel,
  DietId,
  FitnessGoal,
  Gender,
  HealthFlag,
  MealsPerDay,
  Option,
  WorkoutFrequency,
  WorkoutTime,
  WorkoutType,
} from "@/types/profile";

// Every profile setup screen, in order (the progress counter, "2/7", follows this list)
export const setupSteps = ["personal", "body-composition", "goal", "activity", "food", "lifestyle", "targets"] as const;
export type SetupStep = (typeof setupSteps)[number];

export const genderOptions: Option<Gender>[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
  { id: "unspecified", label: "Prefer not to say" },
];

export const goalOptions: Option<FitnessGoal>[] = [
  {
    id: "fat_loss",
    label: "Lose fat",
    description: "Burn fat, feel lighter",
    icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" },
  },
  {
    id: "muscle_gain",
    label: "Build muscle",
    description: "Gain strength & size",
    icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" },
  },
  {
    id: "maintenance",
    label: "Maintain weight",
    description: "Stay fit, stay healthy",
    icon: { ios: "scalemass.fill", android: "monitor_weight", web: "monitor_weight" },
  },
  {
    id: "healthy_eating",
    label: "Eat healthier",
    description: "Better food, better you",
    icon: { ios: "leaf", android: "eco", web: "eco" },
  },
];

export const activityOptions: Option<ActivityLevel>[] = [
  { id: "sedentary", label: "Sedentary", description: "do little or no exercise" },
  { id: "lightly_active", label: "Lightly active", description: "exercise 1–3 days per week" },
  { id: "moderately_active", label: "Moderately active", description: "exercise 3–5 days per week" },
  { id: "very_active", label: "Very active", description: "exercise 6–7 days per week" },
  { id: "extra_active", label: "Extra active", description: "train hard daily or have a physical job" },
];

// Optional health check on the body step. Any of these means the app won't set a
// target automatically and asks the user to follow professional guidance.
export const healthFlagOptions: Option<HealthFlag>[] = [
  { id: "pregnant", label: "Pregnant" },
  { id: "breastfeeding", label: "Breastfeeding" },
  { id: "medical_condition", label: "Medical condition affecting diet" },
  { id: "eating_disorder", label: "History of an eating disorder" },
];

export const dietOptions: Option<DietId>[] = [
  { id: "vegetarian", label: "Vegetarian", icon: { ios: "leaf", android: "eco", web: "eco" } },
  {
    id: "non-vegetarian",
    label: "Non-vegetarian",
    icon: { ios: "fork.knife", android: "set_meal", web: "set_meal" },
  },
  { id: "eggetarian", label: "Eggetarian", icon: { ios: "oval.portrait", android: "egg", web: "egg" } },
  { id: "vegan", label: "Vegan", icon: { ios: "camera.macro", android: "spa", web: "spa" } },
];

export const cuisineOptions = ["South Indian", "North Indian", "Mediterranean", "Asian", "Continental", "Others"];

export const workoutFrequencyOptions: Option<WorkoutFrequency>[] = [
  { id: "1-2", label: "1–2 days" },
  { id: "3-4", label: "3–4 days" },
  { id: "5-6", label: "5–6 days" },
  { id: "7", label: "7 days" },
];

export const workoutTypeOptions: Option<WorkoutType>[] = [
  { id: "gym", label: "Gym", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { id: "home", label: "Home", icon: { ios: "house", android: "home", web: "home" } },
  { id: "cardio", label: "Cardio", icon: { ios: "figure.run", android: "directions_run", web: "directions_run" } },
  { id: "other", label: "Other", icon: { ios: "ellipsis", android: "more_horiz", web: "more_horiz" } },
];

export const workoutTimeOptions: Option<WorkoutTime>[] = [
  { id: "morning", label: "Morning", icon: { ios: "sunrise", android: "wb_sunny", web: "wb_sunny" } },
  { id: "afternoon", label: "Afternoon", icon: { ios: "sun.max", android: "light_mode", web: "light_mode" } },
  { id: "evening", label: "Evening", icon: { ios: "moon", android: "dark_mode", web: "dark_mode" } },
];

export const mealsPerDayOptions: Option<MealsPerDay>[] = [
  { id: "3", label: "3" },
  { id: "4", label: "4" },
  { id: "5", label: "5" },
  { id: "6+", label: "6+" },
];
