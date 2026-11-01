// The AI Coach plan: the workout week (written by the model from the exercise library and the
// intake, workout/aiPlan.js, with the engine as the fallback) and one day of meals (written by the
// model, cleaned and scaled to the member's targets in planRules.js). The two calls run at once.
//
// Every query is scoped to the verified member id passed in by the route. In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed day of meals is
// used instead of calling OpenAI.
//
// Cost: the model comes from ai/models.js, the whole day is one structured call, one meal can be
// swapped on its own (a much smaller call) instead of remaking the day, the daily plan limit is
// checked first (ai/limits.js) and two requests for the same member at once make one plan.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const diary = require("../macro/diary");
const workoutPlans = require("../workout/plans");
const rules = require("./planRules");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");
const { askStructured } = require("../ai/structured");

const COACH_NAMES = { arjun: "Arjun", priya: "Priya", rohan: "Rohan", meera: "Meera", aditya: "Aditya" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);

// A coach_profiles row → the intake answers
function toIntake(row) {
  return {
    goal: row.goal,
    experience: row.experience,
    currentlyTraining: Boolean(row.currently_training),
    weekdays: json(row.weekdays),
    sessionMinutes: row.session_minutes,
    mainSpot: row.main_spot,
    backupSpot: row.backup_spot,
    mainEquipment: row.main_equipment,
    backupEquipment: row.backup_equipment,
    joints: json(row.joints),
    conditions: json(row.conditions),
    limitationNotes: row.limitation_notes,
    cookingTime: row.cooking_time,
    foodBudget: row.food_budget,
    stress: row.stress,
    sleep: row.sleep,
    coach: row.coach,
    coachStyle: row.coach_style,
    planNotes: row.plan_notes,
    updatedAt: row.updated_at,
  };
}

// ---- asking the model (ai/structured.js) ------------------------------------------------

const PLAN_FAILURE = "Your coach couldn't put a meal plan together right now. Please try again.";
const askForDiet = (brief, env, usage) =>
  askStructured({ feature: "coach_plan", instructions: rules.DIET_INSTRUCTIONS, brief, schema: rules.dietSchema, fake: rules.FAKE_DIET, failure: PLAN_FAILURE }, env, usage);

// ---- making the plan ----------------------------------------------------------------

async function memberFacts(pool, userId) {
  const [[intakeRow]] = await pool.query("SELECT * FROM coach_profiles WHERE user_id = ?", [userId]);
  if (!intakeRow) throw new ValidationError("Answer your coach's questions first.");
  const [[profile]] = await pool.query("SELECT diet, cuisines, dislikes, allergies FROM profiles WHERE user_id = ?", [userId]);
  const [[targets]] = await pool.query("SELECT calories, protein_g, carbs_g, fat_g FROM nutrition_targets WHERE user_id = ?", [userId]);
  if (!profile || !targets) throw new ValidationError("Finish your profile first, so your coach knows your targets.");
  return {
    intake: toIntake(intakeRow),
    profile: { diet: profile.diet, cuisines: json(profile.cuisines) ?? [], dislikes: profile.dislikes, allergies: profile.allergies },
    targets: { calories: targets.calories, proteinG: targets.protein_g, carbsG: targets.carbs_g, fatG: targets.fat_g },
  };
}

/**
 * Makes a new coach plan and makes it the active one: asks the model for the meals first (the
 * slow part, outside any transaction), then in one transaction with the member locked writes the
 * engine's workout and the meals. The previous coach plan is kept as superseded.
 */
async function makePlan(pool, userId, { today }, env = process.env) {
  const { intake, profile, targets } = await memberFacts(pool, userId);
  await aiLimits.check(pool, { feature: "coach_plan", userId }, env);
  // Two requests for the same member at once (two screens, a double tap) make one plan, not two
  return dedupe.shared.run(dedupe.requestKey("coach_plan", userId), () => buildPlan(pool, userId, { today, intake, profile, targets }, env));
}

