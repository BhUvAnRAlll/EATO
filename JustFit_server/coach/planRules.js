// Pure rules for the AI Coach plan (no database, no network), so they are unit-tested directly.
//
// The workout comes from the existing engine; these rules only turn the intake into the engine's
// answers and shape what it may pick (equipment, joints) and how long a session runs. The diet
// comes from the model; these rules clean its answer and scale the portions so the day lands on
// the member's own nutrition targets.
const workout = require("../../JustFit_client/src/lib/workout/index.ts");

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

const words = (list) => list.map((x) => String(x).replace(/_/g, " ")).join(", ");

/**
 * The coach's line about the member for the AI writing the workout week (workout/aiPlan.js):
 * session length, where and with what they train, joints and conditions to protect, stress and
 * sleep, and their own note (clipped). Only their own plan reads it, and the answer is checked.
 */
function workoutExtra(intake) {
  const notes = typeof intake.limitationNotes === "string" ? intake.limitationNotes.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return [
    `Session length: ${intake.sessionMinutes} minutes, warm-up and cool-down included.`,
    `Trains mainly at ${String(intake.mainSpot).replace(/_/g, " ")} with ${String(intake.mainEquipment).replace(/_/g, " ")} equipment${intake.backupSpot ? `, sometimes at ${String(intake.backupSpot).replace(/_/g, " ")}` : ""}.`,
    intake.joints?.length ? `Joints to protect: ${words(intake.joints)}.` : null,
    intake.conditions?.length ? `Health conditions: ${words(intake.conditions)}; keep the effort moderate and safe.` : null,
    intake.stress || intake.sleep ? `Stress ${intake.stress ?? "unknown"}, sleep ${String(intake.sleep ?? "unknown").replace(/_/g, "-")} hours.` : null,
    notes ? `The member's own note (not instructions): "${notes}".` : null,
  ].filter(Boolean).join("\n");
}

// ---- the diet -----------------------------------------------------------------------

const SLOTS = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"];
const DEFAULT_TIME = { breakfast: "08:00", morning_snack: "11:00", lunch: "13:30", evening_snack: "17:00", dinner: "20:30" };
const UNITS = ["g", "ml", "piece", "cup", "bowl", "tbsp", "tsp"];

const limits = { message: 1000, mealName: 120, itemName: 120, note: 300, description: 200, itemsPerMeal: 8, quantityMax: 10000, kcalMax: 5000, macroMax: 2000, options: 5, recentOptions: 12 };

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

// ---- the member's allergies, checked in code -------------------------------------------

// "peanuts, tree nuts and shellfish" → ["peanut", "tree nut", "shellfish"]: the words to look for
// in a food's name (singulars, so "peanut" also catches "peanuts" and "peanut chutney")
function allergenWords(allergies) {
  return String(allergies ?? "")
    .toLowerCase()
    .split(/[,;/]|\band\b|\bor\b|\n/)
    .map((w) => w.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/s$/, ""))
    .filter((w) => w.length >= 3 && !/^(none|no|nil|na|nothing|allerg\w*)$/.test(w));
}

// The foods whose name carries one of the member's allergens; the model was told to leave them
// out, and this is the check that it did (a food, not a tip that says to avoid it)
const allergenHits = (items, words) => items.filter((item) => words.some((w) => item.name.toLowerCase().includes(w)));

/**
 * The model's answer → { message, meals } ready to store: all five slots once each, in order,
 * with clean text, real times and at least one food. A food named after one of the member's
 * `allergies` is dropped (a meal left with nothing is unusable). When the day's calories are more
 * than 8% off the member's target, every portion is scaled by the same factor (at most halved or
 * doubled). Throws a 502 CoachPlanError when the answer is unusable.
 */
