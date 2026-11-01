// The Macro diary: meals a member logs (with their foods), the day view, week progress,
// recent meals and favourite foods. Every query is scoped to the verified member: a meal
// or favourite that belongs to someone else answers exactly like one that doesn't exist.
// A meal's totals are always summed from its foods, never stored, so they cannot drift.
const { NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { limits, daysBefore } = require("./validate");

const round1 = (n) => Math.round(n * 10) / 10;
const emptyTotals = () => ({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });

function addTotals(sum, item) {
  return {
    kcal: round1(sum.kcal + Number(item.kcal)),
    proteinG: round1(sum.proteinG + Number(item.proteinG)),
    carbsG: round1(sum.carbsG + Number(item.carbsG)),
    fatG: round1(sum.fatG + Number(item.fatG)),
  };
}
const totalsOf = (items) => items.reduce(addTotals, emptyTotals());

// The member's active daily target (from setup, or set by hand), or null before setup
async function targetsFor(pool, userId) {
  const [rows] = await pool.query("SELECT calories, protein_g, carbs_g, fat_g FROM nutrition_targets WHERE user_id = ?", [userId]);
  const row = rows[0];
  return row ? { kcal: row.calories, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g } : null;
}

const MEAL_COLUMNS = "m.id, DATE_FORMAT(m.log_date, '%Y-%m-%d') AS log_date, m.slot, m.title, m.logged_at, m.source";

// Meals (oldest first unless `newestFirst`) with their foods and summed totals
async function withItems(pool, mealRows) {
  if (mealRows.length === 0) return [];
  const [itemRows] = await pool.query(
    "SELECT macro_meal_id, name, quantity, unit, kcal, protein_g, carbs_g, fat_g FROM macro_meal_items WHERE macro_meal_id IN (?) ORDER BY position",
    [mealRows.map((m) => m.id)],
  );
  const byMeal = new Map(mealRows.map((m) => [m.id, []]));
  for (const row of itemRows) {
    byMeal.get(row.macro_meal_id).push({
      name: row.name,
      quantity: Number(row.quantity),
      unit: row.unit,
      kcal: Number(row.kcal),
      proteinG: Number(row.protein_g),
      carbsG: Number(row.carbs_g),
      fatG: Number(row.fat_g),
    });
  }
  return mealRows.map((m) => {
    const items = byMeal.get(m.id);
    return { id: m.id, date: m.log_date, slot: m.slot, title: m.title, loggedAt: new Date(m.logged_at).toISOString(), source: m.source, items, totals: totalsOf(items) };
  });
}

// One day: target, totals, and the meals in the order they were eaten
async function day(pool, userId, date) {
  const [targets, [mealRows]] = await Promise.all([
    targetsFor(pool, userId),
    pool.query(`SELECT ${MEAL_COLUMNS} FROM macro_meal_logs m WHERE m.user_id = ? AND m.log_date = ? ORDER BY m.logged_at, m.id`, [userId, date]),
  ]);
  const meals = await withItems(pool, mealRows);
  return { date, targets, totals: totalsOf(meals.map((m) => m.totals)), burned: 0, meals };
}

// none: nothing logged or no target; complete ≥ 90% of target; partial ≥ 50%; low otherwise
function grade(kcal, target, hasMeals) {
  if (!hasMeals || !target) return { ratio: 0, status: "none" };
  const ratio = kcal / target;
  return { ratio: Math.round(ratio * 1000) / 1000, status: ratio >= 0.9 ? "complete" : ratio >= 0.5 ? "partial" : "low" };
}

// Calories eaten per day for the week strip and month calendar
async function dayProgress(pool, userId, dates) {
  const targets = await targetsFor(pool, userId);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(m.log_date, '%Y-%m-%d') AS d, COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.kcal), 0) AS kcal
       FROM macro_meal_logs m LEFT JOIN macro_meal_items i ON i.macro_meal_id = m.id
      WHERE m.user_id = ? AND m.log_date IN (?)
      GROUP BY m.log_date`,
    [userId, dates],
  );
  const byDate = new Map(rows.map((r) => [r.d, { kcal: round1(Number(r.kcal)), meals: Number(r.meals) }]));
  return dates.map((date) => {
    const found = byDate.get(date) ?? { kcal: 0, meals: 0 };
    return { date, kcal: found.kcal, target: targets?.kcal ?? null, ...grade(found.kcal, targets?.kcal, found.meals > 0) };
  });
}

// Meals from the last few days (today and the two before), newest first
async function recentMeals(pool, userId, { today, limit }) {
  const [mealRows] = await pool.query(
    `SELECT ${MEAL_COLUMNS} FROM macro_meal_logs m
      WHERE m.user_id = ? AND m.log_date BETWEEN ? AND ?
      ORDER BY m.logged_at DESC, m.id DESC LIMIT ?`,
    [userId, daysBefore(today, limits.recentDays - 1), today, limit],
  );
  return withItems(pool, mealRows);
}

// Averages per day over the last `days` days (ending on `today`, empty days count as zero)
// against the daily target, plus always the last 7 days for the trend chart. Null when the
// member has no target yet, so the screen shows its set-up state rather than zeros.
async function periodSummary(pool, userId, { period, days, today }) {
  const targets = await targetsFor(pool, userId);
  if (!targets) return null;
  const span = Math.max(days, 7);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(m.log_date, '%Y-%m-%d') AS d, SUM(i.kcal) AS kcal, SUM(i.protein_g) AS p, SUM(i.carbs_g) AS c, SUM(i.fat_g) AS f
       FROM macro_meal_logs m JOIN macro_meal_items i ON i.macro_meal_id = m.id
      WHERE m.user_id = ? AND m.log_date BETWEEN ? AND ?
      GROUP BY m.log_date`,
    [userId, daysBefore(today, span - 1), today],
  );
  const byDate = new Map(rows.map((r) => [r.d, { kcal: Number(r.kcal), proteinG: Number(r.p), carbsG: Number(r.c), fatG: Number(r.f) }]));
  const dayTotals = (date) => byDate.get(date) ?? emptyTotals();
  const inPeriod = Array.from({ length: days }, (_, i) => dayTotals(daysBefore(today, i)));
  const sum = inPeriod.reduce(addTotals, emptyTotals());
  const avg = { kcal: Math.round(sum.kcal / days), proteinG: round1(sum.proteinG / days), carbsG: round1(sum.carbsG / days), fatG: round1(sum.fatG / days) };
  const trend = Array.from({ length: 7 }, (_, i) => {
    const date = daysBefore(today, 6 - i);
    return { date, kcal: Math.round(dayTotals(date).kcal) };
  });
  const trendAvg = Math.round(trend.reduce((total, d) => total + d.kcal, 0) / 7);
  return { period, days, avg, targets, trend, trendAvg };
}

