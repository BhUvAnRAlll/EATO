// HTTP routes for the AI Coach, mounted at /api/coach in index.js behind requireUser and the
// per-user rate limit. The intake (read the member's answers, with what justFit already knows to
// start from, and save them), the plan (make it, read it, log its meals to Macro) and the chat. The member
// is always the verified caller.
const express = require("express");

const { ensureUser } = require("../auth");
const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { validateIntake, prefillFrom, planBody, planQuery, logBody, optionsBody, replaceBody, mealId, coachChoice } = require("./validate");
const { toIntake, makePlan, swapMeal, mealOptions, replaceMeal, getPlan, logMeal } = require("./plan");
const { CoachPlanError } = require("./planRules");
const { chat } = require("./chat");
const { chatBody } = require("./chatRules");

const router = express.Router();
const smallBody = express.json({ limit: "16kb" });

// Making a plan is an OpenAI call: a few an hour per member is plenty
const makePlanLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
// Every chat message is an OpenAI call too: enough for a real conversation, never unlimited
const chatLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });
// Swapping one meal is a small OpenAI call; a few an hour covers a day of changes
const swapMealLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
// The last 20 turns of up to 1,000 characters each, with room for the JSON around them
const chatBodyParser = express.json({ limit: "32kb" });

const pool = (req) => req.app.locals.pool;

// Before the migration has run on this database, say so plainly instead of a 500
const notSetUp = (res) => res.status(503).json({ error: "The AI Coach isn't set up on this server yet." });

const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return notSetUp(res);
    if (error instanceof CoachPlanError) return res.status(error.status).json({ error: error.message });
    next(error);
  });

// GET /intake → { intake: answers or null, prefill: answers justFit already has }
router.get("/intake", route(async (req, res) => {
  const [rows] = await pool(req).query("SELECT * FROM coach_profiles WHERE user_id = ?", [req.userId]);
  const [[profile], [workout]] = await Promise.all([
    pool(req).query("SELECT goal, workout_type FROM profiles WHERE user_id = ?", [req.userId]).then(([r]) => r),
    pool(req).query("SELECT experience, weekdays FROM workout_profiles WHERE user_id = ?", [req.userId]).then(([r]) => r),
  ]);
  res.json({ intake: rows[0] ? toIntake(rows[0]) : null, prefill: prefillFrom(profile, workout) });
}));

// PUT /intake: every answer at once; a second save replaces the first
router.put("/intake", smallBody, route(async (req, res) => {
  const a = validateIntake(req.body);
  await ensureUser(pool(req), req.userId);
  const values = [
    a.goal, a.experience, a.currentlyTraining, JSON.stringify(a.weekdays), a.sessionMinutes, a.mainSpot, a.backupSpot,
    a.mainEquipment, a.backupEquipment, JSON.stringify(a.joints), JSON.stringify(a.conditions), a.limitationNotes,
    a.cookingTime, a.foodBudget, a.stress, a.sleep, a.coach, a.coachStyle, a.planNotes,
  ];
  await pool(req).query(
      `INSERT INTO coach_profiles (user_id, goal, experience, currently_training, weekdays, session_minutes, main_spot, backup_spot,
         main_equipment, backup_equipment, joints, conditions, limitation_notes, cooking_time, food_budget, stress, sleep, coach,
         coach_style, plan_notes, disclaimer_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE goal = VALUES(goal), experience = VALUES(experience), currently_training = VALUES(currently_training),
         weekdays = VALUES(weekdays), session_minutes = VALUES(session_minutes), main_spot = VALUES(main_spot), backup_spot = VALUES(backup_spot),
         main_equipment = VALUES(main_equipment), backup_equipment = VALUES(backup_equipment), joints = VALUES(joints),
         conditions = VALUES(conditions), limitation_notes = VALUES(limitation_notes), cooking_time = VALUES(cooking_time),
         food_budget = VALUES(food_budget), stress = VALUES(stress), sleep = VALUES(sleep), coach = VALUES(coach),
         coach_style = VALUES(coach_style), plan_notes = VALUES(plan_notes), disclaimer_accepted_at = NOW()`,
      [req.userId, ...values],
    );
  const [[row]] = await pool(req).query("SELECT * FROM coach_profiles WHERE user_id = ?", [req.userId]);
  res.json({ intake: toIntake(row) });
}));

