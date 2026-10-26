import type { Icon } from "@/types/profile";

// The AI Coach intake: every option the member picks from. The ids match the server's checks
// (Eato_server/coach/validate.js) and the coach_profiles columns.

export type CoachGoal = "build_muscle" | "lose_weight" | "get_stronger" | "endurance" | "stay_active" | "flexibility" | "sport" | "comeback";
export type Experience = "beginner" | "returning" | "intermediate" | "advanced" | "expert";
export type Spot = "gym" | "home" | "outdoors" | "travel" | "other";
export type Equipment = "none" | "some" | "home_gym" | "full_gym" | "basic_gym" | "free_weights";
export type Joint = "knees" | "shoulders" | "lower_back" | "elbows" | "wrists" | "hips" | "ankles";
export type Condition = "heart_disease" | "high_bp" | "diabetes" | "asthma" | "arthritis" | "back_problems" | "previous_surgery" | "thyroid" | "pcos";
export type CookingTime = "none" | "quick" | "medium" | "long";
export type FoodBudget = "low" | "medium" | "high";
export type Stress = "low" | "moderate" | "high";
export type Sleep = "under_5" | "5_6" | "7_8" | "over_8";
export type CoachId = "arjun" | "priya" | "rohan" | "meera" | "aditya";
export type CoachStyle = "supportive" | "motivational" | "direct" | "analytical" | "funny";

type Choice<T> = { id: T; label: string; note?: string; icon?: Icon };

// The intake screens, in order (the step counter, "3/9", follows this list)
export const intakeSteps = ["goal", "experience", "schedule", "spots", "equipment", "limits", "lifestyle", "coach", "notes"] as const;
export type IntakeStep = (typeof intakeSteps)[number];