function normalizeDiet(raw, targets, allergies = "") {
  const unusable = () => new CoachPlanError("Your coach couldn't put a meal plan together right now. Please try again.", 502);
  if (!raw || !Array.isArray(raw.meals)) throw unusable();
  const allergens = allergenWords(allergies);
  const bySlot = new Map();
  for (const meal of raw.meals) {
    if (!SLOTS.includes(meal?.slot) || bySlot.has(meal.slot)) continue;
    const cleaned = (Array.isArray(meal.items) ? meal.items : []).slice(0, limits.itemsPerMeal).map(cleanItem).filter((i) => i.name !== "");
    const unsafe = allergenHits(cleaned, allergens);
    const items = cleaned.filter((i) => !unsafe.includes(i));
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

// How an Indian coach plans food (AGENTS.md "AI Coach: Indian fitness personalisation"), shared by
// the day plan, the swap and the options so the three never drift apart
const INDIAN_FOOD = `- Plan like an experienced Indian coach: everyday Indian home food that fits the member's diet, cuisines, cooking time and budget (regional dishes such as idli, dosa, poha, upma, roti, rice, dal, sambar, rasam, curd, paneer, sabzi, eggs, chicken or fish curry as their diet allows), with affordable ingredients from a local market. Don't default to oats, salads, smoothies or Western foods unless their cuisines include them. Never include anything from their allergies, and respect the diet type strictly; assume nothing about religion or region beyond what they told you.`;

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
${INDIAN_FOOD}
- Portions: quantity plus a unit from g, ml, piece, cup, bowl, tbsp, tsp. Give kcal, protein, carbs and fat in grams for that portion, worked out from the dish's real ingredients as typically cooked at home (oil, ghee and coconut included).
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

// ---- swapping one meal ----------------------------------------------------------------

const SLOT_LABEL = { breakfast: "breakfast", morning_snack: "morning snack", lunch: "lunch", evening_snack: "evening snack", dinner: "dinner" };

/**
 * The brief for replacing one meal: the member's food facts (never the whole plan or intake) and
 * the meal to replace with its numbers, so the new one lands in the same place.
 */
function mealBrief({ profile, intake, meal }) {
  const lines = [
    `Diet: ${DIET_LABEL[profile.diet] ?? "not given (assume vegetarian)"}.`,
    profile.cuisines?.length ? `Cuisines they like: ${profile.cuisines.join(", ")}.` : null,
    profile.allergies ? `Allergies (never include): ${profile.allergies}` : null,
    profile.dislikes ? `Dislikes (avoid): ${profile.dislikes}` : null,
    `Cooking time: ${COOKING[intake.cookingTime]}.`,
    `Food budget: ${BUDGET[intake.foodBudget]}.`,
    intake.conditions.length ? `Health conditions: ${intake.conditions.join(", ").replace(/_/g, " ")}.` : null,
    `Replace this ${SLOT_LABEL[meal.slot]}: "${meal.name}" (${meal.totals.kcal} kcal, protein ${meal.totals.proteinG} g, carbs ${meal.totals.carbsG} g, fat ${meal.totals.fatG} g; ${meal.items.map((i) => i.name).join(", ")}).`,
    "Give a different dish with about the same calories and protein.",
  ];
  return lines.filter(Boolean).join("\n");
}

const MEAL_INSTRUCTIONS = `You are an AI fitness coach in an Indian fitness app, replacing one meal in a member's day.

Rules:
- Write one meal with a short name and 1 to 6 foods, different from the meal being replaced.
${INDIAN_FOOD}
- Portions: quantity plus a unit from g, ml, piece, cup, bowl, tbsp, tsp. Give kcal, protein, carbs and fat in grams for that portion, worked out from the dish's real ingredients as typically cooked at home (oil, ghee and coconut included).
- Keep the calories within 10% of the meal being replaced and the protein at least as high.
- With diabetes, prefer whole grains, dals and vegetables and avoid sugary foods; with high BP, keep salt and pickles low; with PCOS or thyroid, keep meals balanced and whole-food based.
- note: one short practical tip, or "".`;

const mealSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    note: { type: "string" },
    items: { type: "array", items: ITEM_SCHEMA },
  },
  required: ["name", "note", "items"],
};

/**
 * The model's replacement meal → { name, note, items } for the same slot and time, cleaned like a
 * plan meal and scaled so its calories match `targetKcal` (the meal it replaces, unless the day
 * has less room; within the same 8% tolerance, at most halved or doubled). Throws a 502
 * CoachPlanError when the answer is unusable.
 */
function normalizeMeal(raw, replaced, allergies = "", targetKcal = replaced.totals.kcal) {
  const unusable = () => new CoachPlanError("Your coach couldn't find a swap for that meal right now. Please try again.", 502);
  if (!raw || !Array.isArray(raw.items)) throw unusable();
  const allergens = allergenWords(allergies);
  let items = raw.items.slice(0, limits.itemsPerMeal).map(cleanItem).filter((i) => i.name !== "");
  items = items.filter((i) => !allergenHits([i], allergens).length);
  if (items.length === 0) throw unusable();
  const kcal = totalsOf(items).kcal;
  if (kcal <= 0) throw unusable();
  const off = targetKcal / kcal;
  if (targetKcal > 0 && Math.abs(off - 1) > TOLERANCE) {
    const factor = Math.min(2, Math.max(0.5, off));
    items = items.map((i) => scaleItem(i, factor));
  }
  return {
    name: clean(raw.name, limits.mealName) || items.map((i) => i.name).join(", ").slice(0, limits.mealName),
    note: clean(raw.note, limits.note) || null,
    items,
  };
}

