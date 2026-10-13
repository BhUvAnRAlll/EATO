// Profile persistence: validates what the setup screens send and writes it to
// users, profiles, body_composition_reports and nutrition_targets in one transaction.
//
// The nutrition record is re-checked with the app's own calculator
// (Eato_client/src/lib/nutrition), loaded straight from the client's TypeScript source.
// Node 24 strips the types at load time, which prints two one-off warnings at startup
// ("Type Stripping is an experimental feature", "Module type ... is not specified").
// Both are harmless. The server therefore depends on the client folder sitting next
// to it, as it does in this repository.
const { randomUUID } = require("node:crypto");
const nutrition = require("../Eato_client/src/lib/nutrition/index.ts");
const { parseDob, ageFromDob } = require("../Eato_client/src/lib/date.ts");

// Allowed values, exactly as the MySQL ENUM columns define them
const GENDERS = ["male", "female", "other", "unspecified"];
const GOALS = ["fat_loss", "maintenance", "muscle_gain", "healthy_eating"];
const ACTIVITIES = ["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"];
const HEALTH_FLAGS = ["pregnant", "breastfeeding", "medical_condition", "eating_disorder"];
const DIETS = ["vegetarian", "non-vegetarian", "eggetarian", "vegan"];
const WORKOUT_FREQUENCIES = ["1-2", "3-4", "5-6", "7"];
const WORKOUT_TYPES = ["gym", "home", "cardio", "other"];
const WORKOUT_TIMES = ["morning", "afternoon", "evening"];
const MEALS_PER_DAY = ["3", "4", "5", "6+"];
const TARGET_SOURCES = ["calculated", "user_adjusted", "trainer_adjusted"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// "" or null → null; otherwise must be one of the allowed values
function enumOrNull(value, allowed, label) {
  if (value === null || value === undefined || value === "") return null;
  if (!allowed.includes(value)) throw new ValidationError(`${label} isn't a valid choice.`);
  return value;
}

function text(value, label, max) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return trimmed;
}

