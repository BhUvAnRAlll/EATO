// The Macro tab's Water screen: a day's water entries against an estimated target, and the
// reminder settings. The target comes from the app's own calculator (30 ml per kg plus extra
// for the activity level, the same rule the app shows elsewhere) and is written once, on the
// first glass of the day, so a day the member already saw keeps the target it showed. Only
// today can be changed; every entry belongs to the verified member and is only ever read or
// removed by them.
const nutrition = require("../../JustFit_client/src/lib/nutrition/index.ts");
const { NotFoundError } = require("../community/posts");
const { ValidationError } = require("../profile");
const { isoDate, isNearToday } = require("./validate");

const CALC_VERSION = nutrition.calculatorConfig.version;
const FALLBACK_WEIGHT_KG = 70;
const ENTRIES_PER_DAY = 60;
const SOURCES = ["quick_add", "custom"]; // "workout" is reserved for a future workout feature
const DEFAULT_PREFERENCES = { remindersEnabled: true, intervalHours: 2, startHour: 8, endHour: 20 };

const parseJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);

// Today's estimate from the profile. A thin profile falls back to 70 kg and says so; a health
// flag means "follow your doctor's advice" (the calculator gives no number then), but a
// reference figure is still kept so the day row can be written.
async function estimate(pool, userId) {
  const [[profile]] = await pool.query("SELECT weight_kg, activity, health_flags FROM profiles WHERE user_id = ?", [userId]);
  const weightKg = profile?.weight_kg ? Number(profile.weight_kg) : null;
  const activityLevel = profile?.activity ?? "sedentary";
  const healthFlags = parseJson(profile?.health_flags) ?? [];
  const usedFallbacks = weightKg === null || !profile?.activity;
  const weight = weightKg ?? FALLBACK_WEIGHT_KG;
  const { water } = nutrition.calculatorConfig;
  const baseTargetMl = Math.round(weight * water.mlPerKg);
  const activityAdjustmentMl = water.extraMlByActivity[activityLevel] ?? 0;
  const advice = nutrition.waterRecommendation({ weightKg: weight, activityLevel, healthFlags });
  const targetMl = advice.status === "ok" ? Math.round(advice.drinkingWaterL * 1000) : Math.round((baseTargetMl + activityAdjustmentMl) / 100) * 100;
  return { targetMl, baseTargetMl, activityAdjustmentMl, usedFallbacks, medicalNote: advice.status === "ok" ? null : advice.note };
}

function preferencesFrom(row) {
  return row
    ? { remindersEnabled: Boolean(row.reminders_enabled), intervalHours: row.interval_hours, startHour: row.start_hour, endHour: row.end_hour }
    : { ...DEFAULT_PREFERENCES };
}

async function day(pool, userId, date) {
  const [[dayRow], [entries], [[prefRow]], fresh] = await Promise.all([
    pool.query("SELECT target_ml, base_target_ml, activity_adjustment_ml, workout_adjustment_ml, workout_minutes, used_fallbacks FROM macro_hydration_days WHERE user_id = ? AND log_date = ?", [userId, date]).then(([rows]) => rows),
    pool.query("SELECT id, amount_ml, logged_at, source, label FROM macro_water_logs WHERE user_id = ? AND log_date = ? ORDER BY logged_at DESC, id DESC", [userId, date]),
    pool.query("SELECT reminders_enabled, interval_hours, start_hour, end_hour FROM macro_hydration_preferences WHERE user_id = ?", [userId]),
    estimate(pool, userId),
  ]);
  // A stored day keeps the target it showed; a day with nothing logged shows today's estimate
  const target = dayRow
    ? { targetMl: dayRow.target_ml, baseTargetMl: dayRow.base_target_ml, activityAdjustmentMl: dayRow.activity_adjustment_ml, usedFallbacks: Boolean(dayRow.used_fallbacks) }
    : fresh;
  const consumedMl = entries.reduce((sum, e) => sum + e.amount_ml, 0);
  return {
    date,
    targetMl: target.targetMl,
    baseTargetMl: target.baseTargetMl,
    activityAdjustmentMl: target.activityAdjustmentMl,
    workoutAdjustmentMl: dayRow?.workout_adjustment_ml ?? 0,
    workoutMinutes: dayRow?.workout_minutes ?? null,
    consumedMl,
    remainingMl: Math.max(0, target.targetMl - consumedMl),
    progress: target.targetMl > 0 ? Math.round((consumedMl / target.targetMl) * 1000) / 1000 : 0,
    usedFallbacks: target.usedFallbacks,
    medicalNote: fresh.medicalNote,
    entries: entries.map((e) => ({ id: e.id, amountMl: e.amount_ml, loggedAt: new Date(e.logged_at).toISOString(), source: e.source, label: e.label })),
    preferences: preferencesFrom(prefRow),
  };
}