async function buildPlan(pool, userId, { today, intake, profile, targets }, env) {
  const coachName = COACH_NAMES[intake.coach];
  const days = intake.weekdays.map((d) => WEEKDAY[d]).join(", ");
  const workoutSummary = `${intake.weekdays.length} days a week (${days}), ${intake.sessionMinutes} minutes, mainly at ${intake.mainSpot}`;
  const usage = aiUsage.tracker(pool, { feature: "coach_plan", userId });
  // The meals and the workout week are asked for at the same time (both are slow)
  const [rawDiet, workoutDraft] = await Promise.all([
    askForDiet(rules.dietBrief({ intake, profile, targets, coachName, workoutSummary }), env, usage),
    draftWorkout(pool, userId, today, intake, env),
  ]);
  const diet = rules.normalizeDiet(rawDiet, targets, profile.allergies);

  const planId = await workoutPlans.withMemberLock(pool, userId, async (conn) => {
    const { planId: workoutPlanId } = await workoutPlans.planFromCoach(conn, userId, { ...workoutDraft.facts, today, prepared: workoutDraft.prepared });

    await conn.query("UPDATE coach_plans SET status = 'superseded' WHERE user_id = ? AND status = 'active'", [userId]);
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    await conn.query(
      "INSERT INTO coach_plans (id, user_id, coach, message, workout_plan_id, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, userId, intake.coach, diet.message, workoutPlanId, targets.calories, targets.proteinG, targets.carbsG, targets.fatG],
    );
    for (const [position, meal] of diet.meals.entries()) {
      const [[{ id: mealId }]] = await conn.query("SELECT UUID() AS id");
      await conn.query(
        "INSERT INTO coach_plan_meals (id, plan_id, user_id, slot, name, meal_time, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [mealId, id, userId, meal.slot, meal.name, meal.time, meal.note, position],
      );
      await conn.query(
        "INSERT INTO coach_plan_meal_items (meal_id, plan_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES ?",
        [meal.items.map((it, i) => [mealId, id, userId, i, it.name, it.quantity, it.unit, it.kcal, it.proteinG, it.carbsG, it.fatG])],
      );
    }
    return id;
  });
  return planId;
}

/**
 * The coach's workout week for these intake answers, drafted before any lock (the AI call): the
 * engine goal and level, the training days, and the coach's shape (equipment, joints, session
 * length, and its line for the AI).
 */
async function draftWorkout(pool, userId, today, intake, env) {
  const facts = { goal: rules.engineGoalFor(intake.goal), level: rules.engineLevelFor(intake.experience), weekdays: intake.weekdays };
  const shape = { library: rules.libraryFilterFor(intake), days: rules.fitDaysTo(intake.sessionMinutes), extra: rules.workoutExtra(intake) };
  try {
    return { facts, prepared: await workoutPlans.draftFromCoach(pool, userId, { ...facts, today, shape }, env) };
  } catch (error) {
    // The engine needs the body facts from setup (gender, age, height, weight)
    if (error?.name === "PlanInputError") throw new ValidationError("Finish your profile first, so your coach knows your targets.");
    throw error;
  }
}

// ---- reading it back ----------------------------------------------------------------

const itemToApi = (row) => ({
  name: row.name, quantity: Number(row.quantity), unit: row.unit,
  kcal: Number(row.kcal), proteinG: Number(row.protein_g), carbsG: Number(row.carbs_g), fatG: Number(row.fat_g),
});

