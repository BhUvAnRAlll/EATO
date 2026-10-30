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
  // Typed macros replace the goal split; the rest keep it
  result.record.active.macros = { ...result.record.active.macros, ...grams };
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

module.exports = { status, setManual, reset, validateManual, recordFor, save };
