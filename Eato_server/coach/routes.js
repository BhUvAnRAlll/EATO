// HTTP routes for the AI Coach, mounted at /api/coach in index.js behind requireUser and the
// per-user rate limit. Phase 1 is the intake only: read the member's answers (with what JustFit
// already knows to start from) and save them. The member is always the verified caller.
const express = require("express");

const { ensureUser } = require("../community/members");
const { validateIntake, prefillFrom } = require("./validate");

const router = express.Router();
const smallBody = express.json({ limit: "16kb" });

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);

// Before the migration has run on this database, say so plainly instead of a 500
const notSetUp = (res) => res.status(503).json({ error: "The AI Coach isn't set up on this server yet." });

// A coach_profiles row → the shape the app sends back on save
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

// GET /intake → { intake: answers or null, prefill: answers JustFit already has }
router.get("/intake", route(async (req, res) => {
  let rows;
  try {
    [rows] = await pool(req).query("SELECT * FROM coach_profiles WHERE user_id = ?", [req.userId]);
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return notSetUp(res);
    throw error;
  }
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
  try {
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
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return notSetUp(res);
    throw error;
  }
  const [[row]] = await pool(req).query("SELECT * FROM coach_profiles WHERE user_id = ?", [req.userId]);
  res.json({ intake: toIntake(row) });
}));

module.exports = { coachRouter: router };