function validateLog(body, now) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the entry as an object.");
  for (const key of Object.keys(body)) if (!["date", "amountMl", "source", "label"].includes(key)) throw new ValidationError(`The entry has an unexpected field: ${key}.`);
  const date = isoDate(body.date);
  if (!isNearToday(date, now)) throw new ValidationError("Water can only be logged for today");
  if (typeof body.amountMl !== "number" || !Number.isFinite(body.amountMl)) throw new ValidationError("Choose how much water.");
  const amountMl = Math.min(3000, Math.max(10, Math.round(body.amountMl)));
  const source = body.source === undefined ? "quick_add" : body.source;
  if (!SOURCES.includes(source)) throw new ValidationError("The entry source isn't valid.");
  let label = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string") throw new ValidationError("The label must be text.");
    // eslint-disable-next-line no-control-regex
    label = body.label.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 40) || null;
  }
  return { date, amountMl, source, label };
}

// One transaction: the day row (written once, holding that day's target), the entry, and the
// consumed cache. The day row is locked so two quick taps can't both slip under the cap.
async function logWater(pool, userId, body, now) {
  const entry = validateLog(body, now);
  const target = await estimate(pool, userId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT IGNORE INTO macro_hydration_days (user_id, log_date, target_ml, base_target_ml, activity_adjustment_ml, used_fallbacks, calc_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, entry.date, target.targetMl, target.baseTargetMl, target.activityAdjustmentMl, target.usedFallbacks, CALC_VERSION],
    );
    await connection.query("SELECT 1 FROM macro_hydration_days WHERE user_id = ? AND log_date = ? FOR UPDATE", [userId, entry.date]);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM macro_water_logs WHERE user_id = ? AND log_date = ?", [userId, entry.date]);
    if (n >= ENTRIES_PER_DAY) throw new ValidationError("Too many entries logged for one day");
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO macro_water_logs (id, user_id, log_date, amount_ml, source, label) VALUES (?, ?, ?, ?, ?, ?)", [id, userId, entry.date, entry.amountMl, entry.source, entry.label]);
    await refreshCache(connection, userId, entry.date);
    await connection.commit();
    return { entryId: id, amountMl: entry.amountMl };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function refreshCache(connection, userId, date) {
  await connection.query(
    "UPDATE macro_hydration_days SET consumed_ml = (SELECT COALESCE(SUM(amount_ml), 0) FROM macro_water_logs WHERE user_id = ? AND log_date = ?) WHERE user_id = ? AND log_date = ?",
    [userId, date, userId, date],
  );
}

// Removes the member's own entry from today. Someone else's, or a missing one, is "not found".
async function removeEntry(pool, userId, entryId, now) {
  const [[row]] = await pool.query("SELECT DATE_FORMAT(log_date, '%Y-%m-%d') AS d FROM macro_water_logs WHERE id = ? AND user_id = ?", [entryId, userId]);
  if (!row) throw new NotFoundError("Entry not found");
  if (!isNearToday(row.d, now)) throw new ValidationError("Water can only be changed for today");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM macro_water_logs WHERE id = ? AND user_id = ?", [entryId, userId]);
    await refreshCache(connection, userId, row.d);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { removed: true };
}

// { remindersEnabled, intervalHours?, startHour?, endHour? }: missing values keep what is saved
async function setReminders(pool, userId, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the settings as an object.");
  for (const key of Object.keys(body)) if (!["remindersEnabled", "intervalHours", "startHour", "endHour"].includes(key)) throw new ValidationError(`The settings have an unexpected field: ${key}.`);
  if (typeof body.remindersEnabled !== "boolean") throw new ValidationError("remindersEnabled must be true or false.");
  const [[current]] = await pool.query("SELECT reminders_enabled, interval_hours, start_hour, end_hour FROM macro_hydration_preferences WHERE user_id = ?", [userId]);
  const merged = { ...preferencesFrom(current), remindersEnabled: body.remindersEnabled };
  const whole = (value, what, min, max) => {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${what} must be a number.`);
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  merged.intervalHours = whole(body.intervalHours, "intervalHours", 1, 12) ?? merged.intervalHours;
  merged.startHour = whole(body.startHour, "startHour", 0, 23) ?? merged.startHour;
  merged.endHour = whole(body.endHour, "endHour", 0, 23) ?? merged.endHour;
  if (merged.endHour <= merged.startHour) throw new ValidationError("Reminder window must end after it starts");
  await pool.query(
    `INSERT INTO macro_hydration_preferences (user_id, reminders_enabled, interval_hours, start_hour, end_hour) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reminders_enabled = VALUES(reminders_enabled), interval_hours = VALUES(interval_hours), start_hour = VALUES(start_hour), end_hour = VALUES(end_hour)`,
    [userId, merged.remindersEnabled, merged.intervalHours, merged.startHour, merged.endHour],
  );
  return { preferences: merged };
}

module.exports = { day, logWater, removeEntry, setReminders, validateLog, ENTRIES_PER_DAY };
