// Input checks for the AI Coach intake: one friendly line per problem. Pure functions (no
// database), so they are unit-tested directly. Identity never comes from here: the routes read
// the member from the verified session.
const { ValidationError } = require("../profile");
const { isoDate, isNearToday, id } = require("../macro/validate");

const options = {
  goal: ["build_muscle", "lose_weight", "get_stronger", "endurance", "stay_active", "flexibility", "sport", "comeback"],
  experience: ["beginner", "returning", "intermediate", "advanced", "expert"],
  sessionMinutes: [15, 20, 30, 45, 60, 75],
  spot: ["gym", "home", "outdoors", "travel", "other"],
  joints: ["knees", "shoulders", "lower_back", "elbows", "wrists", "hips", "ankles"],
  conditions: ["heart_disease", "high_bp", "diabetes", "asthma", "arthritis", "back_problems", "previous_surgery", "thyroid", "pcos"],
  cookingTime: ["none", "quick", "medium", "long"],
  foodBudget: ["low", "medium", "high"],
  stress: ["low", "moderate", "high"],
  sleep: ["under_5", "5_6", "7_8", "over_8"],
  coach: ["arjun", "priya", "rohan", "meera", "aditya"],
  coachStyle: ["supportive", "motivational", "direct", "analytical", "funny"],
};

// What equipment makes sense at each spot (a gym is never "nothing")
const equipmentBySpot = {
  gym: ["full_gym", "basic_gym", "free_weights"],
  home: ["none", "some", "home_gym", "full_gym"],
  outdoors: ["none", "some"],
  travel: ["none", "some"],
  other: ["none", "some"],
};

const limits = { limitationNotes: 300, planNotes: 500 };

const FIELDS = [
  "goal", "experience", "currentlyTraining", "weekdays", "sessionMinutes", "mainSpot", "backupSpot", "mainEquipment",
  "backupEquipment", "joints", "conditions", "limitationNotes", "cookingTime", "foodBudget", "stress", "sleep", "coach",
  "coachStyle", "planNotes", "acceptedDisclaimer",
];

function oneOf(value, allowed, message) {
  if (!allowed.includes(value)) throw new ValidationError(message);
  return value;
}

const optional = (value, allowed, message) => (value === null || value === undefined ? null : oneOf(value, allowed, message));

// A list of distinct allowed values (order kept), at most every option once
function listOf(value, allowed, message) {
  if (!Array.isArray(value) || value.length > allowed.length) throw new ValidationError(message);
  for (const item of value) oneOf(item, allowed, message);
  return [...new Set(value)];
}

// Optional free text: control characters dropped, trimmed, cut to `max`; empty means null
function note(value, max, what) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError(`${what} must be text.`);
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

