// Pure rules for the AI Coach plan (no database, no network), so they are unit-tested directly.
//
// The workout comes from the existing engine; these rules only turn the intake into the engine's
// answers and shape what it may pick (equipment, joints) and how long a session runs. The diet
// comes from the model; these rules clean its answer and scale the portions so the day lands on
// the member's own nutrition targets.
const workout = require("../../Eato_client/src/lib/workout/index.ts");

// ---- the workout --------------------------------------------------------------------

// The intake's goals and levels → the engine's
const ENGINE_GOAL = {
  build_muscle: "build_muscle",
  get_stronger: "build_muscle",
  lose_weight: "lose_weight",
  endurance: "get_fitter",
  sport: "get_fitter",
  stay_active: "stay_healthy",
  flexibility: "stay_healthy",
  comeback: "stay_healthy",
};
const ENGINE_LEVEL = { beginner: "beginner", returning: "beginner", intermediate: "intermediate", advanced: "advanced", expert: "advanced" };

const engineGoalFor = (goal) => ENGINE_GOAL[goal];
const engineLevelFor = (experience) => ENGINE_LEVEL[experience];

// What each equipment answer can use, by the library's equipment names. Bodyweight is always fine.
const EQUIPMENT = {
  none: ["Bodyweight"],
  some: ["Bodyweight", "Dumbbell", "Resistance band", "Kettlebell", "Rope"],
  home_gym: ["Bodyweight", "Dumbbell", "Resistance band", "Kettlebell", "Rope", "Barbell"],
  free_weights: ["Bodyweight", "Dumbbell", "Resistance band", "Kettlebell", "Rope", "Barbell"],
  basic_gym: null, // everything
  full_gym: null,
};

/**
 * Narrows the exercise library to what the member can do where they mainly train. Joints to
 * protect or a health condition also leave out the high-risk lifts and jumps.
 */
function libraryFilterFor(intake) {
  const allowed = intake.mainEquipment in EQUIPMENT ? EQUIPMENT[intake.mainEquipment] : EQUIPMENT.none;
  const careful = intake.joints.length > 0 || intake.conditions.length > 0;
  return (library) =>
    library.filter((e) => (allowed === null || allowed.includes(e.equipment)) && !(careful && e.highRisk));
}

// Every session keeps at least this many main exercises, whatever the time
const MIN_WORKOUT_EXERCISES = 2;

const daySeconds = (exercises) => exercises.reduce((total, e) => total + workout.exerciseSeconds(e), 0);

/**
 * Fits each day into the member's session length: drops the last workout exercises (the engine
 * lists the main lifts first) until the day fits or only MIN_WORKOUT_EXERCISES are left, then
 * renumbers the order. Warm-up and cool-down stay.
 */
function fitDaysTo(minutes) {
  const limit = minutes * 60;
  return (days) =>
    days.map((day) => {
      const exercises = [...day.exercises];
      const workoutCount = () => exercises.filter((e) => e.section === "workout").length;
      while (daySeconds(exercises) > limit && workoutCount() > MIN_WORKOUT_EXERCISES) {
        const last = exercises.map((e) => e.section).lastIndexOf("workout");
        exercises.splice(last, 1);
      }
      return { ...day, exercises: exercises.map((e, order) => ({ ...e, order })) };
    });
}

// ---- the diet -----------------------------------------------------------------------

const SLOTS = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"];
const DEFAULT_TIME = { breakfast: "08:00", morning_snack: "11:00", lunch: "13:30", evening_snack: "17:00", dinner: "20:30" };
const UNITS = ["g", "ml", "piece", "cup", "bowl", "tbsp", "tsp"];

const limits = { message: 1000, mealName: 120, itemName: 120, note: 300, itemsPerMeal: 8, quantityMax: 10000, kcalMax: 5000, macroMax: 2000 };

// A failure the member can act on: `status` is the HTTP status to answer with
class CoachPlanError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CoachPlanError";
    this.status = status;
  }
}

const clean = (value, max) =>
  // eslint-disable-next-line no-control-regex
  (typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() : "").slice(0, max);
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (value, max) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, round1(value))) : 0);

// Pieces, cups and spoons in halves; grams and ml in whole numbers
const roundQuantity = (quantity, unit) => {
  const rounded = ["g", "ml"].includes(unit) ? Math.round(quantity) : Math.round(quantity * 2) / 2;
  return Math.min(limits.quantityMax, Math.max(unit === "g" || unit === "ml" ? 1 : 0.5, rounded));
};

