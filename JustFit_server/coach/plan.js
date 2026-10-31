// The AI Coach plan: the workout (made by the existing engine from the intake) and one day of
// meals (written by the model, cleaned and scaled to the member's targets in planRules.js).
//
// Every query is scoped to the verified member id passed in by the route. In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed day of meals is
// used instead of calling OpenAI.
//
// Cost: the model comes from ai/models.js, the whole day is one structured call, one meal can be
// swapped on its own (a much smaller call) instead of remaking the day, the daily plan limit is
// checked first (ai/limits.js) and two requests for the same member at once make one plan.
const OpenAI = require("openai");

const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");
const diary = require("../macro/diary");
const workoutPlans = require("../workout/plans");
const rules = require("./planRules");
const aiUsage = require("../ai/usage");
const models = require("../ai/models");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");

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

// ---- asking the model ---------------------------------------------------------------

// `usage` (ai/usage.tracker) records the call for the admin's AI Usage screen; never the text
// One structured call: `feature` picks the model and caps (coach_plan: the whole day; coach_meal:
// one meal), `schema` the answer's shape. `fake` is the test answer.
async function askStructured({ feature, instructions, brief, schema, fake, failure }, env, usage) {
  if (models.isFake(env)) {
    await usage?.record({ provider: "openai", model: "fake", inputTokens: 10, outputTokens: 5, status: "ok" });
    return fake;
  }
  const { request, model: MODEL } = models.settingsFor(feature, env);
  const client = models.openaiClient();
  let response;
  try {
    response = await client.responses.create({
      ...request,
      instructions,
      store: false,
      input: [{ role: "user", content: [{ type: "input_text", text: brief }] }],
      text: { format: { type: "json_schema", name: feature, strict: true, schema } },
    });
  } catch (error) {
    await usage?.record({ provider: "openai", model: MODEL, status: "failed" });
    // Never log the request or the answer, only the status
    if (error instanceof OpenAI.RateLimitError) throw new rules.CoachPlanError("Your coach is busy right now. Please try again in a minute.", 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Coach ${feature} failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new rules.CoachPlanError(failure, 502);
    }
    throw error;
  }
  const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
  const usable = !refused && response.status !== "incomplete" && Boolean(response.output_text);
  await usage?.record({
    provider: "openai", model: MODEL, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens,
    cachedInputTokens: models.cachedTokensOf(response), status: usable ? "ok" : "refused",
  });
  if (!usable) throw new rules.CoachPlanError(failure, 502);
  return JSON.parse(response.output_text);
}

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
  const diet = rules.normalizeDiet(await askForDiet(rules.dietBrief({ intake, profile, targets, coachName, workoutSummary }), env, usage), targets, profile.allergies);

  const planId = await workoutPlans.withMemberLock(pool, userId, async (conn) => {
    const { planId: workoutPlanId } = await workoutPlans
      .planFromCoach(conn, userId, {
        today,
        goal: rules.engineGoalFor(intake.goal),
        level: rules.engineLevelFor(intake.experience),
        weekdays: intake.weekdays,
        shape: { library: rules.libraryFilterFor(intake), days: rules.fitDaysTo(intake.sessionMinutes) },
      })
      .catch((error) => {
        // The engine needs the body facts from setup (gender, age, height, weight)
        if (error?.name === "PlanInputError") throw new ValidationError("Finish your profile first, so your coach knows your targets.");
        throw error;
      });

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

module.exports = { toIntake, makePlan, swapMeal, getPlan, logMeal };