function stringList(value, label, maxItems, maxLength) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be a list.`);
  }
  if (value.length > maxItems) throw new ValidationError(`Too many ${label.toLowerCase()}.`);
  return value.map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= maxLength);
}

function numberFrom(value, label) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new ValidationError(`${label} is required.`);
  return n;
}

const toYmd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// Checks the setup answers and the nutrition record together. Returns clean rows for
// each table, or throws a ValidationError with one friendly line.
function validateProfileSubmission(body, userId) {
  if (!isPlainObject(body) || !isPlainObject(body.profile) || !isPlainObject(body.nutrition)) {
    throw new ValidationError("Send the profile as { profile, nutrition }.");
  }
  const { profile } = body;

  // The nutrition record: inputs, calculation and active target must agree, as the app's
  // own verifier checks (it re-runs the calculation from the saved inputs).
  const verified = nutrition.verifyStoredRecord(body.nutrition);
  if (!verified.ok) {
    throw new ValidationError(
      "stale" in verified ? "Your targets were made with an older version. Please recalculate." : verified.error,
    );
  }
  const record = verified.record;
  if (!TARGET_SOURCES.includes(record.active.source)) throw new ValidationError("Unknown target source.");
  if (record.active.source === "trainer_adjusted") {
    throw new ValidationError("A trainer's target can't be saved from profile setup.");
  }
  if (typeof record.formula !== "string" || record.formula.length > 40) throw new ValidationError("Unknown formula.");
  if (typeof record.configVersion !== "string" || record.configVersion.length > 20) throw new ValidationError("Unknown config version.");
  const calculatedAt = new Date(record.calculatedAt);
  if (Number.isNaN(calculatedAt.getTime())) throw new ValidationError("The calculation date isn't valid.");
  for (const key of ["proteinG", "carbsG", "fatG"]) {
    const grams = record.active.macros[key];
    if (!Number.isInteger(grams) || grams < 0 || grams > 65535) throw new ValidationError("Macros are out of range.");
  }
  if (!Number.isInteger(record.active.calories)) throw new ValidationError("Calories must be a whole number.");

  // Personal details
  const fullName = text(profile.fullName, "Name", 120);
  if (fullName.length < 2) throw new ValidationError("Please enter your name.");
  const dobDate = typeof profile.dob === "string" ? parseDob(profile.dob) : null;
  if (!dobDate) throw new ValidationError("Date of birth must be DD/MM/YYYY.");
  const ageFromBirth = ageFromDob(profile.dob);
  if (ageFromBirth === null || ageFromBirth < 13 || ageFromBirth > 120) throw new ValidationError("Date of birth is out of range.");
  if (Math.abs(ageFromBirth - record.inputs.age) > 1) throw new ValidationError("Age doesn't match the date of birth.");
  const phone = text(profile.phone, "Phone", 10);
  if (phone !== "" && !/^[0-9]{10}$/.test(phone)) throw new ValidationError("Phone number must be 10 digits.");

  // Body: the profile's numbers must be the ones the targets were calculated from
  const heightCm = numberFrom(profile.heightCm, "Height");
  const weightKg = numberFrom(profile.weightKg, "Weight");
  if (heightCm !== record.inputs.heightCm || weightKg !== record.inputs.weightKg) {
    throw new ValidationError("Height and weight don't match the calculated targets.");
  }
  const gender = enumOrNull(profile.gender, GENDERS, "Gender");
  if (gender !== record.inputs.gender) throw new ValidationError("Gender doesn't match the calculated targets.");
  let bodyFatPercent = null;
  if (profile.bodyFatPercent !== undefined && profile.bodyFatPercent !== null && profile.bodyFatPercent !== "") {
    bodyFatPercent = numberFrom(profile.bodyFatPercent, "Body fat");
    if (bodyFatPercent < 2 || bodyFatPercent > 75) throw new ValidationError("Body fat % must be between 2 and 75.");
  }
  const goal = enumOrNull(profile.goal, GOALS, "Goal");
  if (goal !== record.inputs.fitnessGoal) throw new ValidationError("Goal doesn't match the calculated targets.");
  const activity = enumOrNull(profile.activity, ACTIVITIES, "Activity level");
  if (activity !== record.inputs.activityLevel) throw new ValidationError("Activity level doesn't match the calculated targets.");
  const healthFlags = stringList(profile.healthFlags, "Health considerations", HEALTH_FLAGS.length, 40);
  if (healthFlags.some((flag) => !HEALTH_FLAGS.includes(flag))) throw new ValidationError("Unknown health consideration.");

  // Food and lifestyle
  const diet = enumOrNull(profile.diet, DIETS, "Diet");
  const cuisines = stringList(profile.cuisines, "Cuisines", 20, 40);
  const dislikes = text(profile.dislikes, "Dislikes", 500);
  const allergies = text(profile.allergies, "Allergies", 500);
  const workoutFrequency = enumOrNull(profile.workoutFrequency, WORKOUT_FREQUENCIES, "Workout frequency");
  const workoutType = enumOrNull(profile.workoutType, WORKOUT_TYPES, "Workout type");
  const workoutTime = enumOrNull(profile.workoutTime, WORKOUT_TIMES, "Workout time");
  const mealsPerDay = enumOrNull(profile.mealsPerDay, MEALS_PER_DAY, "Meals per day");

  // A confirmed, uploaded report is stored as its own row (manual body-fat entries aren't:
  // they have no measured values of their own beyond what the inputs already keep)
  const bodyComposition = record.inputs.bodyComposition;
  let report = null;
  if (isPlainObject(bodyComposition) && bodyComposition.source === "upload" && bodyComposition.confirmed === true) {
    if (typeof bodyComposition.id !== "string" || !UUID.test(bodyComposition.id)) {
      throw new ValidationError("The report id isn't valid.");
    }
    const testDate = typeof bodyComposition.testDate === "string" && ISO_DATE.test(bodyComposition.testDate) ? bodyComposition.testDate : null;
    const confirmedAt = typeof bodyComposition.confirmedAt === "string" ? new Date(bodyComposition.confirmedAt) : new Date(NaN);
    const decimal = (value, label, min, max) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new ValidationError(`${label} on the report is out of range.`);
      return Math.round(value * 10) / 10;
    };
    report = {
      id: bodyComposition.id.toLowerCase(),
      format: bodyComposition.format === "inbody" ? "inbody" : null,
      testDate,
      heightCm: decimal(bodyComposition.heightCm, "Height", 50, 300),
      age: bodyComposition.age === null || bodyComposition.age === undefined ? null : Number.isInteger(bodyComposition.age) && bodyComposition.age >= 0 && bodyComposition.age <= 255 ? bodyComposition.age : (() => { throw new ValidationError("Age on the report is out of range."); })(),
      gender: enumOrNull(bodyComposition.gender, ["male", "female"], "Report gender"),
      weightKg: decimal(bodyComposition.weightKg, "Weight", 10, 500),
      bodyFatMassKg: decimal(bodyComposition.bodyFatMassKg, "Body fat mass", 0, 500),
      percentBodyFat: decimal(bodyComposition.percentBodyFat, "Body fat %", 0, 100),
      fatFreeMassKg: decimal(bodyComposition.fatFreeMassKg, "Fat-free mass", 0, 500),
      skeletalMuscleMassKg: decimal(bodyComposition.skeletalMuscleMassKg, "Skeletal muscle mass", 0, 500),
      printedBmrKcal: bodyComposition.printedBmrKcal === null || bodyComposition.printedBmrKcal === undefined ? null : Number.isInteger(bodyComposition.printedBmrKcal) && bodyComposition.printedBmrKcal >= 0 && bodyComposition.printedBmrKcal <= 65535 ? bodyComposition.printedBmrKcal : (() => { throw new ValidationError("Printed BMR on the report is out of range."); })(),
      confirmedAt: Number.isNaN(confirmedAt.getTime()) ? new Date() : confirmedAt,
    };
  }
  // Only link a report the calculation actually used, and only one we're storing
  const usedReportId = record.calculated?.report?.id ?? null;
  const reportId = report && usedReportId && usedReportId.toLowerCase() === report.id ? report.id : null;

  return {
    user: { fullName, phone: phone || null },
    profile: {
      dob: toYmd(dobDate),
      gender,
      goal,
      heightCm,
      weightKg,
      bodyFatPercent,
      activity,
      healthFlags,
      diet,
      cuisines,
      dislikes: dislikes || null,
      allergies: allergies || null,
      workoutFrequency,
      workoutType,
      workoutTime,
      mealsPerDay,
    },
    report,
    targets: {
      formula: record.formula,
      configVersion: record.configVersion,
      rmrFormula: record.calculated?.rmrFormula ?? null,
      reportId,
      inputs: record.inputs,
      calculated: record.calculated,
      calculatedAt,
      calories: record.active.calories,
      proteinG: record.active.macros.proteinG,
      carbsG: record.active.macros.carbsG,
      fatG: record.active.macros.fatG,
      source: record.active.source,
      reason: typeof record.active.reason === "string" ? record.active.reason.slice(0, 300) : null,
      // Who set a non-calculated target: always the verified caller, never the client's claim
      setBy: record.active.source === "calculated" ? null : userId,
    },
  };
}

// Writes everything in one transaction. Re-running with the same data is safe: every
// table is keyed by the user (or the report id), so rows are updated, not duplicated.
async function persistProfile(pool, userId, account, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO users (id, email, full_name, phone, role) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), phone = VALUES(phone), role = VALUES(role)`,
      [userId, account.email, data.user.fullName, data.user.phone, account.role],
    );

    const p = data.profile;
    await connection.query(
      `INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, body_fat_percent, activity, health_flags,
                             diet, cuisines, dislikes, allergies, workout_frequency, workout_type, workout_time, meals_per_day,
                             profile_complete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE dob = VALUES(dob), gender = VALUES(gender), goal = VALUES(goal), height_cm = VALUES(height_cm),
         weight_kg = VALUES(weight_kg), body_fat_percent = VALUES(body_fat_percent), activity = VALUES(activity),
         health_flags = VALUES(health_flags), diet = VALUES(diet), cuisines = VALUES(cuisines), dislikes = VALUES(dislikes),
         allergies = VALUES(allergies), workout_frequency = VALUES(workout_frequency), workout_type = VALUES(workout_type),
         workout_time = VALUES(workout_time), meals_per_day = VALUES(meals_per_day), profile_complete = TRUE`,
      [
        userId, p.dob, p.gender, p.goal, p.heightCm, p.weightKg, p.bodyFatPercent, p.activity, JSON.stringify(p.healthFlags),
        p.diet, JSON.stringify(p.cuisines), p.dislikes, p.allergies, p.workoutFrequency, p.workoutType, p.workoutTime, p.mealsPerDay,
      ],
    );

    if (data.report) {
      const r = data.report;
      // Ownership: a report id that already belongs to someone else is never relinked
      const [existing] = await connection.query("SELECT user_id FROM body_composition_reports WHERE id = ? FOR UPDATE", [r.id]);
      if (existing.length > 0 && existing[0].user_id !== userId) {
        throw new ValidationError("That report belongs to a different account.");
      }
      await connection.query(
        `INSERT INTO body_composition_reports (id, user_id, source, format, test_date, height_cm, age, gender, weight_kg,
                                               body_fat_mass_kg, percent_body_fat, fat_free_mass_kg, skeletal_muscle_mass_kg,
                                               printed_bmr_kcal, confirmed_at)
         VALUES (?, ?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE format = VALUES(format), test_date = VALUES(test_date), height_cm = VALUES(height_cm),
           age = VALUES(age), gender = VALUES(gender), weight_kg = VALUES(weight_kg), body_fat_mass_kg = VALUES(body_fat_mass_kg),
           percent_body_fat = VALUES(percent_body_fat), fat_free_mass_kg = VALUES(fat_free_mass_kg),
           skeletal_muscle_mass_kg = VALUES(skeletal_muscle_mass_kg), printed_bmr_kcal = VALUES(printed_bmr_kcal),
           confirmed_at = VALUES(confirmed_at)`,
        [
          r.id, userId, r.format, r.testDate, r.heightCm, r.age, r.gender, r.weightKg, r.bodyFatMassKg, r.percentBodyFat,
          r.fatFreeMassKg, r.skeletalMuscleMassKg, r.printedBmrKcal, r.confirmedAt,
        ],
      );
    }

    const t = data.targets;
    await connection.query(
      `INSERT INTO nutrition_targets (user_id, formula, config_version, rmr_formula, report_id, inputs, calculated, calculated_at,
                                      calories, protein_g, carbs_g, fat_g, source, reason, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE formula = VALUES(formula), config_version = VALUES(config_version), rmr_formula = VALUES(rmr_formula),
         report_id = VALUES(report_id), inputs = VALUES(inputs), calculated = VALUES(calculated), calculated_at = VALUES(calculated_at),
         calories = VALUES(calories), protein_g = VALUES(protein_g), carbs_g = VALUES(carbs_g), fat_g = VALUES(fat_g),
         source = VALUES(source), reason = VALUES(reason), set_by = VALUES(set_by)`,
      [
        userId, t.formula, t.configVersion, t.rmrFormula, t.reportId, JSON.stringify(t.inputs),
        t.calculated === null ? null : JSON.stringify(t.calculated), t.calculatedAt,
        t.calories, t.proteinG, t.carbsG, t.fatG, t.source, t.reason, t.setBy,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const parseJson = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

// The saved profile and target record for one user, in the shapes the app already uses.
// Both are null when the user hasn't finished setup.
async function loadProfile(pool, userId) {
  const [[userRow], [profileRow], [targetRow]] = await Promise.all([
    pool.query("SELECT email, full_name, phone, role FROM users WHERE id = ?", [userId]).then(([rows]) => rows),
    pool.query(
      `SELECT DATE_FORMAT(dob, '%Y-%m-%d') AS dob, gender, goal, height_cm, weight_kg, body_fat_percent, activity, health_flags,
              diet, cuisines, dislikes, allergies, workout_frequency, workout_type, workout_time, meals_per_day,
              profile_complete, updated_at
         FROM profiles WHERE user_id = ?`,
      [userId],
    ).then(([rows]) => rows),
    pool.query(
      `SELECT formula, config_version, rmr_formula, report_id, inputs, calculated, calculated_at, calories, protein_g, carbs_g,
              fat_g, source, reason, set_by, updated_at
         FROM nutrition_targets WHERE user_id = ?`,
      [userId],
    ).then(([rows]) => rows),
  ]);

  const profile = profileRow
    ? {
        fullName: userRow?.full_name ?? "",
        email: userRow?.email ?? "",
        phone: userRow?.phone ?? "",
        role: userRow?.role ?? "user",
        dob: profileRow.dob,
        gender: profileRow.gender,
        goal: profileRow.goal,
        heightCm: profileRow.height_cm,
        weightKg: profileRow.weight_kg,
        bodyFatPercent: profileRow.body_fat_percent,
        activity: profileRow.activity,
        healthFlags: parseJson(profileRow.health_flags) ?? [],
        diet: profileRow.diet,
        cuisines: parseJson(profileRow.cuisines) ?? [],
        dislikes: profileRow.dislikes ?? "",
        allergies: profileRow.allergies ?? "",
        workoutFrequency: profileRow.workout_frequency,
        workoutType: profileRow.workout_type,
        workoutTime: profileRow.workout_time,
        mealsPerDay: profileRow.meals_per_day,
        profileComplete: profileRow.profile_complete === 1 || profileRow.profile_complete === true,
        updatedAt: iso(profileRow.updated_at),
      }
    : null;

  const nutrition = targetRow
    ? {
        formula: targetRow.formula,
        configVersion: targetRow.config_version,
        calculatedAt: iso(targetRow.calculated_at),
        inputs: parseJson(targetRow.inputs),
        calculated: targetRow.calculated === null ? null : parseJson(targetRow.calculated),
        active: {
          calories: targetRow.calories,
          macros: { proteinG: targetRow.protein_g, carbsG: targetRow.carbs_g, fatG: targetRow.fat_g },
          source: targetRow.source,
          ...(targetRow.reason ? { reason: targetRow.reason } : {}),
          ...(targetRow.set_by ? { actor: targetRow.set_by } : {}),
          updatedAt: iso(targetRow.updated_at),
        },
      }
    : null;

  return { profile, nutrition };
}

module.exports = { ValidationError, validateProfileSubmission, persistProfile, loadProfile };