// The one save path: manual entry, a repeat and a favourite all end here. One transaction.
async function logMeal(pool, userId, meal) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialise this member's saves so two quick ones can't both slip under the daily cap. The
    // lock is on their users row (an existing row, so a plain row lock): locking the day's logs
    // with COUNT(*) ... FOR UPDATE only took gap locks, which don't block each other, and two
    // saves then deadlocked on the insert. The routes run ensureUser first, so the row exists.
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM macro_meal_logs WHERE user_id = ? AND log_date = ?", [userId, meal.date]);
    if (n >= limits.mealsPerDay) throw new ValidationError("Too many meals logged for one day");
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      "INSERT INTO macro_meal_logs (id, user_id, log_date, slot, title, logged_at, source, plan_log_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, userId, meal.date, meal.slot, meal.title, new Date(meal.loggedAt), meal.source, meal.planLogKey ?? null],
    );
    await connection.query(
      "INSERT INTO macro_meal_items (macro_meal_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES ?",
      [meal.items.map((it, position) => [id, userId, position, it.name, it.quantity, it.unit, it.kcal, it.proteinG, it.carbsG, it.fatG])],
    );
    await connection.commit();
    return { mealId: id };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Removes a meal and (by cascade) its foods. Someone else's meal is "not found".
async function deleteMeal(pool, userId, mealId) {
  const [result] = await pool.query("DELETE FROM macro_meal_logs WHERE id = ? AND user_id = ?", [mealId, userId]);
  if (result.affectedRows === 0) throw new NotFoundError("Meal not found");
  return { deleted: true };
}

function favoriteToApi(row) {
  const items = typeof row.items === "string" ? JSON.parse(row.items) : row.items;
  return { id: row.id, name: row.name, sourceKey: row.source_key, items, totals: totalsOf(items), createdAt: new Date(row.created_at).toISOString() };
}

async function listFavorites(pool, userId) {
  const [rows] = await pool.query("SELECT id, name, items, source_key, created_at FROM macro_favorite_foods WHERE user_id = ? ORDER BY created_at DESC, id DESC", [userId]);
  return rows.map(favoriteToApi);
}

// With a source key a second call removes the favourite; without one it always adds
async function toggleFavorite(pool, userId, { name, items, sourceKey }) {
  if (sourceKey) {
    const [removed] = await pool.query("DELETE FROM macro_favorite_foods WHERE user_id = ? AND source_key = ?", [userId, sourceKey]);
    if (removed.affectedRows > 0) return { favorited: false };
  }
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM macro_favorite_foods WHERE user_id = ?", [userId]);
  if (n >= limits.favorites) throw new ValidationError(`You can keep up to ${limits.favorites} favourites.`);
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  try {
    await pool.query("INSERT INTO macro_favorite_foods (id, user_id, name, items, source_key) VALUES (?, ?, ?, ?, ?)", [id, userId, name, JSON.stringify(items), sourceKey]);
  } catch (error) {
    // Two taps raced: the other one already saved this key
    if (error?.code === "ER_DUP_ENTRY" && sourceKey) {
      const [[existing]] = await pool.query("SELECT id FROM macro_favorite_foods WHERE user_id = ? AND source_key = ?", [userId, sourceKey]);
      return { favorited: true, favoriteId: existing.id };
    }
    throw error;
  }
  return { favorited: true, favoriteId: id };
}

async function removeFavorite(pool, userId, favoriteId) {
  const [result] = await pool.query("DELETE FROM macro_favorite_foods WHERE id = ? AND user_id = ?", [favoriteId, userId]);
  if (result.affectedRows === 0) throw new NotFoundError("Favourite not found");
  return { removed: true };
}

// Copies the member's own favourite into a new meal. The ownership check is part of the
// query: another member's favourite id is "not found" and nothing is read from it.
async function logFromFavorite(pool, userId, favoriteId, { date, slot, loggedAt }) {
  const [rows] = await pool.query("SELECT id, name, items, source_key, created_at FROM macro_favorite_foods WHERE id = ? AND user_id = ?", [favoriteId, userId]);
  if (rows.length === 0) throw new NotFoundError("Favourite not found");
  const favorite = favoriteToApi(rows[0]);
  return logMeal(pool, userId, { date, slot, loggedAt, title: favorite.name, source: "favorite", items: favorite.items });
}

module.exports = { day, dayProgress, recentMeals, periodSummary, logMeal, deleteMeal, listFavorites, toggleFavorite, removeFavorite, logFromFavorite, grade, totalsOf };
