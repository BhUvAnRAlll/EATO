// Labels and small calculations the trainer screens share. Pure (no React Native, no "@/"
// imports) so they are unit-tested with node --test. The server decides every permission
// (Eato_server/trainers/); these only choose what to show.
export type Specialty = "weight_loss" | "muscle_gain" | "nutrition" | "strength" | "yoga";
export type CoachingMode = "online" | "in_person" | "both";
export type PlanGoal = "fat_loss" | "muscle_gain" | "maintenance";
export type MealSlot = "breakfast" | "morning_snack" | "lunch" | "evening_snack" | "dinner";
export type ConnectionState = "none" | "requested" | "connected";

export const specialtyLabels: Record<Specialty, string> = { weight_loss: "Weight Loss", muscle_gain: "Muscle Gain", nutrition: "Nutrition", strength: "Strength", yoga: "Yoga" };
export const specialties = Object.keys(specialtyLabels) as Specialty[];
export const coachingModeLabels: Record<CoachingMode, string> = { online: "Online", in_person: "In person", both: "Online and in person" };
export const planGoalLabels: Record<PlanGoal, string> = { fat_loss: "Fat Loss", muscle_gain: "Muscle Gain", maintenance: "Maintenance" };
export const mealSlots: MealSlot[] = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"];
export const mealSlotLabels: Record<MealSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning Snack", lunch: "Lunch", evening_snack: "Evening Snack", dinner: "Dinner" };
export const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The connect button on a trainer: what it says and what tapping it does
export type ConnectButton = { label: string; action: "connect" | "switch" | "cancel" | null; tone: "primary" | "soft" };

export function connectButton(state: ConnectionState, hasOtherTrainer: boolean, acceptingClients: boolean): ConnectButton {
  if (state === "connected") return { label: "Your trainer", action: null, tone: "soft" };
  if (state === "requested") return { label: "Request Sent", action: "cancel", tone: "soft" };
  if (!acceptingClients) return { label: "Not taking clients", action: null, tone: "soft" };
  if (hasOtherTrainer) return { label: "Switch to this trainer", action: "switch", tone: "primary" };
  return { label: "Connect with Trainer", action: "connect", tone: "primary" };
}

export type Food = { name: string; quantity: number; unit: string; kcal: number; proteinG: number; carbsG: number; fatG: number };
export type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

// Totals of the foods with the servings the member chose (0 = skipped); one serving each when unset
export function scaledTotals(foods: Food[], servings: number[]): Totals {
  return foods.reduce(
    (sum, food, i) => {
      const k = servings[i] ?? 1;
      return { kcal: round1(sum.kcal + food.kcal * k), proteinG: round1(sum.proteinG + food.proteinG * k), carbsG: round1(sum.carbsG + food.carbsG * k), fatG: round1(sum.fatG + food.fatG * k) };
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

// The serving stepper: half a serving at a time, between 0 and 10
export const stepServing = (value: number, direction: 1 | -1) => Math.min(10, Math.max(0, Math.round((value + direction * 0.5) * 2) / 2));

// ---- the trainer's plan editor: one food per line ----
// "Oats | 60 g | 230 | 8 | 40 | 4" = name | quantity unit | kcal | protein | carbs | fat. The
// editor stays a few text boxes; these turn the text into the foods the server expects.

export function parseFoods(text: string): { foods: Food[]; errors: string[] } {
  const foods: Food[] = [];
  const errors: string[] = [];
  text.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line, index) => {
    const parts = line.split("|").map((p) => p.trim());
    const amount = /^(\d+(?:\.\d+)?)\s*(.+)$/.exec(parts[1] ?? "");
    const numbers = parts.slice(2, 6).map(Number);
    if (parts.length !== 6 || !parts[0] || !amount || numbers.some((n) => !Number.isFinite(n) || n < 0)) {
      errors.push(`Line ${index + 1}: write name | quantity unit | kcal | protein | carbs | fat`);
      return;
    }
    foods.push({ name: parts[0], quantity: Number(amount[1]), unit: amount[2].trim(), kcal: numbers[0], proteinG: numbers[1], carbsG: numbers[2], fatG: numbers[3] });
  });
  return { foods, errors };
}

export const foodsText = (foods: Food[]) => foods.map((f) => `${f.name} | ${f.quantity} ${f.unit} | ${f.kcal} | ${f.proteinG} | ${f.carbsG} | ${f.fatG}`).join("\n");

// The calories the macros add up to (4 / 4 / 9 kcal per gram), for a soft "doesn't add up" hint
export const macroKcal = (t: { proteinG: number; carbsG: number; fatG: number }) => Math.round(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9);
export const macrosRoughlyMatch = (kcal: number, t: { proteinG: number; carbsG: number; fatG: number }) => Math.abs(macroKcal(t) - kcal) <= Math.max(100, kcal * 0.1);
