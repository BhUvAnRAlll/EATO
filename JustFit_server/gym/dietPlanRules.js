// Trainer diet plans (pure, unit-tested; 2026-11-10, the user's request). A gym trainer writes one
// day of meals for a PT client and may recommend justFit menu meals for the meal times justFit
// delivers (breakfast, lunch, dinner), so the member can order them. These rules decide what a plan
// may hold and which menu meals suit a member: never a meal that breaks their diet or names one of
// their allergies. The member's own food answers decide that on their screen; the trainer is told
// about them only when the member has chosen to share.
const { ValidationError } = require("../profile");

const SLOTS = [
  { id: "breakfast", label: "Breakfast", orderable: true },
  { id: "mid_morning", label: "Mid-morning", orderable: false },
  { id: "lunch", label: "Lunch", orderable: true },
  { id: "evening", label: "Evening snack", orderable: false },
  { id: "dinner", label: "Dinner", orderable: true },
];
const SLOT_IDS = SLOTS.map((s) => s.id);
const ORDERABLE = new Set(SLOTS.filter((s) => s.orderable).map((s) => s.id));
const MAX_MEALS = 8;
const MAX_PICKS = 3;
const NOTE_MAX = 300;
const FOOD_MIN = 2;
const FOOD_MAX = 160;

const DIET_LABEL = { vegetarian: "vegetarian", vegan: "vegan", eggetarian: "egg and veg", "non-vegetarian": "non-veg" };

const CONTROL = /[\u0000-\u001f\u007f]/;
const MEAL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (obj, keys, message) => {
  if (Object.keys(obj).some((k) => !keys.includes(k))) throw new ValidationError(message);
};
const cleanText = (value, { min, max, what }) => {
  if (typeof value !== "string") throw new ValidationError(`Write ${what}.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (CONTROL.test(value)) throw new ValidationError(`${what[0].toUpperCase()}${what.slice(1)} has characters we can't save.`);
  if (text.length < min || text.length > max) throw new ValidationError(`Keep ${what} between ${min} and ${max} characters.`);
  return text;
};
const optionalNumber = (value, max, what) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw new ValidationError(`${what} must be a whole number from 0 to ${max}.`);
  return value;
};

/** PUT /api/trainer/clients/:id/diet-plan { note?, meals: [{ slot, time?, food, kcal?, proteinG?, picks? }] } */
function planBody(body) {
  if (!isObject(body)) throw new ValidationError("Send the diet plan as { note, meals }.");
  only(body, ["note", "meals"], "Send only the note and the meals.");
  const note = body.note === undefined || body.note === null || body.note === "" ? null : cleanText(body.note, { min: 1, max: NOTE_MAX, what: "the note" });
  if (!Array.isArray(body.meals) || body.meals.length === 0) throw new ValidationError("Add at least one meal.");
  if (body.meals.length > MAX_MEALS) throw new ValidationError(`A day has at most ${MAX_MEALS} meals.`);
  const meals = body.meals.map((meal, i) => {
    const which = `Meal ${i + 1}`;
    if (!isObject(meal)) throw new ValidationError(`${which} isn't a meal.`);
    only(meal, ["slot", "time", "food", "kcal", "proteinG", "picks"], `${which} has fields we don't take.`);
    if (!SLOT_IDS.includes(meal.slot)) throw new ValidationError(`${which}: pick a meal time from the list.`);
    const time = meal.time === undefined || meal.time === null || meal.time === "" ? null : meal.time;
    if (time !== null && (typeof time !== "string" || !TIME.test(time))) throw new ValidationError(`${which}: write the time as HH:MM.`);
    const picks = meal.picks === undefined || meal.picks === null ? [] : meal.picks;
    if (!Array.isArray(picks) || picks.some((p) => typeof p !== "string" || !MEAL_ID.test(p))) throw new ValidationError(`${which}: pick justFit meals from the menu.`);
    if (new Set(picks).size !== picks.length) throw new ValidationError(`${which}: each justFit meal once.`);
    if (picks.length > MAX_PICKS) throw new ValidationError(`${which}: recommend at most ${MAX_PICKS} justFit meals.`);
    if (picks.length > 0 && !ORDERABLE.has(meal.slot)) throw new ValidationError(`${which}: justFit delivers breakfast, lunch and dinner only.`);
    return {
      slot: meal.slot,
      time,
      food: cleanText(meal.food, { min: FOOD_MIN, max: FOOD_MAX, what: `${which.toLowerCase()}'s food` }),
      kcal: optionalNumber(meal.kcal, 3000, `${which}'s kcal`),
      proteinG: optionalNumber(meal.proteinG, 300, `${which}'s protein`),
      picks,
    };
  });
  // In the order of the day: by time where given, else by meal time
  const order = (m) => [m.time ?? "", SLOT_IDS.indexOf(m.slot)];
  meals.sort((a, b) => {
    const [ta, sa] = order(a);
    const [tb, sb] = order(b);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    return sa - sb;
  });
  return { note, meals };
}

/** The stored meals (JSON) as a list, tolerating a string or anything unexpected */
function readMeals(value) {
  let list = value;
  try {
    if (typeof value === "string") list = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(list) ? list.filter((m) => isObject(m) && SLOT_IDS.includes(m.slot) && typeof m.food === "string") : [];
}

/** PUT /api/membership/food-sharing { shared } */
function sharingBody(body) {
  if (!isObject(body) || Object.keys(body).some((k) => k !== "shared") || typeof body.shared !== "boolean") throw new ValidationError("Send { shared: true } or { shared: false }.");
  return body.shared;
}

// The diet and allergy check is the app's own (lib/mealMatch.ts), loaded like the nutrition
// calculator so the trainer's picker, the server and the member's screen agree word for word
const match = require("../../JustFit_client/src/lib/mealMatch.ts");

/**
 * What a trainer is told about a menu meal for a client who shares their food answers: `problem`
 * (can't be picked: "Not vegetarian", "Has peanuts (allergy)") or `warning` (a dislike), else null.
 */
function pickCheck(meal, food) {
  const { block, warn } = match.mealConflict(meal, food);
  if (block === "diet") return { problem: `Not ${DIET_LABEL[food.diet] ?? "their diet"}`, warning: null };
  if (block) return { problem: `Has ${block.slice("allergy:".length)} (allergy)`, warning: null };
  return { problem: null, warning: warn ? `Has ${warn}, which they don't like` : null };
}

module.exports = { SLOTS, SLOT_IDS, MAX_MEALS, MAX_PICKS, NOTE_MAX, planBody, readMeals, sharingBody, pickCheck, mealConflict: match.mealConflict };
