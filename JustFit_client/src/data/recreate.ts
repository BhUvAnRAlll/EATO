import type { BodyType, Gender, Pace, RecreateGoal, Score } from "@/lib/recreateRules";
import type { Icon } from "@/types/profile";

// The choices "Rebuild my plan" offers, with the workout spec's copy

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

// Three cards for the engine's body types (they only shape the conditioning chosen)
export const BODY_TYPES: { value: BodyType; label: string; icon: Icon }[] = [
  { value: "lean", label: "Slim build", icon: { ios: "figure.run", android: "directions_run", web: "directions_run" } },
  { value: "average", label: "Medium build", icon: { ios: "figure.walk", android: "directions_walk", web: "directions_walk" } },
  { value: "overweight", label: "Larger build", icon: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" } },
];

export const RECREATE_GOALS: { value: RecreateGoal; label: string }[] = [
  { value: "lose_weight", label: "Lose weight" },
  { value: "build_muscle", label: "Gain muscle" },
  { value: "get_fitter", label: "Stay fit" },
];

// The expected change is shown only when losing weight: the one goal where it means something
export const PACES: { value: Pace; label: string; loss: string }[] = [
  { value: "slow", label: "I'll take my time", loss: "0.5–1 kg a month" },
  { value: "standard", label: "Healthy", loss: "1–2 kg a month" },
  { value: "brisk", label: "Take it up a notch", loss: "2–3 kg a month" },
];

export const FITNESS_STATEMENTS: { value: Score; label: string; note: string }[] = [
  { value: 1, label: "Just starting out", note: "New to regular exercise" },
  { value: 2, label: "Getting back into it", note: "Trained before, out of the habit" },
  { value: 3, label: "Training regularly", note: "Two or more sessions most weeks" },
  { value: 4, label: "In great shape", note: "Training hard and consistently" },
];

// Scores 1–4 for each performance question, as the ranges a member picks from
export const PERFORMANCE: { key: "squatScore" | "pushScore" | "pullScore"; label: string; ranges: string[] }[] = [
  { key: "squatScore", label: "Bodyweight squats", ranges: ["0", "1–5", "6–15", ">15"] },
  { key: "pushScore", label: "Push-ups", ranges: ["0", "1–5", "6–10", ">10"] },
  { key: "pullScore", label: "Pull-ups", ranges: ["0", "1–5", "6–10", ">10"] },
];

export const label = <T,>(list: { value: T; label: string }[], value: T | null) => list.find((o) => o.value === value)?.label ?? "—";
