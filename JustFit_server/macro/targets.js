// The Macro tab's "Adjust targets": read the member's daily target, set it by hand, or go
// back to the calculated one. The rules are the app's own calculator (the same file the app
// and profile.js use), so a target can never be saved here that the app wouldn't allow:
// 1000–5000 kcal. Only the verified member's
// own row is ever read or written; nobody can change someone else's target.
const nutrition = require("../../JustFit_client/src/lib/nutrition/index.ts");
const { ValidationError, loadProfile } = require("../profile");

const MACRO_MAX_G = 600;
const REASON = "Set on the Macro tab";

// What the screen needs: the active numbers, where they came from, and what it may do
function toStatus(record) {
  const { calories, macros, source } = record.active;
  return {
    status: "ready",
    kcal: calories,
    proteinG: macros.proteinG,
    carbsG: macros.carbsG,
    fatG: macros.fatG,
    source,
    isManual: source === "user_adjusted",
    canReset: source === "user_adjusted" && record.calculated !== null,
    calculated: record.calculated
      ? { kcal: record.calculated.displayCalories, proteinG: record.calculated.macros.proteinG, carbsG: record.calculated.macros.carbsG, fatG: record.calculated.macros.fatG }
      : null,
    updatedAt: record.active.updatedAt,
  };
}

// The member's saved target record, or null when setup never produced one the calculator can
// work with (it needs at least the weight and the goal to split calories into macros)
async function recordFor(pool, userId) {
  const { nutrition: record } = await loadProfile(pool, userId);
  const usable = record && record.inputs && typeof record.inputs.weightKg === "number" && typeof record.inputs.fitnessGoal === "string";
  return usable ? record : null;
}

async function status(pool, userId) {
  const record = await recordFor(pool, userId);
  return record ? toStatus(record) : { status: "incomplete" };
}

// { kcal, proteinG?, carbsG?, fatG? }: a macro that is left out is split from the calories
// for the member's goal (the calculator's rule); one that is sent is used as typed
function validateManual(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the targets as an object.");
  for (const key of Object.keys(body)) {
    if (!["kcal", "proteinG", "carbsG", "fatG"].includes(key)) throw new ValidationError(`The targets have an unexpected field: ${key}.`);
  }
  if (typeof body.kcal !== "number" || !Number.isFinite(body.kcal)) throw new ValidationError("Enter your daily calories.");
  const grams = {};
  for (const key of ["proteinG", "carbsG", "fatG"]) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MACRO_MAX_G) throw new ValidationError("Macro grams out of range");
    grams[key] = Math.round(value);
  }
  return { kcal: Math.round(body.kcal), grams };
}

// How far typed macros may add up from the calories (4 kcal a gram of protein or carbs, 9 of fat)
const MACRO_TOLERANCE = 0.1;
const KCAL_PER_G = { proteinG: 4, carbsG: 4, fatG: 9 };
const kcalOf = (macros) => Object.entries(macros).reduce((sum, [key, g]) => sum + g * KCAL_PER_G[key], 0);

/**
 * The macros for `kcal` when the member typed some of them (`typed`): the typed grams stay, and
 * the calories left over are shared by the others in the goal split's proportions (`split`, the
 * calculator's macros for these calories). Throws a ValidationError when the typed grams alone
 * come to more than the calories, or all three are typed and don't add up to them (10% either way).
 */
function rebalance(split, typed, kcal) {
  const keys = ["proteinG", "carbsG", "fatG"];
  const typedKcal = kcalOf(typed);
  const open = keys.filter((key) => typed[key] === undefined);
  if (open.length === 0) {
    if (Math.abs(typedKcal - kcal) > kcal * MACRO_TOLERANCE) {
      throw new ValidationError(`Your macros add up to ${Math.round(typedKcal)} kcal, not ${kcal}. Change the calories or leave one macro empty to fill itself in.`);
    }
    return { ...typed };
  }
  if (typedKcal > kcal * (1 + MACRO_TOLERANCE)) {
    throw new ValidationError(`Those macros alone come to ${Math.round(typedKcal)} kcal, more than your ${kcal} kcal target.`);
  }
  const left = Math.max(0, kcal - typedKcal);
  const share = kcalOf(Object.fromEntries(open.map((key) => [key, split[key]])));
  const result = { ...typed };
  for (const key of open) {
    const part = share > 0 ? (split[key] * KCAL_PER_G[key]) / share : 1 / open.length;
    result[key] = Math.round((left * part) / KCAL_PER_G[key]);
  }
  return result;
}

async function save(pool, userId, record) {
  const { calories, macros, source, reason } = record.active;
  await pool.query(
    "UPDATE nutrition_targets SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, source = ?, reason = ?, set_by = ? WHERE user_id = ?",
    [calories, macros.proteinG, macros.carbsG, macros.fatG, source, source === "calculated" ? null : reason ?? null, source === "calculated" ? null : userId, userId],
  );
}

async function setManual(pool, userId, body) {
  const { kcal, grams } = validateManual(body);
  const record = await recordFor(pool, userId);
  if (!record) throw new ValidationError("Complete your profile before adjusting targets");
  const result = nutrition.applyUserAdjustment(record, kcal, REASON, userId);
  if (!result.ok) throw new ValidationError(result.error);
  // Typed macros replace the goal split; the rest share what's left of the calories
  result.record.active.macros = rebalance(result.record.active.macros, grams, kcal);
  await save(pool, userId, result.record);
  return toStatus(result.record);
}

async function reset(pool, userId) {
  const record = await recordFor(pool, userId);
  if (!record) throw new ValidationError("Complete your profile before adjusting targets");
  const result = nutrition.resetToCalculated(record);
  if (!result.ok) throw new ValidationError(result.error);
  await save(pool, userId, result.record);
  return toStatus(result.record);
}

module.exports = { status, setManual, reset, validateManual, rebalance, recordFor, save };