function totalsOf(items) {
  const sum = items.reduce((t, i) => ({ kcal: t.kcal + i.kcal, proteinG: t.proteinG + i.proteinG, carbsG: t.carbsG + i.carbsG, fatG: t.fatG + i.fatG }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  return { kcal: Math.round(sum.kcal), proteinG: round1(sum.proteinG), carbsG: round1(sum.carbsG), fatG: round1(sum.fatG) };
}

function cleanItem(item) {
  const unit = UNITS.includes(item?.unit) ? item.unit : "piece";
  return {
    name: clean(item?.name, limits.itemName),
    quantity: roundQuantity(Number(item?.quantity) > 0 ? Number(item.quantity) : 1, unit),
    unit,
    kcal: clamp(item?.kcal, limits.kcalMax),
    proteinG: clamp(item?.proteinG, limits.macroMax),
    carbsG: clamp(item?.carbsG, limits.macroMax),
    fatG: clamp(item?.fatG, limits.macroMax),
  };
}

// One portion change: the quantity is rounded to something you can measure, and the calories
// and macros follow the rounded quantity, so a food's numbers always match its portion
function scaleItem(item, factor) {
  const quantity = roundQuantity(item.quantity * factor, item.unit);
  const actual = quantity / item.quantity;
  return {
    ...item,
    quantity,
    kcal: clamp(item.kcal * actual, limits.kcalMax),
    proteinG: clamp(item.proteinG * actual, limits.macroMax),
    carbsG: clamp(item.carbsG * actual, limits.macroMax),
    fatG: clamp(item.fatG * actual, limits.macroMax),
  };
}

// The day may be this far off the calorie target before portions are scaled
const TOLERANCE = 0.08;

/**
 * The model's answer → { message, meals } ready to store: all five slots once each, in order,
 * with clean text, real times and at least one food. When the day's calories are more than 8%
 * off the member's target, every portion is scaled by the same factor (at most halved or
 * doubled). Throws a 502 CoachPlanError when the answer is unusable.
 */
function normalizeDiet(raw, targets) {
  const unusable = () => new CoachPlanError("Your coach couldn't put a meal plan together right now. Please try again.", 502);
  if (!raw || !Array.isArray(raw.meals)) throw unusable();
  const bySlot = new Map();
  for (const meal of raw.meals) {
    if (!SLOTS.includes(meal?.slot) || bySlot.has(meal.slot)) continue;
    const items = (Array.isArray(meal.items) ? meal.items : []).slice(0, limits.itemsPerMeal).map(cleanItem).filter((i) => i.name !== "");
    if (items.length === 0) continue;
    bySlot.set(meal.slot, {
      slot: meal.slot,
      name: clean(meal.name, limits.mealName) || items.map((i) => i.name).join(", ").slice(0, limits.mealName),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(meal.time) ? meal.time : DEFAULT_TIME[meal.slot],
      note: clean(meal.note, limits.note) || null,
      items,
    });
  }
  if (bySlot.size !== SLOTS.length) throw unusable();

  let meals = SLOTS.map((slot) => bySlot.get(slot));
  const dayKcal = totalsOf(meals.flatMap((m) => m.items)).kcal;
  if (dayKcal <= 0) throw unusable();
  const off = targets.calories / dayKcal;
  if (Math.abs(off - 1) > TOLERANCE) {
    const factor = Math.min(2, Math.max(0.5, off));
    meals = meals.map((m) => ({ ...m, items: m.items.map((i) => scaleItem(i, factor)) }));
  }
  const message = clean(raw.message, limits.message) || "Here's your plan. Let's take it one day at a time.";
  return { message, meals };
}

// ---- what the model is told ---------------------------------------------------------

const DIET_LABEL = { vegetarian: "vegetarian (no meat, fish or eggs)", eggetarian: "eggetarian (vegetarian plus eggs; no meat or fish)", vegan: "vegan (no meat, fish, eggs, dairy or honey)", "non-vegetarian": "non-vegetarian" };
const COOKING = { none: "doesn't cook (ready-to-eat, simple assembly, or easily bought food)", quick: "up to 15 minutes a meal", medium: "15 to 30 minutes a meal", long: "happy to cook for over 30 minutes" };
const BUDGET = { low: "low (about ₹100–200 a day on food)", medium: "medium (about ₹200–400 a day)", high: "flexible (₹400+ a day)" };

/**
 * The member's facts the model plans from, as plain lines. Free text from the member (notes,
 * dislikes, allergies) is passed as data, labelled as theirs; it can't change the output shape.
 */
function dietBrief({ intake, profile, targets, coachName, workoutSummary }) {
  const lines = [
    `Coach: ${coachName}, style: ${intake.coachStyle}.`,
    `Daily targets: ${targets.calories} kcal, protein ${targets.proteinG} g, carbs ${targets.carbsG} g, fat ${targets.fatG} g.`,
    `Goal: ${intake.goal.replace(/_/g, " ")}.`,
    `Diet: ${DIET_LABEL[profile.diet] ?? "not given (assume vegetarian)"}.`,
    profile.cuisines?.length ? `Cuisines they like: ${profile.cuisines.join(", ")}.` : null,
    profile.allergies ? `Allergies (never include): ${profile.allergies}` : null,
    profile.dislikes ? `Dislikes (avoid): ${profile.dislikes}` : null,
    `Cooking time: ${COOKING[intake.cookingTime]}.`,
    `Food budget: ${BUDGET[intake.foodBudget]}.`,
    intake.conditions.length ? `Health conditions: ${intake.conditions.join(", ").replace(/_/g, " ")}.` : null,
    workoutSummary ? `Their workout: ${workoutSummary}.` : null,
    intake.planNotes ? `The member's own note: ${intake.planNotes}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

const DIET_INSTRUCTIONS = `You are an AI fitness coach in an Indian fitness app, writing one day of meals for a member.

Rules:
- Plan exactly five meals: breakfast, morning_snack, lunch, evening_snack, dinner. Give each a short name, a time as HH:MM (24-hour), and 1 to 6 foods.
- Use everyday Indian foods and home recipes that fit the member's diet, cuisines, cooking time and budget. Never include anything from their allergies, and respect the diet type strictly.
- Portions: quantity plus a unit from g, ml, piece, cup, bowl, tbsp, tsp. Give kcal, protein, carbs and fat in grams for that portion, using typical Indian recipes.
- The day should total close to the calorie target, and reach the protein target.
- With diabetes, prefer whole grains, dals and vegetables and avoid sugary foods; with high BP, keep salt and pickles low; with PCOS or thyroid, keep meals balanced and whole-food based.
- A meal's note is optional: one short practical tip (prep, swap or timing), or "".
- message: 2 to 4 sentences from the coach in their style, in simple English, about how the meals and the workout fit the member's goal. No medical claims, no promises of results, no mention of AI, models or prompts.`;

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string", enum: UNITS },
    kcal: { type: "number" },
    proteinG: { type: "number" },
    carbsG: { type: "number" },
    fatG: { type: "number" },
  },
  required: ["name", "quantity", "unit", "kcal", "proteinG", "carbsG", "fatG"],
};

const dietSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    meals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slot: { type: "string", enum: SLOTS },
          name: { type: "string" },
          time: { type: "string" },
          note: { type: "string" },
          items: { type: "array", items: ITEM_SCHEMA },
        },
        required: ["slot", "name", "time", "note", "items"],
      },
    },
  },
  required: ["message", "meals"],
};