// A fixed replacement for tests: never calls OpenAI
const FAKE_MEAL = {
  name: "Vegetable poha",
  note: "Add peanuts for extra protein.",
  items: [
    { name: "Vegetable poha", quantity: 1, unit: "bowl", kcal: 250, proteinG: 6, carbsG: 45, fatG: 6 },
    { name: "Buttermilk", quantity: 200, unit: "ml", kcal: 60, proteinG: 3, carbsG: 5, fatG: 2 },
  ],
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

// ---- Swap Meal: three options for one meal, personal to the member and the day -----------

// "Rajma Chawal!" and "rajma chawal" are the same dish
const dishKey = (name) => String(name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// What the day still has room for: the targets less what the diary already holds. The meal being
// replaced is given back when it was logged today, so the swap doesn't count against itself.
function remainingFor(targets, eaten, loggedMeal = null) {
  const back = loggedMeal ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  return {
    kcal: Math.round(targets.calories - eaten.kcal + back.kcal),
    proteinG: round1(targets.proteinG - eaten.proteinG + back.proteinG),
    carbsG: round1(targets.carbsG - eaten.carbsG + back.carbsG),
    fatG: round1(targets.fatG - eaten.fatG + back.fatG),
  };
}

// How the member can steer the options (the chips on the Swap Meal screen), and what each tells the model
const PREFERENCE = {
  lighter: "lighter: about a quarter fewer calories than the meal being replaced, high in fibre, still filling",
  more_protein: "more protein: as much protein as the foods allow, at the same calories",
  different_cuisine: "a different cuisine from the meal being replaced (another Indian region, or a simple continental or Asian dish that fits their diet)",
  quick: "quick to make: ready in 10 minutes, or needs no cooking",
};
const PREFERENCES = Object.keys(PREFERENCE);

// The calories an option should land on: the meal it replaces (a quarter less for "lighter"),
// unless the day has less room than that, then what's left (never below half the meal, so a
// snack doesn't turn into a crumb)
function optionTargetKcal(replacedKcal, remainingKcal, preference = null) {
  const base = preference === "lighter" ? Math.round(replacedKcal * 0.75) : replacedKcal;
  if (remainingKcal > 0 && remainingKcal < base) return Math.max(Math.round(replacedKcal / 2), remainingKcal);
  return base;
}

// A stored option's foods with the member's portions: `quantities` has one number per food (0
// leaves it out); each kept food's calories and macros follow its new portion (scaleItem). The
// caller checks the lengths match and that something is left.
function editedItems(items, quantities) {
  return items.flatMap((item, i) => (quantities[i] > 0 ? [scaleItem(item, quantities[i] / item.quantity)] : []));
}

const GOAL_LINE = {
  fat_loss: "fat loss: filling, high-fibre, high-protein meals that keep calories in check",
  muscle_gain: "muscle gain: protein first in every meal",
  maintenance: "maintenance: balanced meals",
  healthy_eating: "healthy eating: balanced, whole-food meals",
  strength: "strength: protein first in every meal",
  endurance: "endurance: enough carbs around training, protein at every meal",
  general_fitness: "general fitness: balanced meals",
};

/**
 * The brief for the options: the member's goal, diet and food facts, their targets and what's left
 * of the day, the meal being replaced and the dishes not to repeat. Free text from the member is
 * passed as data, labelled as theirs.
 */
function optionsBrief({ profile, intake, targets, remaining, meal, targetKcal, exclude = [], preference = null }) {
  const left = remaining.kcal > 0
    ? `Left for today: ${remaining.kcal} kcal, protein ${Math.max(0, remaining.proteinG)} g, carbs ${Math.max(0, remaining.carbsG)} g, fat ${Math.max(0, remaining.fatG)} g.`
    : `Today's calories are already used up (over by ${Math.abs(remaining.kcal)} kcal): keep the options light.`;
  const lines = [
    `Goal: ${GOAL_LINE[intake.goal] ?? String(intake.goal ?? "").replace(/_/g, " ")}.`,
    `Diet: ${DIET_LABEL[profile.diet] ?? "not given (assume vegetarian)"}.`,
    `Daily targets: ${targets.calories} kcal, protein ${targets.proteinG} g, carbs ${targets.carbsG} g, fat ${targets.fatG} g.`,
    left,
    profile.cuisines?.length ? `Cuisines they like: ${profile.cuisines.join(", ")}.` : null,
    profile.allergies ? `Allergies (never include): ${profile.allergies}` : null,
    profile.dislikes ? `Dislikes (avoid): ${profile.dislikes}` : null,
    `Cooking time: ${COOKING[intake.cookingTime]}.`,
    `Food budget: ${BUDGET[intake.foodBudget]}.`,
    intake.conditions.length ? `Health conditions: ${intake.conditions.join(", ").replace(/_/g, " ")}.` : null,
    `Replace this ${SLOT_LABEL[meal.slot]}: "${meal.name}" (${meal.totals.kcal} kcal, protein ${meal.totals.proteinG} g, carbs ${meal.totals.carbsG} g, fat ${meal.totals.fatG} g; ${meal.items.map((i) => i.name).join(", ")}).`,
    `Aim for about ${targetKcal} kcal each, with at least ${Math.round(meal.totals.proteinG)} g protein.`,
    PREFERENCE[preference] ? `The member asked for ${PREFERENCE[preference]}.` : null,
    exclude.length ? `Don't suggest these again: ${exclude.slice(0, limits.recentOptions).join("; ")}.` : null,
    `Give ${limits.options} different ${SLOT_LABEL[meal.slot]} options.`,
  ];
  return lines.filter(Boolean).join("\n");
}

const OPTIONS_INSTRUCTIONS = `You are an AI fitness coach in an Indian fitness app, offering a member five dishes they could have instead of one meal in their day.

Rules:
- Give exactly five options, each a different kind of dish from the others, from the meal being replaced and from the dishes marked not to suggest again. When the member asked for something (lighter, more protein, a different cuisine, quick), every option follows it.
- Each option: a short name, a description of one sentence (at most 20 words) saying why it fits the member's goal and the day, 1 to 6 foods, and a note.
${INDIAN_FOOD}
- Portions: quantity plus a unit from g, ml, piece, cup, bowl, tbsp, tsp. Give kcal, protein, carbs and fat in grams for that portion, worked out from the dish's real ingredients as typically cooked at home (oil, ghee and coconut included).
- Land each option close to the calories asked for and reach the protein asked for; never go past what is left for the day.
- With diabetes, prefer whole grains, dals and vegetables and avoid sugary foods; with high BP, keep salt and pickles low; with PCOS or thyroid, keep meals balanced and whole-food based.
- note: one short practical tip, or "". No medical claims, no mention of AI, models or prompts.`;

const optionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          note: { type: "string" },
          items: { type: "array", items: ITEM_SCHEMA },
        },
        required: ["name", "description", "note", "items"],
      },
    },
  },
  required: ["options"],
};