// PUT /intake/coach { coach, coachStyle }: changes only who coaches the member and how, keeping
// every other answer (and the disclaimer they already accepted). Needs a saved intake.
router.put("/intake/coach", smallBody, route(async (req, res) => {
  const { coach, coachStyle } = coachChoice(req.body);
  const [result] = await pool(req).query("UPDATE coach_profiles SET coach = ?, coach_style = ? WHERE user_id = ?", [coach, coachStyle, req.userId]);
  if (result.affectedRows === 0) return res.status(400).json({ error: "Answer your coach's questions first." });
  const [[row]] = await pool(req).query("SELECT * FROM coach_profiles WHERE user_id = ?", [req.userId]);
  res.json({ intake: toIntake(row) });
}));

// GET /plan?date=YYYY-MM-DD → { state: "none" | "ready", plan, workout }
router.get("/plan", route(async (req, res) => {
  res.json(await getPlan(pool(req), req.userId, planQuery(req.query, Date.now())));
}));

// POST /plan { today }: makes a new plan (workout and meals) and makes it the active one
router.post("/plan", limitPerUser(makePlanLimiter), smallBody, route(async (req, res) => {
  const { today } = planBody(req.body, Date.now());
  await ensureUser(pool(req), req.userId);
  await makePlan(pool(req), req.userId, { today });
  res.status(201).json(await getPlan(pool(req), req.userId, { date: today }));
}));

// POST /plan/meals/:mealId/swap { date }: a new dish in that meal's place (the rest of the plan stays); answers the plan
router.post("/plan/meals/:mealId/swap", limitPerUser(swapMealLimiter), smallBody, route(async (req, res) => {
  const { date } = logBody(req.body, Date.now());
  const changed = await swapMeal(pool(req), req.userId, mealId(req.params.mealId));
  res.json({ mealId: changed, ...(await getPlan(pool(req), req.userId, { date })) });
}));

// POST /plan/meals/:mealId/options { date, preference? }: five dishes the member could have in that meal's place,
// made for them and for what's left of the day, steered by `preference` (lighter, more_protein, different_cuisine,
// quick) when given. One AI call, the same hourly allowance as a swap. The plan doesn't change.
router.post("/plan/meals/:mealId/options", limitPerUser(swapMealLimiter), smallBody, route(async (req, res) => {
  const { date, preference } = optionsBody(req.body, Date.now());
  res.json(await mealOptions(pool(req), req.userId, mealId(req.params.mealId), { date, preference }));
}));

// POST /plan/meals/:mealId/replace { date, optionId, quantities? }: that option goes in the meal's place, with the
// member's portions when they edited them; `undoId` is an option that puts the old meal back the same way. No AI
// call. Answers the plan with the new totals.
router.post("/plan/meals/:mealId/replace", smallBody, route(async (req, res) => {
  const { date, optionId, quantities } = replaceBody(req.body, Date.now());
  const result = await replaceMeal(pool(req), req.userId, mealId(req.params.mealId), optionId, quantities);
  res.json({ ...result, ...(await getPlan(pool(req), req.userId, { date })) });
}));

// POST /plan/meals/:mealId/log { date }: the meal goes into the Macro diary as it is, once a day
router.post("/plan/meals/:mealId/log", smallBody, route(async (req, res) => {
  const { date } = logBody(req.body, Date.now());
  await ensureUser(pool(req), req.userId);
  res.json(await logMeal(pool(req), req.userId, mealId(req.params.mealId), { date }));
}));

// POST /chat { date, messages }: the coach's reply to the member's latest message. Nothing is stored.
router.post("/chat", limitPerUser(chatLimiter), chatBodyParser, route(async (req, res) => {
  const body = chatBody(req.body, Date.now());
  res.json(await chat(pool(req), req.userId, body));
}));

module.exports = { coachRouter: router };
