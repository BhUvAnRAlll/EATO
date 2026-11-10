// Super Admin › Users › a member (2026-11-10, the user's request "display all fields and
// activity, super admin can view"): everything the member has told justFit (contact, personal
// details, goal, activity level, health ticks, food, targets, the AI Coach intake), their body
// scans, and what they have done lately (sign-ins, meals logged, workouts, orders, weigh-ins,
// coach messages: when, never the words). Admins only (requireAdmin); read only. Each admin's
// first look at a member in an hour is written to the admin log, since this is health data.
const { audit } = require("./overview");
const scanStore = require("../bodyComposition/scanStore");
const { NotFoundError } = require("../errors");

const ACTIVITY_LIMIT = 40;
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value ?? null);
const iso = (value) => (value ? new Date(value).toISOString() : null);
const num = (value) => (value === null || value === undefined ? null : Number(value));
const ymd = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A query on a table a later migration adds: null before it, so the page still opens
async function optional(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR" || error?.name === "NotReadyError") return null;
    throw error;
  }
}

function age(dob, today = new Date()) {
  const d = ymd(dob);
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  let years = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < day)) years -= 1;
  return years;
}

/** Everything about one member, for the Super Admin. Throws 404 for an unknown id. */
async function memberProfile(pool, userId) {
  const [[user]] = await pool.query("SELECT id, full_name, phone, email, role, created_at FROM users WHERE id = ?", [userId]);
  if (!user) throw new NotFoundError("That account doesn't exist.");
  const q = (sql, params = [userId]) => pool.query(sql, params).then(([rows]) => rows);

  const [profileRows, targetRows, coachRows, scans, lastSeen, meals, workouts, orders, weighIns, chats, signIns] = await Promise.all([
    q("SELECT * FROM profiles WHERE user_id = ?"),
    q("SELECT calories, protein_g, carbs_g, fat_g, source, rmr_formula, reason, updated_at FROM nutrition_targets WHERE user_id = ?"),
    optional(q("SELECT * FROM coach_profiles WHERE user_id = ?")),
    optional(scanStore.forUser(pool, userId)),
    q("SELECT MAX(COALESCE(last_used_at, created_at)) AS at FROM auth_sessions WHERE user_id = ?"),
    q(`SELECT title, slot, source, logged_at AS at FROM macro_meal_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT ${ACTIVITY_LIMIT}`),
    q(`SELECT status, on_date, COALESCE(completed_at, started_at) AS at FROM workout_logs WHERE user_id = ? ORDER BY started_at DESC LIMIT ${ACTIVITY_LIMIT}`),
    optional(q(`SELECT id, status, meal_slot, delivery_date, total_paise, created_at AS at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ${ACTIVITY_LIMIT}`)),
    q(`SELECT logged_on, weight_kg FROM weigh_ins WHERE user_id = ? ORDER BY logged_on DESC LIMIT ${ACTIVITY_LIMIT}`),
    optional(q(`SELECT created_at AS at FROM coach_chat_messages WHERE user_id = ? AND role = 'member' ORDER BY created_at DESC LIMIT ${ACTIVITY_LIMIT}`)),
    q(`SELECT created_at AS at FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ${ACTIVITY_LIMIT}`),
  ]);

  const p = profileRows[0] ?? null;
  const t = targetRows[0] ?? null;
  const c = coachRows?.[0] ?? null;

  const activity = [
    ...signIns.map((r) => ({ kind: "sign_in", at: iso(r.at), title: "Signed in" })),
    ...meals.map((r) => ({ kind: "meal", at: iso(r.at), title: `Logged ${r.title}`, detail: `${r.slot}${r.source === "manual" ? "" : ` · from ${r.source}`}` })),
    ...workouts.map((r) => ({ kind: "workout", at: iso(r.at), title: r.status === "completed" ? "Finished a workout" : r.status === "abandoned" ? "Stopped a workout" : "Started a workout", detail: ymd(r.on_date) })),
    ...(orders ?? []).map((r) => ({ kind: "order", at: iso(r.at), title: `Ordered ${r.meal_slot} for ${ymd(r.delivery_date)}`, detail: `₹${Math.round(Number(r.total_paise) / 100).toLocaleString("en-IN")} · ${r.status.replace(/_/g, " ")}` })),
    ...weighIns.map((r) => ({ kind: "weigh_in", at: `${ymd(r.logged_on)}T00:00:00.000Z`, title: `Weighed ${Number(r.weight_kg)} kg` })),
    ...(chats ?? []).map((r) => ({ kind: "coach_chat", at: iso(r.at), title: "Messaged the AI Coach" })),
    ...(scans ?? []).map((s) => ({ kind: "body_scan", at: s.at, title: `Body scan · ${s.bodyFatPercent}% body fat` })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, ACTIVITY_LIMIT);

  return {
    id: user.id,
    contact: { phone: user.phone ?? null, email: user.email ?? null },
    joinedAt: iso(user.created_at),
    lastActiveAt: iso(lastSeen[0]?.at),
    profile: p && {
      complete: Boolean(p.profile_complete),
      dob: ymd(p.dob),
      age: age(p.dob),
      gender: p.gender,
      heightCm: num(p.height_cm),
      weightKg: num(p.weight_kg),
      bodyFatPercent: num(p.body_fat_percent),
      goal: p.goal,
      activity: p.activity,
      healthFlags: json(p.health_flags) ?? [],
      diet: p.diet,
      cuisines: json(p.cuisines) ?? [],
      dislikes: p.dislikes,
      allergies: p.allergies,
      mealsPerDay: p.meals_per_day,
      workoutFrequency: p.workout_frequency,
      workoutType: p.workout_type,
      workoutTime: p.workout_time,
      updatedAt: iso(p.updated_at),
    },
    targets: t && {
      calories: Number(t.calories), proteinG: Number(t.protein_g), carbsG: Number(t.carbs_g), fatG: Number(t.fat_g),
      source: t.source, formula: t.rmr_formula, reason: t.reason, updatedAt: iso(t.updated_at),
    },
    coach: c && {
      goal: c.goal,
      experience: c.experience,
      currentlyTraining: Boolean(c.currently_training),
      weekdays: json(c.weekdays) ?? [],
      sessionMinutes: Number(c.session_minutes),
      mainSpot: c.main_spot,
      backupSpot: c.backup_spot,
      mainEquipment: c.main_equipment,
      backupEquipment: c.backup_equipment,
      joints: json(c.joints) ?? [],
      conditions: json(c.conditions) ?? [],
      limitationNotes: c.limitation_notes,
      cookingTime: c.cooking_time,
      foodBudget: c.food_budget,
      stress: c.stress,
      sleep: c.sleep,
      coach: c.coach,
      coachStyle: c.coach_style,
      planNotes: c.plan_notes,
      updatedAt: iso(c.updated_at),
    },
    // null before the body scans migration
    scans,
    activity,
  };
}

// The admin log notes an admin's first look at a member's details (or a scan's photos) in an
// hour, so the log shows who saw health data without filling up on every refresh
const seen = new Map();
const HOUR = 60 * 60 * 1000;
async function auditView(pool, adminId, key, targetId, summary, now = Date.now()) {
  const id = `${adminId}|${key}`;
  if (now - (seen.get(id) ?? 0) < HOUR) return;
  seen.set(id, now);
  if (seen.size > 5000) for (const [k, at] of seen) if (now - at >= HOUR) seen.delete(k);
  try {
    await audit(pool, adminId, key.startsWith("scan:") ? "user.scan_view" : "user.profile_view", "user", targetId, summary);
  } catch (error) {
    console.error(`Admin view log failed: ${error?.code ?? "unknown"}`);
  }
}

module.exports = { memberProfile, auditView, age, ACTIVITY_LIMIT };