const OPTIONS_FAILURE = "Your coach couldn't find options for that meal right now. Please try again.";

/**
 * The model's options → up to five { name, description, note, items } for the meal's slot: each
 * cleaned and scaled like a swap (to `targetKcal`), without the member's allergens, never the
 * meal itself and no dish twice. Dishes in `exclude` (offered recently) come last, and only when
 * the model had nothing new: a repeat beats an empty screen. An option that comes out unusable is
 * dropped; throws a 502 CoachPlanError when none is left.
 */
function normalizeOptions(raw, replaced, allergies = "", { targetKcal = replaced.totals.kcal, exclude = [] } = {}) {
  if (!raw || !Array.isArray(raw.options)) throw new CoachPlanError(OPTIONS_FAILURE, 502);
  const self = dishKey(replaced.name);
  const recent = new Set(exclude.map(dishKey).filter((key) => key && key !== self));
  const seen = new Set();
  const fresh = [];
  const repeats = [];
  for (const candidate of raw.options.slice(0, limits.options * 2)) {
    let meal;
    try {
      meal = normalizeMeal(candidate, replaced, allergies, targetKcal);
    } catch (error) {
      if (error instanceof CoachPlanError) continue;
      throw error;
    }
    const key = dishKey(meal.name);
    if (!key || key === self || seen.has(key)) continue;
    seen.add(key);
    (recent.has(key) ? repeats : fresh).push({ ...meal, description: clean(candidate?.description, limits.description) || null });
  }
  const options = [...fresh, ...repeats].slice(0, limits.options);
  if (options.length === 0) throw new CoachPlanError(OPTIONS_FAILURE, 502);
  return options;
}