async function activeCoachPlan(pool, userId) {
  const [[plan]] = await pool.query(
    "SELECT id, coach, message, calories, protein_g, carbs_g, fat_g, created_at FROM coach_plans WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  if (!plan) return null;
  const [meals] = await pool.query(
    "SELECT id, slot, name, TIME_FORMAT(meal_time, '%H:%i') AS time, note FROM coach_plan_meals WHERE plan_id = ? AND user_id = ? ORDER BY position",
    [plan.id, userId],
  );
  const [items] = await pool.query(
    "SELECT meal_id, name, quantity, unit, kcal, protein_g, carbs_g, fat_g FROM coach_plan_meal_items WHERE plan_id = ? AND user_id = ? ORDER BY meal_id, position",
    [plan.id, userId],
  );
  return {
    id: plan.id,
    coach: plan.coach,
    message: plan.message,
    createdAt: new Date(plan.created_at).toISOString(),
    targets: { calories: plan.calories, proteinG: plan.protein_g, carbsG: plan.carbs_g, fatG: plan.fat_g },
    meals: meals.map((m) => {
      const mine = items.filter((i) => i.meal_id === m.id).map(itemToApi);
      return { id: m.id, slot: m.slot, name: m.name, time: m.time, note: m.note, items: mine, totals: rules.totalsOf(mine) };
    }),
  };
}

/**
 * What the Coach tab shows: `none` (no plan yet) or `ready` with the meals, how often each was logged on `date`, and the workout's sessions.
 */
async function getPlan(pool, userId, { date }) {
  const plan = await activeCoachPlan(pool, userId);
  if (!plan) return { state: "none", plan: null, workout: null };
  const [logs] = await pool.query(
    "SELECT plan_log_key FROM macro_meal_logs WHERE user_id = ? AND log_date = ? AND source = 'plan'",
    [userId, date],
  );
  const meals = plan.meals.map((meal) => ({ ...meal, logged: logs.some((l) => String(l.plan_log_key).startsWith(`${date}:${meal.id}:`)) }));
  const active = await workoutPlans.activePlanRow(pool, userId);
  const overview = active ? await workoutPlans.planOverview(pool, userId) : null;
  const workout = overview
    ? { level: overview.level, daysPerWeek: overview.daysPerWeek, sessions: overview.sessions.map((s) => ({ weekday: s.weekday, title: s.title, minutes: s.minutes, exerciseCount: s.exerciseCount })) }
    : null;
  return {
    state: "ready",
    plan: { ...plan, meals, totals: rules.totalsOf(meals.flatMap((m) => m.items)) },
    workout,
  };
}

/**
 * Replaces one meal of the active plan with a new dish from the model (the same slot, time and
 * about the same calories), without touching the other four meals or the workout. A fraction of
 * a plan's cost: the model is told only the member's food facts and the meal being replaced.
 */
async function swapMeal(pool, userId, mealId, env = process.env) {
  const plan = await activeCoachPlan(pool, userId);
  const meal = plan?.meals.find((m) => m.id === mealId);
  if (!meal) throw new NotFoundError("That meal isn't in your plan.");
  const { intake, profile } = await memberFacts(pool, userId);
  await aiLimits.check(pool, { feature: "coach_meal", userId }, env);
  return dedupe.shared.run(dedupe.requestKey("coach_meal", userId, mealId), async () => {
    const usage = aiUsage.tracker(pool, { feature: "coach_meal", userId });
    const raw = await askStructured(
      { feature: "coach_meal", instructions: rules.MEAL_INSTRUCTIONS, brief: rules.mealBrief({ profile, intake, meal }), schema: rules.mealSchema, fake: rules.FAKE_MEAL, failure: "Your coach couldn't find a swap for that meal right now. Please try again." },
      env,
      usage,
    );
    const next = rules.normalizeMeal(raw, meal, profile.allergies);
    await workoutPlans.withMemberLock(pool, userId, async (conn) => {
      const [result] = await conn.query("UPDATE coach_plan_meals SET name = ?, note = ? WHERE id = ? AND plan_id = ? AND user_id = ?", [next.name, next.note, meal.id, plan.id, userId]);
      if (result.affectedRows === 0) throw new NotFoundError("That meal isn't in your plan.");
      await conn.query("DELETE FROM coach_plan_meal_items WHERE meal_id = ? AND user_id = ?", [meal.id, userId]);
      await conn.query(
        "INSERT INTO coach_plan_meal_items (meal_id, plan_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES ?",
        [next.items.map((it, i) => [meal.id, plan.id, userId, i, it.name, it.quantity, it.unit, it.kcal, it.proteinG, it.carbsG, it.fatG])],
      );
    });
    return meal.id;
  });
}

// ---- Swap Meal: options for one meal, and putting one in its place ---------------------

// The ids of the plan meals already logged to the diary on `date`
async function loggedMealIds(pool, userId, date) {
  const [logs] = await pool.query("SELECT plan_log_key FROM macro_meal_logs WHERE user_id = ? AND log_date = ? AND source = 'plan'", [userId, date]);
  return new Set(logs.map((l) => String(l.plan_log_key).split(":")[1]).filter(Boolean));
}

// The dishes offered for this slot in the last week, newest first, so the next ask brings new ones
async function recentOptionNames(pool, userId, slot) {
  const [rows] = await pool.query(
    "SELECT name FROM coach_meal_options WHERE user_id = ? AND slot = ? AND kind = 'suggestion' AND created_at >= NOW() - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT ?",
    [userId, slot, rules.limits.recentOptions],
  );
  const names = [];
  for (const row of rows) if (!names.some((n) => rules.dishKey(n) === rules.dishKey(row.name))) names.push(row.name);
  return names;
}

const optionToApi = (row) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  description: row.description ?? null,
  note: row.note ?? null,
  items: row.items,
  totals: { kcal: Number(row.kcal), proteinG: Number(row.protein_g), carbsG: Number(row.carbs_g), fatG: Number(row.fat_g) },
});