// A fixed vegetarian day for tests: never calls OpenAI (about 1,600 kcal before scaling)
const FAKE_DIET = {
  message: "Here's a simple day built around your goal. Eat your protein first at each meal, and we'll adjust after your first week.",
  meals: [
    { slot: "breakfast", name: "Moong dal chilla", time: "08:00", note: "Make the batter the night before.", items: [
      { name: "Moong dal chilla", quantity: 2, unit: "piece", kcal: 240, proteinG: 14, carbsG: 30, fatG: 6 },
      { name: "Curd", quantity: 100, unit: "g", kcal: 60, proteinG: 3.5, carbsG: 4.5, fatG: 3 },
    ] },
    { slot: "morning_snack", name: "Fruit and nuts", time: "11:00", note: "", items: [
      { name: "Banana", quantity: 1, unit: "piece", kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
      { name: "Roasted chana", quantity: 30, unit: "g", kcal: 110, proteinG: 6, carbsG: 17, fatG: 2 },
    ] },
    { slot: "lunch", name: "Dal, rice and sabzi", time: "13:30", note: "", items: [
      { name: "Dal tadka", quantity: 1, unit: "bowl", kcal: 180, proteinG: 9, carbsG: 22, fatG: 6 },
      { name: "Rice", quantity: 150, unit: "g", kcal: 195, proteinG: 4, carbsG: 42, fatG: 0.5 },
      { name: "Mixed veg sabzi", quantity: 1, unit: "bowl", kcal: 120, proteinG: 3, carbsG: 12, fatG: 7 },
    ] },
    { slot: "evening_snack", name: "Sprouts chaat", time: "17:00", note: "", items: [
      { name: "Sprouts chaat", quantity: 1, unit: "bowl", kcal: 150, proteinG: 9, carbsG: 22, fatG: 2 },
    ] },
    { slot: "dinner", name: "Paneer bhurji and roti", time: "20:30", note: "", items: [
      { name: "Paneer bhurji", quantity: 100, unit: "g", kcal: 260, proteinG: 15, carbsG: 6, fatG: 20 },
      { name: "Roti", quantity: 2, unit: "piece", kcal: 200, proteinG: 6, carbsG: 36, fatG: 4 },
    ] },
  ],
};

module.exports = {
  FAKE_DIET, SLOTS, limits, CoachPlanError,
  engineGoalFor, engineLevelFor, libraryFilterFor, fitDaysTo,
  totalsOf, normalizeDiet, dietBrief, DIET_INSTRUCTIONS, dietSchema,
};