// A stored option's foods (JSON from coach_meal_options) → clean items again before they go into
// the plan, so a row can never put anything unchecked in a meal
function storedItems(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const items = (Array.isArray(parsed) ? parsed : []).slice(0, limits.itemsPerMeal).map(cleanItem).filter((i) => i.name !== "");
  if (items.length === 0) throw new CoachPlanError("That option isn't available any more. Ask for options again.", 502);
  return items;
}

// Fixed options for tests (five usable): never calls OpenAI. The first carries a peanut food, so a
// member allergic to peanuts proves the filter; the third repeats the second's dish to prove the dedupe.
const FAKE_OPTIONS = {
  options: [
    { name: "Paneer tikka wrap", description: "Protein-rich and quick, so it keeps you full on a training day.", note: "Grill the paneer the night before.", items: [
      { name: "Paneer tikka wrap", quantity: 1, unit: "piece", kcal: 330, proteinG: 18, carbsG: 34, fatG: 13 },
      { name: "Peanut chutney", quantity: 1, unit: "tbsp", kcal: 45, proteinG: 2, carbsG: 2, fatG: 4 },
    ] },
    { name: "Rajma chawal", description: "Slow-release carbs and plant protein that fit your targets.", note: "", items: [
      { name: "Rajma", quantity: 1, unit: "bowl", kcal: 230, proteinG: 13, carbsG: 36, fatG: 4 },
      { name: "Rice", quantity: 120, unit: "g", kcal: 156, proteinG: 3, carbsG: 34, fatG: 0.4 },
    ] },
    { name: "Rajma Chawal", description: "A repeat, to be dropped.", note: "", items: [
      { name: "Rajma", quantity: 1, unit: "bowl", kcal: 230, proteinG: 13, carbsG: 36, fatG: 4 },
    ] },
    { name: "Curd rice with vegetables", description: "Light and cooling, with probiotics and steady energy.", note: "Add a handful of pomegranate.", items: [
      { name: "Curd rice", quantity: 1, unit: "bowl", kcal: 280, proteinG: 9, carbsG: 44, fatG: 7 },
      { name: "Cucumber and carrot salad", quantity: 1, unit: "cup", kcal: 40, proteinG: 1, carbsG: 8, fatG: 0.2 },
    ] },
    { name: "Moong dal khichdi", description: "One-pot comfort food with dal protein and easy digestion.", note: "A spoon of ghee on top helps you stay full.", items: [
      { name: "Moong dal khichdi", quantity: 1, unit: "bowl", kcal: 310, proteinG: 14, carbsG: 48, fatG: 7 },
      { name: "Curd", quantity: 100, unit: "g", kcal: 60, proteinG: 3.5, carbsG: 4.5, fatG: 3 },
    ] },
    { name: "Vegetable upma and sambar", description: "Quick South Indian plate with vegetables and lentil protein.", note: "", items: [
      { name: "Vegetable upma", quantity: 1, unit: "bowl", kcal: 260, proteinG: 10, carbsG: 42, fatG: 7 },
      { name: "Sambar", quantity: 1, unit: "cup", kcal: 120, proteinG: 6, carbsG: 16, fatG: 3 },
    ] },
  ],
};

// Where a plan meal lands in the Macro diary: both snacks share the diary's one snack slot
const DIARY_SLOT = { breakfast: "breakfast", morning_snack: "snack", lunch: "lunch", evening_snack: "snack", dinner: "dinner" };
const diarySlotFor = (planSlot) => DIARY_SLOT[planSlot];

// The diary key that makes logging a plan meal once a day: `date:mealId:n`, unique per member
const planLogKey = (date, mealId, n = 1) => `${date}:${mealId}:${n}`;

module.exports = {
  diarySlotFor, planLogKey,
  FAKE_DIET, SLOTS, limits, CoachPlanError,
  EQUIPMENT, engineGoalFor, engineLevelFor, libraryFilterFor, fitDaysTo, workoutExtra,
  INDIAN_FOOD, COOKING, BUDGET,
  totalsOf, normalizeDiet, dietBrief, DIET_INSTRUCTIONS, dietSchema,
  mealBrief, MEAL_INSTRUCTIONS, mealSchema, normalizeMeal, FAKE_MEAL,
  PREFERENCES, remainingFor, optionTargetKcal, editedItems, optionsBrief, OPTIONS_INSTRUCTIONS, OPTIONS_FAILURE, optionsSchema, normalizeOptions, storedItems, FAKE_OPTIONS, dishKey,
  allergenWords, allergenHits,
};