// One row of coach_meal_options from a cleaned meal; answers the row as the API shows it
async function storeOption(conn, { userId, planId, meal, kind, option }) {
  const totals = rules.totalsOf(option.items);
  const [[{ id }]] = await conn.query("SELECT UUID() AS id");
  await conn.query(
    "INSERT INTO coach_meal_options (id, user_id, plan_id, meal_id, slot, kind, name, description, note, items, kcal, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, userId, planId, meal.id, meal.slot, kind, option.name, option.description ?? null, option.note ?? null, JSON.stringify(option.items), totals.kcal, totals.proteinG, totals.carbsG, totals.fatG],
  );
  return optionToApi({ id, kind, name: option.name, description: option.description ?? null, note: option.note ?? null, items: option.items, kcal: totals.kcal, protein_g: totals.proteinG, carbs_g: totals.carbsG, fat_g: totals.fatG });
}

/**
 * Five dishes the member could have instead of one meal of the active plan, from the model, made
 * for them: their goal, diet, cuisines, allergies, dislikes, cooking time, budget and conditions,
 * their targets and what the diary says is left of `date`, and the dishes offered for that slot
 * in the last week (not repeated), steered by `preference` when they picked a chip. Each option
 * is cleaned, scaled and stored, and only a stored
 * option can go into the plan (replaceMeal). The plan itself doesn't change here. One AI call,
 * recorded as coach_meal; a second ask for the same meal while one is running joins it.
 */
async function mealOptions(pool, userId, mealId, { date, preference = null }, env = process.env) {
  const plan = await activeCoachPlan(pool, userId);
  const meal = plan?.meals.find((m) => m.id === mealId);
  if (!meal) throw new NotFoundError("That meal isn't in your plan.");
  const { intake, profile, targets } = await memberFacts(pool, userId);
  const [day, logged, recent] = await Promise.all([diary.day(pool, userId, date), loggedMealIds(pool, userId, date), recentOptionNames(pool, userId, meal.slot)]);
  const remaining = rules.remainingFor(targets, day.totals, logged.has(meal.id) ? meal.totals : null);
  const targetKcal = rules.optionTargetKcal(meal.totals.kcal, remaining.kcal, preference);
  const exclude = [meal.name, ...recent];
  await aiLimits.check(pool, { feature: "coach_meal", userId }, env);
  return dedupe.shared.run(dedupe.requestKey("coach_meal_options", userId, mealId, date, preference, exclude), async () => {
    const usage = aiUsage.tracker(pool, { feature: "coach_meal", userId });
    const raw = await askStructured(
      { feature: "coach_meal_options", instructions: rules.OPTIONS_INSTRUCTIONS, brief: rules.optionsBrief({ profile, intake, targets, remaining, meal, targetKcal, exclude: recent, preference }), schema: rules.optionsSchema, fake: rules.FAKE_OPTIONS, failure: rules.OPTIONS_FAILURE },
      env,
      usage,
    );
    const options = rules.normalizeOptions(raw, meal, profile.allergies, { targetKcal, exclude });
    // Options older than a month are no use to anyone (undo snapshots included)
    await pool.query("DELETE FROM coach_meal_options WHERE user_id = ? AND created_at < NOW() - INTERVAL 30 DAY", [userId]);
    const stored = [];
    for (const option of options) stored.push(await storeOption(pool, { userId, planId: plan.id, meal, kind: "suggestion", option }));
    return { mealId: meal.id, remaining, targetKcal, preference, options: stored };
  });
}

/**
 * Puts one stored option (a suggestion for that meal, or the "previous" snapshot an earlier
 * replacement left, which is how Undo works) in the meal's place, in one transaction with the
 * member locked: the meal as it is now is kept as a "previous" row first, and its id comes back
 * as `undoId`. The other meals and the workout stay. The foods are cleaned again on the way in,
 * and with `quantities` (one per food, 0 leaves it out) the member's portions set their numbers.
 */