export const coachGoals: Choice<CoachGoal>[] = [
  { id: "build_muscle", label: "Build muscle", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { id: "lose_weight", label: "Lose weight", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" } },
  { id: "get_stronger", label: "Get stronger", icon: { ios: "bolt.fill", android: "bolt", web: "bolt" } },
  { id: "endurance", label: "Improve endurance", icon: { ios: "figure.run", android: "directions_run", web: "directions_run" } },
  { id: "stay_active", label: "Stay active", icon: { ios: "figure.walk", android: "directions_walk", web: "directions_walk" } },
  { id: "flexibility", label: "Increase flexibility", icon: { ios: "figure.yoga", android: "self_improvement", web: "self_improvement" } },
  { id: "sport", label: "Sport-specific training", icon: { ios: "sportscourt.fill", android: "sports_cricket", web: "sports_cricket" } },
  { id: "comeback", label: "Return from a break", icon: { ios: "arrow.uturn.backward", android: "replay", web: "replay" } },
];

export const experienceLevels: Choice<Experience>[] = [
  { id: "beginner", label: "Beginner", note: "Just starting out" },
  { id: "returning", label: "Returning", note: "Getting back into it" },
  { id: "intermediate", label: "Intermediate", note: "Comfortable with training" },
  { id: "advanced", label: "Advanced", note: "Highly experienced" },
  { id: "expert", label: "Expert", note: "5+ years of dedicated training" },
];

// 0 = Sunday, as the workout plan stores days; shown Monday first
export const weekdayChoices: { id: number; label: string }[] = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

export const sessionLengths: { id: number; label: string }[] = [
  { id: 15, label: "15 min" },
  { id: 20, label: "20 min" },
  { id: 30, label: "30 min" },
  { id: 45, label: "45 min" },
  { id: 60, label: "60 min" },
  { id: 75, label: "75+ min" },
];

export const spots: Choice<Spot>[] = [
  { id: "gym", label: "Gym", icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" } },
  { id: "home", label: "Home", icon: { ios: "house", android: "home", web: "home" } },
  { id: "outdoors", label: "Outdoors", icon: { ios: "tree", android: "park", web: "park" } },
  { id: "travel", label: "Hotel / travel", icon: { ios: "bed.double", android: "hotel", web: "hotel" } },
  { id: "other", label: "Somewhere else", icon: { ios: "plus", android: "add", web: "add" } },
];

// What can be picked at each spot (a gym is never "nothing"); same rule as the server
export const equipmentBySpot: Record<Spot, Choice<Equipment>[]> = {
  gym: [
    { id: "full_gym", label: "Full gym", note: "Machines, racks, everything" },
    { id: "basic_gym", label: "Basic", note: "About 15 pieces" },
    { id: "free_weights", label: "Free weights", note: "Racks and a bench" },
  ],
  home: [
    { id: "none", label: "Nothing", note: "Bodyweight only" },
    { id: "some", label: "A few things", note: "Bands, dumbbells" },
    { id: "home_gym", label: "Home gym", note: "Rack, bench, weights" },
    { id: "full_gym", label: "Full gym", note: "Machines too" },
  ],
  outdoors: [
    { id: "none", label: "Nothing", note: "Bodyweight only" },
    { id: "some", label: "A few things", note: "Bands, a skipping rope" },
  ],
  travel: [
    { id: "none", label: "Nothing", note: "Bodyweight only" },
    { id: "some", label: "A few things", note: "A small hotel gym or bands" },
  ],
  other: [
    { id: "none", label: "Nothing", note: "Bodyweight only" },
    { id: "some", label: "A few things", note: "Some basic equipment" },
  ],
};

export const joints: Choice<Joint>[] = [
  { id: "knees", label: "Knees" },
  { id: "shoulders", label: "Shoulders" },
  { id: "lower_back", label: "Lower back" },
  { id: "elbows", label: "Elbows" },
  { id: "wrists", label: "Wrists" },
  { id: "hips", label: "Hips" },
  { id: "ankles", label: "Ankles" },
];

export const conditions: Choice<Condition>[] = [
  { id: "heart_disease", label: "Heart disease" },
  { id: "high_bp", label: "High blood pressure" },
  { id: "diabetes", label: "Diabetes" },
  { id: "thyroid", label: "Thyroid" },
  { id: "pcos", label: "PCOS / PCOD" },
  { id: "asthma", label: "Asthma" },
  { id: "arthritis", label: "Arthritis" },
  { id: "back_problems", label: "Back problems" },
  { id: "previous_surgery", label: "Previous surgery" },
];

export const cookingTimes: Choice<CookingTime>[] = [
  { id: "none", label: "I don't cook" },
  { id: "quick", label: "Under 15 min" },
  { id: "medium", label: "15–30 min" },
  { id: "long", label: "30+ min" },
];

export const foodBudgets: Choice<FoodBudget>[] = [
  { id: "low", label: "Budget", note: "Under ₹200 a day" },
  { id: "medium", label: "Moderate", note: "₹200–400 a day" },
  { id: "high", label: "Flexible", note: "₹400+ a day" },
];

export const stressLevels: Choice<Stress>[] = [
  { id: "low", label: "Low", icon: { ios: "sun.max", android: "light_mode", web: "light_mode" } },
  { id: "moderate", label: "Moderate", icon: { ios: "cloud.sun", android: "partly_cloudy_day", web: "partly_cloudy_day" } },
  { id: "high", label: "High", icon: { ios: "cloud.bolt", android: "thunderstorm", web: "thunderstorm" } },
];

export const sleepRanges: Choice<Sleep>[] = [
  { id: "under_5", label: "Under 5 h" },
  { id: "5_6", label: "5–6 h" },
  { id: "7_8", label: "7–8 h" },
  { id: "over_8", label: "8+ h" },
];

export const coaches: { id: CoachId; name: string; note: string }[] = [
  { id: "arjun", name: "Coach Arjun", note: "Strength and form. Calm and steady." },
  { id: "priya", name: "Coach Priya", note: "Food first. Warm and patient." },
  { id: "rohan", name: "Coach Rohan", note: "High energy. Loves a challenge." },
  { id: "meera", name: "Coach Meera", note: "Mobility and yoga. Mindful." },
  { id: "aditya", name: "Coach Aditya", note: "Numbers and progress. Explains the why." },
];

export const coachStyles: Choice<CoachStyle>[] = [
  { id: "supportive", label: "Supportive", note: "Celebrates every win", icon: { ios: "heart.fill", android: "favorite", web: "favorite" } },
  { id: "motivational", label: "Motivational", note: "Pushes you to your best", icon: { ios: "flame", android: "whatshot", web: "whatshot" } },
  { id: "direct", label: "Direct", note: "No fluff, just the plan", icon: { ios: "bolt", android: "bolt", web: "bolt" } },
  { id: "analytical", label: "Analytical", note: "Explains the why", icon: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" } },
  { id: "funny", label: "Funny", note: "Keeps it light and fun", icon: { ios: "face.smiling", android: "mood", web: "mood" } },
];

export const labelOf = <T,>(list: { id: T; label: string }[], id: T | null | undefined) => list.find((item) => item.id === id)?.label ?? "";
