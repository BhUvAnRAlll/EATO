// The AI Coach's Insights tab: one week of the member's own data (meals logged in Macro, workouts
// done, weight they entered) worked into numbers, and the coach's review of those numbers.
//
// Reading the week is free (no AI). The review is one small AI call per member per week, saved in
// coach_insights (migration 2026-11-14) and served from there; the member can ask for a fresh one
// at most once a day. Every query is scoped to the verified member id passed in by the route.
// The numbers sent to the model hold no name, phone or id; the review is never logged.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const plans = require("../workout/plans");
const { toIntake } = require("./plan");
const { CoachPlanError } = require("./planRules");
const rules = require("./insightsRules");
const { askStructured } = require("../ai/structured");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");

const FEATURE = "coach_insights";
const FAILED = "Your coach couldn't write your review right now. Please try again.";

const parseJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);

// Calories and macros per day for the days of `dates` with meals
async function mealDays(pool, userId, dates) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(m.log_date, '%Y-%m-%d') AS d, SUM(i.kcal) AS kcal, SUM(i.protein_g) AS p, SUM(i.carbs_g) AS c, SUM(i.fat_g) AS f
       FROM macro_meal_logs m JOIN macro_meal_items i ON i.macro_meal_id = m.id
      WHERE m.user_id = ? AND m.log_date BETWEEN ? AND ?
      GROUP BY m.log_date`,
    [userId, dates[0], dates[dates.length - 1]],
  );
  return new Map(rows.map((r) => [r.d, { kcal: Number(r.kcal), proteinG: Number(r.p), carbsG: Number(r.c), fatG: Number(r.f) }]));
}

async function targetsOf(pool, userId) {
  const [[row]] = await pool.query("SELECT calories, protein_g, carbs_g, fat_g FROM nutrition_targets WHERE user_id = ?", [userId]);
  return row ? { kcal: row.calories, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g } : null;
}

// Sets done per muscle group in the week's completed sessions (main work only, not warm-ups)
async function muscleGroups(pool, userId, { start, end }) {
  const [rows] = await pool.query(
    `SELECT x.muscle_group AS grp, COUNT(*) AS sets
       FROM workout_logs l
       JOIN workout_set_logs s ON s.log_id = l.id AND s.user_id = l.user_id
       JOIN workout_day_exercises e ON e.id = s.day_exercise_id AND e.user_id = l.user_id
       JOIN workout_exercise_library x ON x.id = e.exercise_id
      WHERE l.user_id = ? AND l.status = 'completed' AND l.on_date BETWEEN ? AND ? AND e.section = 'workout'
      GROUP BY x.muscle_group`,
    [userId, start, end],
  );
  return rows.map((r) => ({ group: r.grp, sets: Number(r.sets) }));
}

async function workoutWeek(pool, userId, week, today) {
  const plan = await plans.activePlanRow(pool, userId);
  const [resolved, activity, groups] = await Promise.all([
    plans.resolveDates(pool, userId, plan?.id ?? null, week.dates, today, plan?.start_date ?? null),
    plans.activity(pool, userId, { today: week.lastDay }),
    muscleGroups(pool, userId, week),
  ]);
  const minutes = new Map(activity.week.filter((d) => week.dates.includes(d.date)).map((d) => [d.date, d.minutes]));
  return rules.workoutStats(resolved, minutes, groups, Boolean(plan));
}

// Weigh-ins first, so a report on the same day doesn't replace what the member typed
async function weightPoints(pool, userId) {
  const [[weighIns], [reports]] = await Promise.all([
    pool.query("SELECT DATE_FORMAT(logged_on, '%Y-%m-%d') AS date, weight_kg AS kg FROM weigh_ins WHERE user_id = ? ORDER BY logged_on DESC LIMIT 60", [userId]),
    pool.query(
      `SELECT DATE_FORMAT(test_date, '%Y-%m-%d') AS date, weight_kg AS kg FROM body_composition_reports
        WHERE user_id = ? AND test_date IS NOT NULL AND weight_kg IS NOT NULL ORDER BY test_date DESC LIMIT 20`,
      [userId],
    ),
  ]);
  return [...weighIns, ...reports];
}

// What the coach knows about the member that shapes the advice (their answers and food rules)
async function memberOf(pool, userId) {
  const [[[intakeRow]], [[profile]]] = await Promise.all([
    pool.query("SELECT * FROM coach_profiles WHERE user_id = ?", [userId]),
    pool.query("SELECT goal, diet, cuisines, allergies FROM profiles WHERE user_id = ?", [userId]),
  ]);
  const intake = intakeRow ? toIntake(intakeRow) : null;
  return {
    intake,
    profileGoal: profile?.goal ?? null,
    food: { diet: profile?.diet ?? null, allergies: profile?.allergies ?? "" },
    brief: intake && {
      goal: intake.goal, experience: intake.experience, foodBudget: intake.foodBudget, joints: intake.joints, sleep: intake.sleep, stress: intake.stress,
      diet: profile?.diet ?? null, cuisines: parseJson(profile?.cuisines) ?? [], allergies: profile?.allergies ?? "",
    },
  };
}

// The saved review for the week, or null (also before the migration has made the table)
async function savedReview(pool, userId, weekStart) {
  try {
    const [[row]] = await pool.query(
      "SELECT summary, tips, facts_hash, DATE_FORMAT(made_on, '%Y-%m-%d') AS made_on, created_at FROM coach_insights WHERE user_id = ? AND week_start = ?",
      [userId, weekStart],
    );
    return row ?? null;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return undefined; // not set up: the screen shows the numbers only
    throw error;
  }
}

const hashOf = (brief) => crypto.createHash("sha256").update(brief).digest("hex").slice(0, 32);

const reviewToApi = (row, hash, today) =>
  row
    ? {
        summary: row.summary,
        tips: parseJson(row.tips),
        createdAt: new Date(row.created_at).toISOString(),
        // The numbers have moved since it was written (a meal or a workout logged after)
        stale: row.facts_hash !== hash,
        canRefresh: row.made_on < today,
      }
    : null;

// Everything the tab shows except the review, with the text the review would be written from
async function weekFacts(pool, userId, { today, week }) {
  const w = rules.weekOf(today, week);
  const [days, targets, workouts, points, member] = await Promise.all([
    mealDays(pool, userId, w.dates),
    targetsOf(pool, userId),
    workoutWeek(pool, userId, w, today),
    weightPoints(pool, userId),
    memberOf(pool, userId),
  ]);
  const nutrition = rules.nutritionStats(w, days, targets);
  const weight = rules.weightStats(points, w.lastDay, member.profileGoal ?? member.intake?.goal);
  const brief = rules.reviewBrief({ week: w, nutrition, workouts, weight, member: member.brief });
  // Something to review: food logged, or a session done or missed
  const reviewable = Boolean(member.intake) && (nutrition !== null || (workouts !== null && workouts.done + workouts.missed > 0));
  return { w, nutrition, workouts, weight, member, brief, reviewable };
}

const toApi = (facts, today, row) => ({
  week: { week: facts.w.week, start: facts.w.start, end: facts.w.end, elapsed: facts.w.elapsed, today },
  nutrition: facts.nutrition,
  workouts: facts.workouts,
  weight: facts.weight,
  review: reviewToApi(row ?? null, hashOf(facts.brief), today),
  // The review can be asked for (the table exists and there's data); false shows why not
  canReview: row !== undefined && facts.reviewable,
});

/** GET /insights: the week's numbers and its saved review (no AI call) */
async function insights(pool, userId, { today, week }) {
  const facts = await weekFacts(pool, userId, { today, week });
  return toApi(facts, today, await savedReview(pool, userId, facts.w.start));
}

/**
 * POST /insights/review: the week's review, written the first time it's asked for and served
 * from coach_insights after that. `refresh` writes a new one, at most once a day. Answers the
 * whole tab, as GET does.
 */
async function review(pool, userId, { today, week, refresh }, env = process.env) {
  const facts = await weekFacts(pool, userId, { today, week });
  if (!facts.member.intake) throw new ValidationError("Answer your coach's questions first.");
  const saved = await savedReview(pool, userId, facts.w.start);
  if (saved === undefined) throw new CoachPlanError("Coach reviews aren't set up on this server yet.", 503);
  if (!facts.reviewable) throw new ValidationError("Log a meal or finish a workout this week, and your coach will review it.");
  const hash = hashOf(facts.brief);
  if (saved && (!refresh || saved.facts_hash === hash)) return toApi(facts, today, saved);
  if (saved && saved.made_on >= today) throw new CoachPlanError("Your coach already refreshed this review today. Try again tomorrow.", 429);

  await aiLimits.check(pool, { feature: FEATURE, userId }, env);
  // Two screens asking at once (a double tap, the tab opening twice) make one call
  await dedupe.shared.run(dedupe.requestKey(FEATURE, userId, facts.w.start, hash), async () => {
    const raw = await askStructured(
      { feature: FEATURE, instructions: rules.reviewInstructions(facts.member.intake), brief: facts.brief, schema: rules.reviewSchema, fake: rules.FAKE_REVIEW, failure: FAILED },
      env,
      aiUsage.tracker(pool, { feature: FEATURE, userId }),
    );
    const clean = rules.cleanReview(raw, facts.member.food);
    if (!clean) throw new CoachPlanError(FAILED, 502);
    await pool.query(
      `INSERT INTO coach_insights (user_id, week_start, summary, tips, facts_hash, made_on) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), tips = VALUES(tips), facts_hash = VALUES(facts_hash), made_on = VALUES(made_on), created_at = CURRENT_TIMESTAMP`,
      [userId, facts.w.start, clean.summary, JSON.stringify(clean.tips), hash, today],
    );
  });
  return toApi(facts, today, await savedReview(pool, userId, facts.w.start));
}

module.exports = { insights, review };
