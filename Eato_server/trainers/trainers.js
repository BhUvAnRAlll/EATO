// Trainers: finding one, the connection between a member and their trainer, and what a
// connected trainer writes for a client: a target recommendation, a diet plan and a workout
// plan. Every function takes the verified caller's id. A trainer may act on a client only
// while trainer_clients holds the pair and the connection is `connected` (assertCoaches); a
// member who isn't a client sees the trainer's basic profile and nothing else.
//
// Ending a connection (either side, or replacing a trainer) ends the coaching in one go: the
// trainer_clients row goes, the diet plan and the trainer's workout plan are superseded, and
// a trainer target that was active is swapped back for the member's own.
const nutrition = require("../../Eato_client/src/lib/nutrition/index.ts");
const { ValidationError, loadProfile } = require("../profile");
const { memberSummary, ensureUser } = require("../community/members");
const { NotFoundError, ForbiddenError } = require("../community/posts");
const { assertOwnMedia, mediaUrl } = require("../community/media");
const diary = require("../macro/diary");
const targets = require("../macro/targets");
const { isNearToday } = require("../macro/validate");
const { syncLibrary } = require("../workout/plans");
const rules = require("./rules");

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};

async function inTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const parseJson = (value) => (value === null || value === undefined ? null : typeof value === "string" ? JSON.parse(value) : value);
const isoDay = (date) => (date instanceof Date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : String(date).slice(0, 10));
const hhmm = (time) => String(time).slice(0, 5);
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

// ---- profiles and discovery -------------------------------------------------------------

const PROFILE_SELECT = `SELECT tp.user_id, u.full_name, tp.title, tp.specialties, tp.years_experience, tp.bio, tp.coaching_mode, tp.offers_nutrition,
  tp.accepting_clients, tp.availability, tp.approach, tp.qualifications, tp.languages, tp.photo_media_id, tp.updated_at, tp.verified_at
  FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id`;