// PUT /api/coach/intake: every answer at once
function validateIntake(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the answers as an object.");
  for (const key of Object.keys(body)) if (!FIELDS.includes(key)) throw new ValidationError(`The answers have an unexpected field: ${key}.`);

  if (body.acceptedDisclaimer !== true) throw new ValidationError("Please confirm that this is fitness guidance, not medical advice.");
  if (typeof body.currentlyTraining !== "boolean") throw new ValidationError("Tell us whether you're working out now.");

  const weekdays = Array.isArray(body.weekdays) && body.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? [...new Set(body.weekdays)].sort() : null;
  if (!weekdays || weekdays.length === 0 || body.weekdays.length > 7) throw new ValidationError("Pick at least one training day.");

  const mainSpot = oneOf(body.mainSpot, options.spot, "Choose where you train most.");
  const backupSpot = optional(body.backupSpot, options.spot, "The backup spot isn't valid.");
  if (backupSpot === mainSpot) throw new ValidationError("Your backup spot should be different from your main spot.");
  const mainEquipment = oneOf(body.mainEquipment, equipmentBySpot[mainSpot], "Choose the equipment at your main spot.");
  let backupEquipment = null;
  if (backupSpot !== null) backupEquipment = oneOf(body.backupEquipment, equipmentBySpot[backupSpot], "Choose the equipment at your backup spot.");
  else if (body.backupEquipment !== null && body.backupEquipment !== undefined) throw new ValidationError("There's no backup spot for that equipment.");

  return {
    goal: oneOf(body.goal, options.goal, "Choose your goal."),
    experience: oneOf(body.experience, options.experience, "Choose how experienced you are."),
    currentlyTraining: body.currentlyTraining,
    weekdays,
    sessionMinutes: oneOf(body.sessionMinutes, options.sessionMinutes, "Choose a session length."),
    mainSpot,
    backupSpot,
    mainEquipment,
    backupEquipment,
    joints: listOf(body.joints, options.joints, "One of the joints isn't valid."),
    conditions: listOf(body.conditions, options.conditions, "One of the conditions isn't valid."),
    limitationNotes: note(body.limitationNotes, limits.limitationNotes, "Injuries or notes"),
    cookingTime: oneOf(body.cookingTime, options.cookingTime, "Choose how much time you have to cook."),
    foodBudget: oneOf(body.foodBudget, options.foodBudget, "Choose a food budget."),
    stress: optional(body.stress, options.stress, "The stress level isn't valid."),
    sleep: optional(body.sleep, options.sleep, "The sleep answer isn't valid."),
    coach: oneOf(body.coach, options.coach, "Choose your coach."),
    coachStyle: oneOf(body.coachStyle, options.coachStyle, "Choose a coaching style."),
    planNotes: note(body.planNotes, limits.planNotes, "Plan notes"),
  };
}

// Answers justFit already has, to start the intake with (each may be missing). From the setup
// profile (goal, gym or home) and the workout profile (experience, training days).
const GOAL_FROM_PROFILE = { fat_loss: "lose_weight", muscle_gain: "build_muscle", maintenance: "stay_active", healthy_eating: "stay_active" };
const SPOT_FROM_PROFILE = { gym: "gym", home: "home", cardio: "outdoors" };
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);

function prefillFrom(profile, workout) {
  const prefill = {};
  if (profile?.goal && GOAL_FROM_PROFILE[profile.goal]) prefill.goal = GOAL_FROM_PROFILE[profile.goal];
  if (profile?.workout_type && SPOT_FROM_PROFILE[profile.workout_type]) prefill.mainSpot = SPOT_FROM_PROFILE[profile.workout_type];
  if (workout?.experience && options.experience.includes(workout.experience)) prefill.experience = workout.experience;
  const days = json(workout?.weekdays);
  if (Array.isArray(days) && days.length > 0 && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) prefill.weekdays = [...days].sort();
  return prefill;
}

// ---- the plan routes ----------------------------------------------------------------

// A body with exactly these fields (and nothing else)
function onlyFields(body, fields) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the request as a JSON object.");
  for (const key of Object.keys(body)) if (!fields.includes(key)) throw new ValidationError(`The request has an unexpected field: ${key}.`);
}

// The member's local day: any day within one day of the server's covers every time zone
function memberToday(value, now, what) {
  const iso = isoDate(value, what);
  if (!isNearToday(iso, now)) throw new ValidationError(`${what} doesn't match the server's date. Check your phone's date.`);
  return iso;
}

// POST /plan { today }
function planBody(body, now) {
  onlyFields(body, ["today"]);
  return { today: memberToday(body.today, now, "Today") };
}

// GET /plan?date=: which day's logged meals to show (any real day)
function planQuery(query) {
  return { date: isoDate(query.date) };
}

// POST /plan/meals/:mealId/log { date }: only today's meals can be logged
function logBody(body, now) {
  onlyFields(body, ["date"]);
  return { date: memberToday(body.date, now, "The date") };
}

const mealId = (value) => id(value, "The meal");

module.exports = { options, equipmentBySpot, limits, validateIntake, prefillFrom, planBody, planQuery, logBody, mealId };