async function replaceMeal(pool, userId, mealId, optionId, quantities = null) {
  const plan = await activeCoachPlan(pool, userId);
  const meal = plan?.meals.find((m) => m.id === mealId);
  if (!meal) throw new NotFoundError("That meal isn't in your plan.");
  const [[row]] = await pool.query(
    "SELECT id, kind, name, description, note, items FROM coach_meal_options WHERE id = ? AND user_id = ? AND meal_id = ? AND plan_id = ?",
    [optionId, userId, mealId, plan.id],
  );
  if (!row) throw new NotFoundError("That option isn't available any more. Ask for options again.");
  let items = rules.storedItems(row.items);
  if (quantities) {
    if (quantities.length !== items.length) throw new ValidationError("The portions don't match the option's foods. Ask for options again.");
    items = rules.editedItems(items, quantities);
    if (items.length === 0) throw new ValidationError("Keep at least one food in the meal.");
  }
  const name = String(row.name).slice(0, rules.limits.mealName);
  const previous = await workoutPlans.withMemberLock(pool, userId, async (conn) => {
    const kept = await storeOption(conn, { userId, planId: plan.id, meal, kind: "previous", option: { name: meal.name, note: meal.note, items: meal.items } });
    const [result] = await conn.query("UPDATE coach_plan_meals SET name = ?, note = ? WHERE id = ? AND plan_id = ? AND user_id = ?", [name, row.note ?? null, meal.id, plan.id, userId]);
    if (result.affectedRows === 0) throw new NotFoundError("That meal isn't in your plan.");
    await conn.query("DELETE FROM coach_plan_meal_items WHERE meal_id = ? AND user_id = ?", [meal.id, userId]);
    await conn.query(
      "INSERT INTO coach_plan_meal_items (meal_id, plan_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES ?",
      [items.map((it, i) => [meal.id, plan.id, userId, i, it.name, it.quantity, it.unit, it.kcal, it.proteinG, it.carbsG, it.fatG])],
    );
    await conn.query("UPDATE coach_meal_options SET used_at = NOW() WHERE id = ? AND user_id = ?", [row.id, userId]);
    return kept;
  });
  return { mealId: meal.id, undoId: previous.id, replaced: { name: previous.name, totals: previous.totals }, name, totals: rules.totalsOf(items) };
}

/**
 * Puts a workout change the coach suggested in chat into effect: drafts a new week for the new
 * training days and session length the same way the plan did (the AI from the library, the
 * engine as the fallback), then, in one transaction with the member locked, saves them as the
 * member's intake answers, stores the week and points the active coach plan at it. The meals
 * stay; the old workout is kept as superseded, with its history. One AI call (coach_workout).
 */
async function changeWorkout(pool, userId, { today, weekdays, sessionMinutes }, env = process.env) {
  const plan = await activeCoachPlan(pool, userId);
  if (!plan) throw new NotFoundError("Make your coach plan first.");
  const { intake } = await memberFacts(pool, userId);
  const next = { ...intake, weekdays, sessionMinutes };
  const draft = await draftWorkout(pool, userId, today, next, env);
  await workoutPlans.withMemberLock(pool, userId, async (conn) => {
    await conn.query("UPDATE coach_profiles SET weekdays = ?, session_minutes = ? WHERE user_id = ?", [JSON.stringify(weekdays), sessionMinutes, userId]);
    const { planId: workoutPlanId } = await workoutPlans.planFromCoach(conn, userId, { ...draft.facts, today, prepared: draft.prepared });
    await conn.query("UPDATE coach_plans SET workout_plan_id = ? WHERE id = ? AND user_id = ?", [workoutPlanId, plan.id, userId]);
  });
}

/**
 * Logs a coach meal into the Macro diary for `date` (the member's today), as it is. One log per
 * date and meal: a repeated tap returns the first log instead of a copy.
 */
async function logMeal(pool, userId, mealId, { date }) {
  const plan = await activeCoachPlan(pool, userId);
  const meal = plan?.meals.find((m) => m.id === mealId);
  if (!meal) throw new NotFoundError("That meal isn't in your plan.");
  const key = rules.planLogKey(date, mealId, 1);
  const [[existing]] = await pool.query("SELECT id FROM macro_meal_logs WHERE user_id = ? AND plan_log_key = ?", [userId, key]);
  if (existing) return { mealId, logId: existing.id, alreadyLogged: true };
  try {
    const { mealId: logId } = await diary.logMeal(pool, userId, {
      date, slot: rules.diarySlotFor(meal.slot), title: meal.name, loggedAt: Date.now(), source: "plan", planLogKey: key, items: meal.items,
    });
    return { mealId, logId, alreadyLogged: false };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      // Two taps raced: the first one's log is the answer
      const [[winner]] = await pool.query("SELECT id FROM macro_meal_logs WHERE user_id = ? AND plan_log_key = ?", [userId, key]);
      if (winner) return { mealId, logId: winner.id, alreadyLogged: true };
    }
    throw error;
  }
}

module.exports = { toIntake, makePlan, swapMeal, mealOptions, replaceMeal, changeWorkout, storeOption, getPlan, logMeal };