function profileToApi(row) {
  return {
    member: memberSummary(row),
    title: row.title,
    specialties: parseJson(row.specialties) ?? [],
    yearsExperience: row.years_experience,
    bio: row.bio,
    coachingMode: row.coaching_mode,
    offersNutrition: Boolean(row.offers_nutrition),
    acceptingClients: Boolean(row.accepting_clients),
    // An JustFit admin checked the qualifications (Super Admin › Users)
    verified: row.verified_at !== null && row.verified_at !== undefined,
    availability: row.availability,
    approach: row.approach,
    qualifications: parseJson(row.qualifications) ?? [],
    languages: parseJson(row.languages) ?? [],
    photoUrl: mediaUrl(row.photo_media_id),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// The member's open row (requested or connected), if any
async function openConnection(db, clientId, { lock = false } = {}) {
  const [rows] = await db.query(`SELECT id, trainer_id, client_id, status, requested_at, responded_at FROM trainer_connections WHERE client_id = ? AND status IN ('requested', 'connected')${lock ? " FOR UPDATE" : ""}`, [clientId]);
  return rows[0] ?? null;
}

// Trainers who take clients, with where the viewer stands with each
async function listTrainers(pool, viewerId, { search, specialty }) {
  const params = [];
  // A suspended trainer drops out of search (their existing clients still reach them)
  let where = "WHERE u.role = 'trainer' AND tp.accepting_clients = TRUE AND NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = tp.user_id AND cp.status = 'suspended')";
  if (search) {
    where += " AND (u.full_name LIKE ? OR tp.title LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (specialty) {
    where += " AND JSON_CONTAINS(tp.specialties, JSON_QUOTE(?))";
    params.push(specialty);
  }
  const [rows] = await pool.query(`${PROFILE_SELECT} ${where} ORDER BY u.full_name, tp.user_id LIMIT 100`, params);
  const open = await openConnection(pool, viewerId);
  return rows.map((row) => ({
    ...rules.profileForViewer(profileToApi(row), { connected: open?.status === "connected" && open.trainer_id === row.user_id, own: row.user_id === viewerId }),
    connection: open && open.trainer_id === row.user_id ? rules.connectionState(open) : "none",
  }));
}

async function getTrainer(pool, viewerId, trainerId) {
  const [rows] = await pool.query(`${PROFILE_SELECT} WHERE tp.user_id = ? AND u.role = 'trainer'`, [trainerId]);
  if (!rows[0]) throw new NotFoundError("That trainer doesn't exist.");
  const open = await openConnection(pool, viewerId);
  const mine = open && open.trainer_id === trainerId;
  const state = mine ? rules.connectionState(open) : "none";
  return {
    ...rules.profileForViewer(profileToApi(rows[0]), { connected: state === "connected", own: trainerId === viewerId }),
    connection: state,
    // Whether the viewer has a different trainer (connecting here would replace them)
    otherTrainer: open && !mine ? { id: open.trainer_id, status: rules.connectionState(open) } : null,
    messageLockReason: rules.messageLockReason(state, rows[0].full_name),
  };
}

// The trainer's own profile (null until they save one)
async function ownProfile(pool, userId) {
  const [rows] = await pool.query(`${PROFILE_SELECT} WHERE tp.user_id = ?`, [userId]);
  return rows[0] ? rules.profileForViewer(profileToApi(rows[0]), { own: true }) : null;
}

// The route checks the Clerk role is "trainer" before this runs
async function saveOwnProfile(pool, userId, values) {
  await ensureUser(pool, userId);
  if (values.photoMediaId) await assertOwnMedia(pool, values.photoMediaId, userId);
  await pool.query(
    `INSERT INTO trainer_profiles (user_id, title, specialties, years_experience, bio, coaching_mode, offers_nutrition, accepting_clients, availability, approach, qualifications, languages, photo_media_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), specialties = VALUES(specialties), years_experience = VALUES(years_experience), bio = VALUES(bio),
       coaching_mode = VALUES(coaching_mode), offers_nutrition = VALUES(offers_nutrition), accepting_clients = VALUES(accepting_clients), availability = VALUES(availability),
       approach = VALUES(approach), qualifications = VALUES(qualifications), languages = VALUES(languages), photo_media_id = VALUES(photo_media_id)`,
    [userId, values.title, JSON.stringify(values.specialties), values.yearsExperience, values.bio, values.coachingMode, values.offersNutrition, values.acceptingClients,
      values.availability, values.approach, JSON.stringify(values.qualifications), JSON.stringify(values.languages), values.photoMediaId],
  );
  // The users row's role copy is what discovery filters on; keep it in step with Clerk's answer
  await pool.query("UPDATE users SET role = 'trainer' WHERE id = ? AND role = 'user'", [userId]);
  return ownProfile(pool, userId);
}

// ---- the member's connection -------------------------------------------------------------

async function trainerSummary(pool, trainerId) {
  const [rows] = await pool.query("SELECT tp.user_id, u.full_name, tp.title, tp.offers_nutrition, tp.photo_media_id FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.user_id = ?", [trainerId]);
  const row = rows[0];
  return row ? { member: memberSummary(row), title: row.title, offersNutrition: Boolean(row.offers_nutrition), photoUrl: mediaUrl(row.photo_media_id) } : null;
}

// What the member has from their trainer right now
async function myConnection(pool, clientId) {
  const open = await openConnection(pool, clientId);
  if (!open) return { state: "none", trainer: null };
  const trainer = await trainerSummary(pool, open.trainer_id);
  const state = rules.connectionState(open);
  if (state !== "connected") return { state, trainer, requestedAt: new Date(open.requested_at).toISOString(), messageLockReason: rules.messageLockReason(state, trainer?.member.name) };
  const [[plan]] = await pool.query("SELECT id, name, updated_at FROM diet_plans WHERE client_id = ? AND trainer_id = ? AND status = 'active'", [clientId, open.trainer_id]);
  const [[workout]] = await pool.query("SELECT id, name, trainer_note, updated_at FROM workout_plans WHERE user_id = ? AND created_by = ? AND source = 'trainer' AND status = 'active'", [clientId, open.trainer_id]);
  const [[rec]] = await pool.query("SELECT id, applied_at, created_at FROM trainer_target_recommendations WHERE client_id = ? AND trainer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [clientId, open.trainer_id]);
  return {
    state,
    trainer,
    connectedAt: new Date(open.responded_at).toISOString(),
    dietPlan: plan ? { id: plan.id, name: plan.name, updatedAt: new Date(plan.updated_at).toISOString() } : null,
    workout: workout ? { id: workout.id, name: workout.name, note: workout.trainer_note, updatedAt: new Date(workout.updated_at).toISOString() } : null,
    recommendation: rec ? { id: rec.id, isNew: rules.recommendationIsNew(rec), createdAt: new Date(rec.created_at).toISOString() } : null,
    messageLockReason: null,
  };
}

// Ends a connection and everything the trainer wrote for the client (inside the caller's
// transaction). The target swap happens after the commit (see endCoaching).
async function endCoachingRows(connection, row, endedBy, status = "ended") {
  await connection.query("UPDATE trainer_connections SET status = ?, ended_by = ?, ended_at = NOW() WHERE id = ? AND status IN ('requested', 'connected')", [status, endedBy, row.id]);
  if (row.status !== "connected") return;
  await connection.query("DELETE FROM trainer_clients WHERE trainer_id = ? AND client_id = ?", [row.trainer_id, row.client_id]);
  await connection.query("UPDATE diet_plans SET status = 'superseded' WHERE client_id = ? AND trainer_id = ? AND status = 'active'", [row.client_id, row.trainer_id]);
  await connection.query("UPDATE workout_plans SET status = 'superseded' WHERE user_id = ? AND created_by = ? AND source = 'trainer' AND status = 'active'", [row.client_id, row.trainer_id]);
}

// After the rows are gone: a trainer's target that was active goes back to the member's own
async function restoreIfTrainerTarget(pool, clientId) {
  const record = await targets.recordFor(pool, clientId);
  if (!record || record.active.source !== "trainer_adjusted") return;
  const result = nutrition.restorePersonalTargets(record, await priorTarget(pool, clientId));
  if (result.ok) await targets.save(pool, clientId, result.record);
}

async function endCoaching(pool, row, endedBy, status) {
  await inTransaction(pool, (connection) => endCoachingRows(connection, row, endedBy, status));
  await restoreIfTrainerTarget(pool, row.client_id);
}

// A member asks a trainer. One trainer at a time: with `replace`, the current request or
// connection ends first (the app asks for confirmation); without, a 409 says who is in the way.
async function requestConnection(pool, clientId, trainerId, { replace = false } = {}) {
  if (clientId === trainerId) throw new ValidationError("You can't connect to yourself.");
  await ensureUser(pool, clientId);
  const [trainers] = await pool.query("SELECT tp.accepting_clients FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.user_id = ? AND u.role = 'trainer'", [trainerId]);
  if (!trainers[0]) throw new NotFoundError("That trainer doesn't exist.");
  if (!trainers[0].accepting_clients) throw conflict("This trainer isn't taking new clients right now.");
  let ended = null;
  await inTransaction(pool, async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [clientId]);
    const open = await openConnection(connection, clientId, { lock: true });
    if (open && open.trainer_id === trainerId) return; // already asked, or already their client
    if (open) {
      if (!replace) throw conflict(open.status === "connected" ? "You already have a trainer. Disconnect first, or confirm the switch." : "You already asked another trainer. Cancel that request first, or confirm the switch.");
      await endCoachingRows(connection, open, clientId, open.status === "connected" ? "ended" : "cancelled");
      ended = open;
    }
    await connection.query("INSERT INTO trainer_connections (trainer_id, client_id) VALUES (?, ?)", [trainerId, clientId]);
  });
  if (ended) await restoreIfTrainerTarget(pool, clientId);
  return myConnection(pool, clientId);
}

// Withdraw a request, or disconnect from the trainer
async function endMyConnection(pool, clientId) {
  const open = await openConnection(pool, clientId);
  if (!open) throw new NotFoundError("You don't have a trainer or an open request.");
  await endCoaching(pool, open, clientId, open.status === "connected" ? "ended" : "cancelled");
  return myConnection(pool, clientId);
}

// ---- the trainer's side ------------------------------------------------------------------

async function memberRows(pool, userIds) {
  if (userIds.length === 0) return new Map();
  const [rows] = await pool.query("SELECT id, full_name FROM users WHERE id IN (?)", [userIds]);
  return new Map(rows.map((row) => [row.id, memberSummary({ user_id: row.id, full_name: row.full_name })]));
}

async function listRequests(pool, trainerId) {
  const [rows] = await pool.query("SELECT client_id, requested_at FROM trainer_connections WHERE trainer_id = ? AND status = 'requested' ORDER BY requested_at, id", [trainerId]);
  const members = await memberRows(pool, rows.map((r) => r.client_id));
  return rows.map((row) => ({ member: members.get(row.client_id), requestedAt: new Date(row.requested_at).toISOString() }));
}

async function listClients(pool, trainerId) {
  const [rows] = await pool.query(
    `SELECT c.client_id, c.responded_at,
            EXISTS (SELECT 1 FROM diet_plans p WHERE p.client_id = c.client_id AND p.trainer_id = c.trainer_id AND p.status = 'active') AS has_plan,
            EXISTS (SELECT 1 FROM workout_plans w WHERE w.user_id = c.client_id AND w.created_by = c.trainer_id AND w.source = 'trainer' AND w.status = 'active') AS has_workout,
            EXISTS (SELECT 1 FROM trainer_target_recommendations r WHERE r.client_id = c.client_id AND r.trainer_id = c.trainer_id) AS has_recommendation
     FROM trainer_connections c WHERE c.trainer_id = ? AND c.status = 'connected' ORDER BY c.responded_at DESC, c.id`,
    [trainerId],
  );
  const members = await memberRows(pool, rows.map((r) => r.client_id));
  return rows.map((row) => ({
    member: members.get(row.client_id),
    since: new Date(row.responded_at).toISOString(),
    hasDietPlan: Boolean(row.has_plan),
    hasWorkout: Boolean(row.has_workout),
    hasRecommendation: Boolean(row.has_recommendation),
  }));
}

// Accept or decline. Accepting also records the pair in trainer_clients, which every trainer
// action is checked against.
async function answerRequest(pool, trainerId, clientId, accept) {
  await ensureUser(pool, trainerId);
  await inTransaction(pool, async (connection) => {
    const [rows] = await connection.query("SELECT id FROM trainer_connections WHERE trainer_id = ? AND client_id = ? AND status = 'requested' FOR UPDATE", [trainerId, clientId]);
    if (!rows[0]) throw new NotFoundError("That request is no longer open.");
    if (accept) {
      await connection.query("UPDATE trainer_connections SET status = 'connected', responded_at = NOW() WHERE id = ?", [rows[0].id]);
      await connection.query("INSERT IGNORE INTO trainer_clients (trainer_id, client_id, assigned_by) VALUES (?, ?, ?)", [trainerId, clientId, trainerId]);
    } else {
      await connection.query("UPDATE trainer_connections SET status = 'declined', ended_by = ?, responded_at = NOW(), ended_at = NOW() WHERE id = ?", [trainerId, rows[0].id]);
    }
  });
  return { clientId, accepted: accept };
}

// The trainer may act on this member only while they coach them (404 either way: a trainer
// learns nothing about members who aren't their clients)
async function assertCoaches(pool, trainerId, clientId) {
  const [rows] = await pool.query(
    "SELECT 1 FROM trainer_clients tc JOIN trainer_connections c ON c.trainer_id = tc.trainer_id AND c.client_id = tc.client_id AND c.status = 'connected' WHERE tc.trainer_id = ? AND tc.client_id = ?",
    [trainerId, clientId],
  );
  if (rows.length === 0) throw new NotFoundError("That member isn't your client.");
}

async function endClient(pool, trainerId, clientId) {
  const [rows] = await pool.query("SELECT id, trainer_id, client_id, status FROM trainer_connections WHERE trainer_id = ? AND client_id = ? AND status = 'connected'", [trainerId, clientId]);
  if (!rows[0]) throw new NotFoundError("That member isn't your client.");
  await endCoaching(pool, rows[0], trainerId, "ended");
  return { clientId, ended: true };
}

// One client as the trainer sees them: the basics, the plans they have, and their targets
async function clientDetail(pool, trainerId, clientId) {
  await assertCoaches(pool, trainerId, clientId);
  const members = await memberRows(pool, [clientId]);
  const { profile, nutrition: record } = await loadProfile(pool, clientId);
  const plan = await activeDietPlan(pool, clientId);
  const [[workout]] = await pool.query("SELECT id, name, goal, level, days_per_week, trainer_note, start_date, updated_at FROM workout_plans WHERE user_id = ? AND status = 'active'", [clientId]);
  const [[rec]] = await pool.query("SELECT id, calories, protein_g, carbs_g, fat_g, note, applied_at, created_at FROM trainer_target_recommendations WHERE client_id = ? AND trainer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [clientId, trainerId]);
  return {
    member: members.get(clientId),
    // Health basics the member entered at setup, for the trainer's planning (never contact details)
    goal: profile?.goal ?? null,
    weightKg: profile?.weightKg ?? null,
    heightCm: profile?.heightCm ?? null,
    activity: profile?.activity ?? null,
    diet: profile?.diet ?? null,
    allergies: profile?.allergies ?? null,
    targets: record ? { kcal: record.active.calories, ...record.active.macros, source: record.active.source } : null,
    dietPlan: plan ? planToApi(plan) : null,
    workout: workout ? { id: workout.id, name: workout.name, goal: workout.goal, level: workout.level, daysPerWeek: workout.days_per_week, note: workout.trainer_note, startDate: isoDay(workout.start_date), updatedAt: new Date(workout.updated_at).toISOString(), mine: true } : null,
    recommendation: rec ? recommendationToApi(rec) : null,
  };
}

// ---- recommendations ---------------------------------------------------------------------

function recommendationToApi(row, trainer = null) {
  return {
    id: row.id, calories: row.calories, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g, note: row.note,
    isNew: rules.recommendationIsNew(row), appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(),
    ...(trainer ? { trainer } : {}),
  };
}

async function setRecommendation(pool, trainerId, clientId, values) {
  await assertCoaches(pool, trainerId, clientId);
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query(
    "INSERT INTO trainer_target_recommendations (id, trainer_id, client_id, calories, protein_g, carbs_g, fat_g, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, trainerId, clientId, values.calories, values.proteinG, values.carbsG, values.fatG, values.note],
  );
  const [rows] = await pool.query("SELECT * FROM trainer_target_recommendations WHERE id = ?", [id]);
  return recommendationToApi(rows[0]);
}

// The latest recommendation from the member's connected trainer (none without a trainer)
async function latestRecommendation(pool, clientId) {
  const open = await openConnection(pool, clientId);
  if (!open || open.status !== "connected") return { open: null, row: null };
  const [rows] = await pool.query("SELECT * FROM trainer_target_recommendations WHERE client_id = ? AND trainer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [clientId, open.trainer_id]);
  return { open, row: rows[0] ?? null };
}

async function myRecommendation(pool, clientId) {
  const { open, row } = await latestRecommendation(pool, clientId);
  if (!row) return { recommendation: null, targets: await targets.status(pool, clientId) };
  return { recommendation: recommendationToApi(row, await trainerSummary(pool, open.trainer_id)), targets: await targets.status(pool, clientId) };
}

// The member's own target as saved when a recommendation was applied (the way back)
async function priorTarget(pool, clientId) {
  const [rows] = await pool.query("SELECT prior_target FROM trainer_target_recommendations WHERE client_id = ? AND applied_at IS NOT NULL AND prior_target IS NOT NULL ORDER BY applied_at DESC, id DESC LIMIT 1", [clientId]);
  return rows[0] ? parseJson(rows[0].prior_target) : null;
}

// "Apply": the recommendation becomes the active target, with the trainer's grams. The target
// the member had is saved on the row so they can go back to it; never overwritten silently.
async function applyRecommendation(pool, clientId) {
  const { open, row } = await latestRecommendation(pool, clientId);
  if (!row) throw new NotFoundError("There's no recommendation to apply.");
  const record = await targets.recordFor(pool, clientId);
  if (!record) throw new ValidationError("Complete your profile before applying a trainer's targets.");
  const prior = record.active.source === "trainer_adjusted" ? await priorTarget(pool, clientId) : record.active;
  const result = nutrition.applyTrainerOverride(record, row.calories, row.note || "Trainer recommendation", open.trainer_id, new Date(), undefined, { proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g });
  if (!result.ok) throw new ValidationError(result.error);
  await targets.save(pool, clientId, result.record);
  await pool.query("UPDATE trainer_target_recommendations SET applied_at = NOW(), prior_target = ? WHERE id = ?", [prior ? JSON.stringify(prior) : null, row.id]);
  return myRecommendation(pool, clientId);
}

// "Use my personal targets": back to the saved target, or the calculation
async function restoreTargets(pool, clientId) {
  const record = await targets.recordFor(pool, clientId);
  if (!record) throw new ValidationError("Complete your profile before changing targets.");
  const result = nutrition.restorePersonalTargets(record, await priorTarget(pool, clientId));
  if (!result.ok) throw new ValidationError(result.error);
  await targets.save(pool, clientId, result.record);
  return myRecommendation(pool, clientId);
}

// ---- diet plans --------------------------------------------------------------------------

async function activeDietPlan(db, clientId) {
  const [plans] = await db.query("SELECT p.*, u.full_name AS trainer_name FROM diet_plans p JOIN users u ON u.id = p.trainer_id WHERE p.client_id = ? AND p.status = 'active'", [clientId]);
  const plan = plans[0];
  if (!plan) return null;
  const [meals] = await db.query("SELECT * FROM diet_plan_meals WHERE plan_id = ? ORDER BY position", [plan.id]);
  const [items] = await db.query("SELECT * FROM diet_plan_meal_items WHERE meal_id IN (?) ORDER BY meal_id, position", [meals.length ? meals.map((m) => m.id) : [""]]);
  return { ...plan, meals: meals.map((meal) => ({ ...meal, items: items.filter((it) => it.meal_id === meal.id) })) };
}

const itemToApi = (it) => ({ name: it.name, quantity: Number(it.quantity), unit: it.unit, kcal: Number(it.kcal), proteinG: Number(it.protein_g), carbsG: Number(it.carbs_g), fatG: Number(it.fat_g) });

function planToApi(plan) {
  return {
    id: plan.id,
    trainer: memberSummary({ user_id: plan.trainer_id, full_name: plan.trainer_name }),
    name: plan.name,
    goal: plan.goal,
    startDate: isoDay(plan.start_date),
    endDate: plan.end_date ? isoDay(plan.end_date) : null,
    notes: plan.notes,
    updatedAt: new Date(plan.updated_at).toISOString(),
    meals: plan.meals.map((meal) => {
      const items = meal.items.map(itemToApi);
      return { id: meal.id, slot: meal.slot, name: meal.name, time: hhmm(meal.meal_time), note: meal.note, items, totals: rules.totalsOf(items) };
    }),
  };
}

// The trainer writes (or replaces) the client's plan in one transaction
async function setDietPlan(pool, trainerId, clientId, values) {
  await assertCoaches(pool, trainerId, clientId);
  const planId = await inTransaction(pool, async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [clientId]);
    await connection.query("UPDATE diet_plans SET status = 'superseded' WHERE client_id = ? AND status = 'active'", [clientId]);
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      "INSERT INTO diet_plans (id, trainer_id, client_id, name, goal, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, trainerId, clientId, values.name, values.goal, values.startDate, values.endDate, values.notes],
    );
    for (const [position, meal] of values.meals.entries()) {
      const [[{ id: mealId }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO diet_plan_meals (id, plan_id, client_id, slot, name, meal_time, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [mealId, id, clientId, meal.slot, meal.name, meal.time, meal.note, position]);
      await connection.query(
        "INSERT INTO diet_plan_meal_items (meal_id, client_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES ?",
        [meal.items.map((it, i) => [mealId, clientId, i, it.name, it.quantity, it.unit, it.kcal, it.proteinG, it.carbsG, it.fatG])],
      );
    }
    return id;
  });
  const plan = await activeDietPlan(pool, clientId);
  return { ...planToApi(plan), id: planId };
}

// The member's plan with today's state per meal: logged (how many times), done without logging,
// and the day's logged-vs-planned calories
async function myDietPlan(pool, clientId, date) {
  const open = await openConnection(pool, clientId);
  if (!open || open.status !== "connected") return { plan: null, state: open ? rules.connectionState(open) : "none" };
  const plan = await activeDietPlan(pool, clientId);
  if (!plan) return { plan: null, state: "connected" };
  const api = planToApi(plan);
  const [logs] = await pool.query(
    `SELECT m.plan_log_key, SUM(i.kcal) AS kcal FROM macro_meal_logs m JOIN macro_meal_items i ON i.macro_meal_id = m.id
     WHERE m.user_id = ? AND m.log_date = ? AND m.source = 'plan' GROUP BY m.id, m.plan_log_key`,
    [clientId, date],
  );
  const [done] = await pool.query("SELECT meal_id FROM diet_plan_completions WHERE client_id = ? AND done_date = ?", [clientId, date]);
  const doneIds = new Set(done.map((d) => d.meal_id));
  let loggedKcal = 0;
  const meals = api.meals.map((meal) => {
    const mine = logs.filter((l) => String(l.plan_log_key).startsWith(`${date}:${meal.id}:`));
    loggedKcal += mine.reduce((sum, l) => sum + Number(l.kcal), 0);
    return { ...meal, loggedCount: mine.length, done: doneIds.has(meal.id), status: mine.length > 0 ? "logged" : doneIds.has(meal.id) ? "done" : "pending" };
  });
  return {
    plan: { ...api, meals },
    state: "connected",
    date,
    progress: { mealsDone: meals.filter((m) => m.status !== "pending").length, mealsTotal: meals.length, loggedKcal: Math.round(loggedKcal), plannedKcal: Math.round(meals.reduce((sum, m) => sum + m.totals.kcal, 0)) },
  };
}

// The member logs a plan meal into the Macro diary, with the servings they chose. One log per
// date and meal unless `again` is set; a repeated tap returns the first log instead of a copy.
async function logPlanMeal(pool, clientId, mealId, { date, servings, again }) {
  const plan = await activeDietPlan(pool, clientId);
  const meal = plan?.meals.find((m) => m.id === mealId);
  if (!meal) throw new NotFoundError("That plan meal doesn't exist.");
  if (!isNearToday(date, Date.now())) throw new ValidationError("Plan meals can only be logged for today");
  const [existing] = await pool.query("SELECT id, plan_log_key FROM macro_meal_logs WHERE user_id = ? AND plan_log_key LIKE ?", [clientId, `${date}:${mealId}:%`]);
  if (existing.length > 0 && !again) return { mealId, logId: existing[0].id, alreadyLogged: true, loggedCount: existing.length };
  const items = rules.scaleItems(meal.items.map(itemToApi), servings ?? []);
  if (items.length === 0) throw new ValidationError("Keep at least one food to log the meal.");
  const key = rules.planLogKey(date, mealId, existing.length + 1);
  try {
    const { mealId: logId } = await diary.logMeal(pool, clientId, { date, slot: rules.diarySlotFor(meal.slot), title: meal.name, loggedAt: Date.now(), source: "plan", planLogKey: key, items });
    return { mealId, logId, alreadyLogged: false, loggedCount: existing.length + 1, totals: rules.totalsOf(items) };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      // Two taps raced: the first one's log is the answer
      const [[winner]] = await pool.query("SELECT id FROM macro_meal_logs WHERE user_id = ? AND plan_log_key = ?", [clientId, key]);
      if (winner) return { mealId, logId: winner.id, alreadyLogged: true, loggedCount: existing.length + 1 };
    }
    throw error;
  }
}

// "Mark done" without logging (and undo)
async function setDone(pool, clientId, mealId, date, done) {
  const [rows] = await pool.query("SELECT 1 FROM diet_plan_meals m JOIN diet_plans p ON p.id = m.plan_id WHERE m.id = ? AND m.client_id = ? AND p.status = 'active'", [mealId, clientId]);
  if (rows.length === 0) throw new NotFoundError("That plan meal doesn't exist.");
  if (done) await pool.query("INSERT IGNORE INTO diet_plan_completions (client_id, meal_id, done_date) VALUES (?, ?, ?)", [clientId, mealId, date]);
  else await pool.query("DELETE FROM diet_plan_completions WHERE client_id = ? AND meal_id = ? AND done_date = ?", [clientId, mealId, date]);
  return { mealId, date, done };
}

// ---- workout plans -----------------------------------------------------------------------

// The exercise library for the trainer's editor
async function listLibrary(pool) {
  await inTransaction(pool, (connection) => syncLibrary(connection));
  const [rows] = await pool.query("SELECT id, name, muscle_group, pattern, equipment, timed_sec FROM workout_exercise_library WHERE archived_at IS NULL ORDER BY muscle_group, name");
  return rows.map((row) => ({ id: row.id, name: row.name, muscleGroup: row.muscle_group, pattern: row.pattern, equipment: row.equipment, timedSec: row.timed_sec }));
}

// The trainer writes the client's workout: it supersedes whatever plan was active (the
// engine's or an earlier one of the trainer's). Exercises must exist in the library.
async function setWorkoutPlan(pool, trainerId, clientId, values, today) {
  await assertCoaches(pool, trainerId, clientId);
  const ids = [...new Set(values.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
  const [found] = await pool.query("SELECT id FROM workout_exercise_library WHERE id IN (?) AND archived_at IS NULL", [ids]);
  if (found.length !== ids.length) throw new ValidationError("One of the exercises isn't in the library.");
  const planId = await inTransaction(pool, async (connection) => {
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [clientId]);
    await connection.query("UPDATE workout_plans SET status = 'superseded' WHERE user_id = ? AND status = 'active'", [clientId]);
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      `INSERT INTO workout_plans (id, user_id, name, goal, level, days_per_week, split, source, created_by, status, trainer_note, start_date)
       VALUES (?, ?, ?, ?, ?, ?, 'auto', 'trainer', ?, 'active', ?, ?)`,
      [id, clientId, values.name, values.goal, values.level, values.days.length, trainerId, values.note, today],
    );
    for (const day of values.days) {
      const [[{ id: dayId }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO workout_days (id, plan_id, user_id, weekday, title, session_type) VALUES (?, ?, ?, ?, ?, ?)", [dayId, id, clientId, day.weekday, day.title, day.sessionType]);
      for (const [position, e] of day.exercises.entries()) {
        await connection.query(
          `INSERT INTO workout_day_exercises (day_id, plan_id, user_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dayId, id, clientId, e.exerciseId, e.section, position, JSON.stringify(e.sets), e.restSec, e.role, e.repsMin, e.repsMax, e.note],
        );
      }
    }
    return id;
  });
  return { id: planId, name: values.name, daysPerWeek: values.days.length, note: values.note, startDate: today };
}

module.exports = {
  listTrainers, getTrainer, ownProfile, saveOwnProfile,
  myConnection, requestConnection, endMyConnection,
  listRequests, listClients, answerRequest, endClient, clientDetail, assertCoaches,
  setRecommendation, myRecommendation, applyRecommendation, restoreTargets,
  setDietPlan, myDietPlan, logPlanMeal, setDone,
  listLibrary, setWorkoutPlan,
};
