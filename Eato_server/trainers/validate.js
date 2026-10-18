// Input checks for the trainer routes: one friendly line per problem, unknown fields refused.
// Pure functions (no database), unit-tested in __tests__/trainer-validate.test.js.
const { ValidationError } = require("../profile");
const { requireObject, rejectUnknownKeys, text, optionalText, id, optionalId } = require("../community/validate");
const { isoDate } = require("../macro/validate");

const limits = {
  title: 80,
  bio: 300,
  availability: 120,
  approach: 1000,
  qualifications: 10,
  qualification: 80,
  languages: 8,
  language: 30,
  note: 300,
  planName: 80,
  planNotes: 1000,
  mealName: 120,
  mealNote: 300,
  itemsPerMeal: 15,
  itemName: 120,
  unit: 40,
  quantityMax: 10000,
  kcalMax: 5000,
  macroMax: 2000,
  workoutName: 80,
  dayTitle: 60,
  exercisesPerDay: 20,
  setsPerExercise: 10,
  repsMax: 100,
  durationMax: 1800,
  restMax: 600,
  exerciseNote: 160,
  search: 60,
};

const SPECIALTIES = ["weight_loss", "muscle_gain", "nutrition", "strength", "yoga"];
const COACHING_MODES = ["online", "in_person", "both"];
const PLAN_GOALS = ["fat_loss", "muscle_gain", "maintenance"];
const MEAL_SLOTS = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"];
const WORKOUT_GOALS = ["lose_weight", "build_muscle", "get_fitter", "stay_healthy"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const SECTIONS = ["warmup", "workout", "cooldown"];
const ROLES = ["main", "secondary", "isolation", "conditioning", "warmup", "stretch"];
const SESSION_TYPES = ["full_body", "upper", "lower", "push", "pull", "legs"];
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}.`);
  return value;
};
const bool = (value, label) => {
  if (typeof value !== "boolean") throw new ValidationError(`${label} must be true or false.`);
  return value;
};
const list = (value, label, max) => {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list.`);
  if (value.length > max) throw new ValidationError(`${label} can have at most ${max} entries.`);
  return value;
};
const wholeNumber = (value, label, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
};
// A nutrition value with one decimal, within [min, max]
const amount = (value, label, min, max) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${label} must be a number.`);
  const rounded = Math.round(value * 10) / 10;
  if (rounded < min || rounded > max) throw new ValidationError(`${label} is out of range.`);
  return rounded;
};

// ---- the trainer's own profile ---------------------------------------------------------

function validateTrainerProfile(body) {
  requireObject(body, "profile");
  rejectUnknownKeys(body, ["title", "specialties", "yearsExperience", "bio", "coachingMode", "offersNutrition", "acceptingClients", "availability", "approach", "qualifications", "languages", "photoMediaId"], "The profile");
  const specialties = [...new Set(list(body.specialties, "Specialties", SPECIALTIES.length).map((s) => oneOf(s, SPECIALTIES, "A specialty")))];
  if (specialties.length === 0) throw new ValidationError("Pick at least one specialty.");
  return {
    title: text(body.title, "Title", { min: 2, max: limits.title }),
    specialties,
    yearsExperience: body.yearsExperience === undefined ? 0 : wholeNumber(body.yearsExperience, "Years of experience", 0, 60),
    bio: text(body.bio, "Bio", { min: 10, max: limits.bio }),
    coachingMode: body.coachingMode === undefined ? "online" : oneOf(body.coachingMode, COACHING_MODES, "Coaching mode"),
    offersNutrition: body.offersNutrition === undefined ? false : bool(body.offersNutrition, "Offers nutrition"),
    acceptingClients: body.acceptingClients === undefined ? true : bool(body.acceptingClients, "Accepting clients"),
    availability: optionalText(body.availability, "Availability", limits.availability),
    approach: optionalText(body.approach, "Coaching approach", limits.approach),
    qualifications: body.qualifications === undefined ? [] : list(body.qualifications, "Qualifications", limits.qualifications).map((q) => text(q, "A qualification", { max: limits.qualification })),
    languages: body.languages === undefined ? [] : list(body.languages, "Languages", limits.languages).map((l) => text(l, "A language", { max: limits.language })),
    photoMediaId: optionalId(body.photoMediaId, "The photo"),
  };
}

// ?search=&specialty=
function discoveryQuery(query) {
  const search = optionalText(query.search, "Search", limits.search);
  const specialty = query.specialty === undefined || query.specialty === "" ? null : oneOf(query.specialty, SPECIALTIES, "Specialty");
  return { search: search ? search.replace(/[\\%_]/g, (c) => `\\${c}`) : null, specialty };
}

// ---- recommendation ----------------------------------------------------------------------

function validateRecommendation(body) {
  requireObject(body, "recommendation");
  rejectUnknownKeys(body, ["calories", "proteinG", "carbsG", "fatG", "note"], "The recommendation");
  return {
    calories: wholeNumber(body.calories, "Calories", 800, 6000),
    proteinG: wholeNumber(body.proteinG, "Protein", 0, 600),
    carbsG: wholeNumber(body.carbsG, "Carbs", 0, 900),
    fatG: wholeNumber(body.fatG, "Fat", 0, 600),
    note: optionalText(body.note, "Note", limits.note),
  };
}

// ---- diet plan ---------------------------------------------------------------------------

function planItem(body, label) {
  requireObject(body, "food");
  rejectUnknownKeys(body, ["name", "quantity", "unit", "kcal", "proteinG", "carbsG", "fatG"], label);
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) throw new ValidationError(`${label}: the quantity must be a number.`);
  const quantity = Math.round(body.quantity * 100) / 100;
  if (quantity <= 0 || quantity > limits.quantityMax) throw new ValidationError(`${label}: the quantity is out of range.`);
  return {
    name: text(body.name, `${label} name`, { max: limits.itemName }),
    quantity,
    unit: text(body.unit, `${label} unit`, { max: limits.unit }),
    kcal: amount(body.kcal, `${label} calories`, 0, limits.kcalMax),
    proteinG: amount(body.proteinG, `${label} protein`, 0, limits.macroMax),
    carbsG: amount(body.carbsG, `${label} carbs`, 0, limits.macroMax),
    fatG: amount(body.fatG, `${label} fat`, 0, limits.macroMax),
  };
}

// A whole plan: name, goal, dates, notes and exactly the five meals, each with 1+ foods
function validateDietPlan(body) {
  requireObject(body, "plan");
  rejectUnknownKeys(body, ["name", "goal", "startDate", "endDate", "notes", "meals"], "The plan");
  const startDate = isoDate(body.startDate, "The start date");
  const endDate = body.endDate === undefined || body.endDate === null || body.endDate === "" ? null : isoDate(body.endDate, "The end date");
  if (endDate && endDate < startDate) throw new ValidationError("The end date must be after the start date.");
  const meals = list(body.meals, "Meals", MEAL_SLOTS.length).map((meal, index) => {
    requireObject(meal, "meal");
    rejectUnknownKeys(meal, ["slot", "name", "time", "note", "items"], `Meal ${index + 1}`);
    if (typeof meal.time !== "string" || !TIME.test(meal.time)) throw new ValidationError(`Meal ${index + 1}: the time must look like HH:MM.`);
    const items = list(meal.items, `Meal ${index + 1} foods`, limits.itemsPerMeal).map((item, i) => planItem(item, `Meal ${index + 1}, food ${i + 1}`));
    if (items.length === 0) throw new ValidationError(`Meal ${index + 1} needs at least one food.`);
    return { slot: oneOf(meal.slot, MEAL_SLOTS, `Meal ${index + 1} slot`), name: text(meal.name, `Meal ${index + 1} name`, { max: limits.mealName }), time: meal.time, note: optionalText(meal.note, `Meal ${index + 1} note`, limits.mealNote), items };
  });
  const slots = meals.map((m) => m.slot);
  if (new Set(slots).size !== slots.length) throw new ValidationError("Each meal slot can be used once.");
  if (meals.length !== MEAL_SLOTS.length) throw new ValidationError("A plan has five meals: breakfast, morning snack, lunch, evening snack and dinner.");
  meals.sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot));
  return {
    name: text(body.name, "Plan name", { max: limits.planName }),
    goal: oneOf(body.goal, PLAN_GOALS, "Goal"),
    startDate,
    endDate,
    notes: optionalText(body.notes, "Notes", limits.planNotes),
    meals,
  };
}

// Logging a plan meal: the date, servings per food (0.5 steps; 0 = skipped), and whether this
// is a deliberate repeat for the same day
function validatePlanLog(body, itemCount) {
  requireObject(body, "log");
  rejectUnknownKeys(body, ["date", "servings", "again"], "The log");
  const date = isoDate(body.date, "The date");
  let servings = null;
  if (body.servings !== undefined) {
    servings = list(body.servings, "Servings", itemCount);
    if (servings.length !== itemCount) throw new ValidationError("Send one serving amount per food.");
    for (const value of servings) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10 || Math.round(value * 2) !== value * 2) {
        throw new ValidationError("Servings go in steps of 0.5, from 0 to 10.");
      }
    }
    if (servings.every((v) => v === 0)) throw new ValidationError("Keep at least one food to log the meal.");
  }
  return { date, servings, again: body.again === undefined ? false : bool(body.again, "again") };
}

function validateDoneBody(body) {
  requireObject(body, "request");
  rejectUnknownKeys(body, ["date"], "The request");
  return { date: isoDate(body.date, "The date") };
}

// ---- workout plan ------------------------------------------------------------------------

function validateSet(set, label) {
  requireObject(set, "set");
  rejectUnknownKeys(set, ["reps", "durationSec"], label);
  const hasReps = set.reps !== undefined && set.reps !== null;
  const hasTime = set.durationSec !== undefined && set.durationSec !== null;
  if (hasReps === hasTime) throw new ValidationError(`${label}: give reps or a duration, not both.`);
  return hasReps ? { reps: wholeNumber(set.reps, `${label} reps`, 1, limits.repsMax) } : { durationSec: wholeNumber(set.durationSec, `${label} seconds`, 5, limits.durationMax) };
}

function validateWorkoutPlan(body) {
  requireObject(body, "workout");
  rejectUnknownKeys(body, ["name", "goal", "level", "note", "days"], "The workout");
  const days = list(body.days, "Days", 7).map((day, d) => {
    requireObject(day, "day");
    rejectUnknownKeys(day, ["weekday", "title", "sessionType", "exercises"], `Day ${d + 1}`);
    const exercises = list(day.exercises, `Day ${d + 1} exercises`, limits.exercisesPerDay).map((e, i) => {
      const label = `Day ${d + 1}, exercise ${i + 1}`;
      requireObject(e, "exercise");
      rejectUnknownKeys(e, ["exerciseId", "section", "role", "sets", "restSec", "repsMin", "repsMax", "note"], label);
      const sets = list(e.sets, `${label} sets`, limits.setsPerExercise).map((set, s) => validateSet(set, `${label}, set ${s + 1}`));
      if (sets.length === 0) throw new ValidationError(`${label} needs at least one set.`);
      const repsMin = e.repsMin === undefined || e.repsMin === null ? null : wholeNumber(e.repsMin, `${label} reps from`, 1, limits.repsMax);
      const repsMax = e.repsMax === undefined || e.repsMax === null ? null : wholeNumber(e.repsMax, `${label} reps to`, 1, limits.repsMax);
      if (repsMin !== null && repsMax !== null && repsMax < repsMin) throw new ValidationError(`${label}: reps to must be at least reps from.`);
      return {
        exerciseId: id(e.exerciseId, `${label} exercise`),
        section: e.section === undefined ? "workout" : oneOf(e.section, SECTIONS, `${label} section`),
        role: e.role === undefined || e.role === null ? null : oneOf(e.role, ROLES, `${label} role`),
        sets,
        restSec: e.restSec === undefined ? 60 : wholeNumber(e.restSec, `${label} rest`, 0, limits.restMax),
        repsMin,
        repsMax,
        note: optionalText(e.note, `${label} note`, limits.exerciseNote),
      };
    });
    if (exercises.length === 0) throw new ValidationError(`Day ${d + 1} needs at least one exercise.`);
    return {
      weekday: wholeNumber(day.weekday, `Day ${d + 1} weekday`, 0, 6),
      title: text(day.title, `Day ${d + 1} title`, { max: limits.dayTitle }),
      sessionType: day.sessionType === undefined || day.sessionType === null ? null : oneOf(day.sessionType, SESSION_TYPES, `Day ${d + 1} session type`),
      exercises,
    };
  });
  if (days.length === 0) throw new ValidationError("A workout needs at least one training day.");
  const weekdays = days.map((d) => d.weekday);
  if (new Set(weekdays).size !== weekdays.length) throw new ValidationError("Each weekday can be used once.");
  days.sort((a, b) => a.weekday - b.weekday);
  return {
    name: text(body.name, "Workout name", { max: limits.workoutName }),
    goal: oneOf(body.goal, WORKOUT_GOALS, "Goal"),
    level: oneOf(body.level, LEVELS, "Level"),
    note: optionalText(body.note, "Note to the member", limits.note),
    days,
  };
}

module.exports = {
  limits, SPECIALTIES, COACHING_MODES, PLAN_GOALS, MEAL_SLOTS, WORKOUT_GOALS, LEVELS,
  validateTrainerProfile, discoveryQuery, validateRecommendation, validateDietPlan, validatePlanLog, validateDoneBody, validateWorkoutPlan,
};
