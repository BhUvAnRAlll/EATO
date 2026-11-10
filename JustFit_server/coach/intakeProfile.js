// The AI Coach intake's profile answers (2026-11-10): since setup asks only the personal
// details, the intake collects what the targets and the meals need: the activity level, the
// health check and the food answers (diet, food usually eaten, allergies, dislikes, meals per
// day). They are saved to `profiles`, and the calorie and macro targets are worked out in code
// with the app's own calculator (never by AI), all in the intake's own transaction.
// The calorie goal comes from the coach goal, so the app asks one goal question.
const nutrition = require("../../JustFit_client/src/lib/nutrition/index.ts");
const { ageFromDob } = require("../../JustFit_client/src/lib/date.ts");
const profileRules = require("../profile");

const { ValidationError } = profileRules;

// The coach's eight goals → the calculator's four
const FITNESS_GOAL = {
  lose_weight: "fat_loss",
  build_muscle: "muscle_gain",
  get_stronger: "muscle_gain",
  endurance: "maintenance",
  stay_active: "maintenance",
  flexibility: "maintenance",
  sport: "maintenance",
  comeback: "maintenance",
};

const FIELDS = ["activity", "healthFlags", "diet", "cuisines", "dislikes", "allergies", "mealsPerDay"];

/** body.profile of PUT /intake → clean answers. Older app builds leave it out (null). */
function validateIntakeProfile(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Send your profile answers as an object.");
  for (const key of Object.keys(value)) if (!FIELDS.includes(key)) throw new ValidationError("The request has a field we don't expect.");
  const activity = profileRules.enumOrNull(value.activity, profileRules.ACTIVITIES, "Activity level");
  if (!activity) throw new ValidationError("Choose how active your day is.");
  const food = profileRules.validateFood(value);
  if (!food.diet) throw new ValidationError("Choose your diet.");
  if (!food.mealsPerDay) throw new ValidationError("Choose how many meals you eat a day.");
  // Pregnancy and breastfeeding are dropped for a male member once the gender is known
  const healthFlags = profileRules.validateHealthFlags(value.healthFlags, null);
  return { activity, healthFlags, ...food };
}

const dobText = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};
const num = (v) => (v === null || v === undefined ? null : Number(v));
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * The calculator's answer for this member: "set" with a record to save, or why not.
 * `current` is the saved target record (or null); a target the member entered themselves (no
 * calculation behind it) is kept as it is.
 */
function targetsFor(row, current, fitnessGoal, answers, now = new Date()) {
  if (current && current.calculated === null) return { state: "kept" };
  const age = ageFromDob(dobText(row.dob));
  if (age === null || row.height_cm === null || row.weight_kg === null) return { state: "needs_details" };
  const weightKg = Number(row.weight_kg);
  const bodyFat = num(row.body_fat_percent);
  const inputs = {
    age,
    gender: row.gender ?? "unspecified",
    heightCm: Number(row.height_cm),
    weightKg,
    activityLevel: answers.activity,
    fitnessGoal,
    healthFlags: answers.healthFlags,
    ...(bodyFat !== null ? { bodyComposition: nutrition.manualBodyFatReport(weightKg, bodyFat, now) } : {}),
  };
  const result = nutrition.calculateTargets(inputs, nutrition.calculatorConfig, now);
  // Gender other / prefer not to say: the member picks the estimate themselves (Profile › Goal & activity)
  if (result.status === "needs_equation_choice") return { state: "needs_choice" };
  if (result.status === "needs_professional_guidance") return { state: "needs_professional" };
  if (result.status !== "ok") return { state: "needs_details" };
  return { state: "set", record: nutrition.createTargetRecord(inputs, result, now) };
}

/**
 * Saves the answers to the member's profile and works out the targets, inside `connection`'s
 * transaction. Answers the targets' state: set, kept (their own target), needs_choice,
 * needs_professional or needs_details. Without a profile (setup not done) it refuses.
 */
async function applyIntakeProfile(connection, userId, coachGoal, answers) {
  const [[row]] = await connection.query(
    "SELECT DATE_FORMAT(dob, '%Y-%m-%d') AS dob, gender, height_cm, weight_kg, body_fat_percent FROM profiles WHERE user_id = ? FOR UPDATE",
    [userId],
  );
  if (!row) throw new ValidationError("Finish your personal details first.");
  const goal = FITNESS_GOAL[coachGoal] ?? "maintenance";
  const healthFlags = profileRules.validateHealthFlags(answers.healthFlags, row.gender);
  const clean = { ...answers, healthFlags };

  await connection.query(
    `UPDATE profiles SET goal = ?, activity = ?, health_flags = ?, diet = ?, cuisines = ?, dislikes = ?, allergies = ?, meals_per_day = ?
     WHERE user_id = ?`,
    [goal, clean.activity, JSON.stringify(healthFlags), clean.diet, JSON.stringify(clean.cuisines), clean.dislikes, clean.allergies, clean.mealsPerDay, userId],
  );

  const [[saved]] = await connection.query("SELECT calculated FROM nutrition_targets WHERE user_id = ? FOR UPDATE", [userId]);
  const current = saved ? { calculated: saved.calculated === null ? null : parse(saved.calculated) } : null;
  const outcome = targetsFor(row, current, goal, clean);
  if (outcome.state === "set") await profileRules.writeTargets(connection, userId, profileRules.targetsRow(outcome.record, userId));
  return outcome.state;
}

/** What the intake's new steps start from: the member's saved answers (any may be missing) */
function prefillProfile(row) {
  if (!row) return {};
  const prefill = {};
  if (row.activity) prefill.activity = row.activity;
  const flags = parse(row.health_flags);
  if (Array.isArray(flags) && flags.length) prefill.healthFlags = flags;
  if (row.diet) prefill.diet = row.diet;
  const cuisines = parse(row.cuisines);
  if (Array.isArray(cuisines) && cuisines.length) prefill.cuisines = cuisines;
  if (row.dislikes) prefill.dislikes = row.dislikes;
  if (row.allergies) prefill.allergies = row.allergies;
  if (row.meals_per_day) prefill.mealsPerDay = row.meals_per_day;
  return prefill;
}

module.exports = { FITNESS_GOAL, validateIntakeProfile, targetsFor, applyIntakeProfile, prefillProfile };
