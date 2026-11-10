// Trainer diet plans (2026-11-10, the user's request; migration 2027-01-27-trainer-diet-plans.sql).
// Trainer side (/api/trainer/clients/:id/diet-plan): read, save and remove the plan of one of their
// own PT clients (gym/trainer.js clientRow: the member's PT is with the caller, at a branch where
// the caller is a trainer, running or ended within 30 days). Member side (/api/membership): the
// plans on the account's verified phone, and the switch that lets their trainers see their diet,
// allergies and dislikes. Picked menu meals that break the member's diet or name an allergy are
// refused when the member shares, and always hidden from the member (their own answers decide).
const { ConflictError } = require("../errors");
const { getAccount } = require("../auth");
const { mealImageUrl } = require("../meals/rules");
const notifications = require("../notifications/service");
const trainer = require("./trainer");
const rules = require("./dietPlanRules");

const num = (v) => Number(v);
const MENU_LIMIT = 300;

// Every meal on the menu, as the picker and the member's cards show it
async function menuMeals(db) {
  const [rows] = await db.query(
    `SELECT id, name, description, serving_size, ingredients, image_url, image_key, diet, tags, calories, protein_g, carbs_g, fat_g, price_paise, mrp_paise
       FROM meals WHERE is_available = TRUE ORDER BY name LIMIT ${MENU_LIMIT}`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    servingSize: r.serving_size ?? null,
    ingredients: r.ingredients ?? null,
    diet: r.diet,
    tags: typeof r.tags === "string" && r.tags ? r.tags.split(",") : [],
    calories: num(r.calories),
    proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g),
    fatG: num(r.fat_g),
    price: Math.round(num(r.price_paise) / 100),
    mrp: r.mrp_paise ? Math.round(num(r.mrp_paise) / 100) : null,
    imageUrl: mealImageUrl(r),
  }));
}

// The food answers of the account on a membership's phone, and whether they share them
async function foodByPhone(db, phone) {
  if (!phone) return { shared: false, food: null };
  const [[row]] = await db.query(
    "SELECT p.diet, p.allergies, p.dislikes, p.food_shared_with_trainer AS shared FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.verified_phone = ?",
    [phone],
  );
  if (!row) return { shared: false, food: null };
  return { shared: num(row.shared) === 1, food: { diet: row.diet ?? null, allergies: row.allergies || null, dislikes: row.dislikes || null } };
}

const planOut = (row) =>
  row
    ? {
        id: num(row.id),
        note: row.note ?? null,
        meals: rules.readMeals(row.meals),
        version: num(row.version),
        updatedAt: new Date(row.updated_at).toISOString(),
      }
    : null;

/** The trainer's editor: the client, their plan, the menu, and their food answers only when shared */
async function forTrainer(pool, trainerId, memberId, today) {
  const client = await trainer.clientRow(pool, trainerId, memberId, today);
  const [[[row]], menu, { shared, food }] = await Promise.all([
    pool.query("SELECT * FROM trainer_diet_plans WHERE member_id = ?", [memberId]),
    menuMeals(pool),
    foodByPhone(pool, client.phone),
  ]);
  return {
    client: { id: client.id, name: client.full_name, branch: client.branch },
    plan: planOut(row),
    shared,
    food: shared ? food : null,
    slots: rules.SLOTS,
    menu: menu.map((m) => ({ ...m, ...(shared && food ? rules.pickCheck(m, food) : { problem: null, warning: null }) })),
  };
}

/** Saves the client's plan (one per membership); every pick must be on the menu and, when shared, suit them */
async function save(pool, trainerId, memberId, body, today) {
  const conn = await pool.getConnection();
  let saved;
  let client;
  try {
    await conn.beginTransaction();
    client = await trainer.clientRow(conn, trainerId, memberId, today);
    await conn.query("SELECT id FROM gym_members WHERE id = ? FOR UPDATE", [memberId]);
    const picks = [...new Set(body.meals.flatMap((m) => m.picks))];
    if (picks.length > 0) {
      const menu = await menuMeals(conn);
      const byId = new Map(menu.map((m) => [m.id, m]));
      const gone = picks.find((id) => !byId.has(id));
      if (gone) throw new ConflictError("A justFit meal you picked is no longer on the menu. Pick again.");
      const { shared, food } = await foodByPhone(conn, client.phone);
      if (shared && food) {
        for (const id of picks) {
          const { problem } = rules.pickCheck(byId.get(id), food);
          if (problem) throw new ConflictError(`${byId.get(id).name} doesn't suit ${client.full_name}: ${problem.toLowerCase()}.`);
        }
      }
    }
    await conn.query(
      `INSERT INTO trainer_diet_plans (member_id, gym_id, trainer_id, note, meals) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE trainer_id = VALUES(trainer_id), note = VALUES(note), meals = VALUES(meals), version = version + 1`,
      [memberId, client.gym_id, trainerId, body.note, JSON.stringify(body.meals)],
    );
    const [[row]] = await conn.query("SELECT * FROM trainer_diet_plans WHERE member_id = ?", [memberId]);
    saved = row;
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  // The member hears about it once per version (never fails the save)
  const [to] = await pool.query("SELECT id FROM users WHERE verified_phone = ?", [client.phone ?? ""]);
  const [[coach]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [trainerId]);
  const who = (coach?.full_name && coach.full_name.trim()) || "Your trainer";
  await notifications.notify(pool, to.map((r) => r.id), {
    kind: "diet.plan", key: `${saved.id}:${saved.version}`,
    title: num(saved.version) === 1 ? `${who} shared a diet plan` : `${who} updated your diet plan`,
    body: "See your meals for the day and order the ones your trainer picked from justFit.", link: "/coach/meal-plan",
  });
  return { plan: planOut(saved) };
}

/** Removes the client's plan */
async function remove(pool, trainerId, memberId, today) {
  await trainer.clientRow(pool, trainerId, memberId, today);
  const [result] = await pool.query("DELETE FROM trainer_diet_plans WHERE member_id = ?", [memberId]);
  return { removed: result.affectedRows > 0 };
}

/**
 * The member's plans (Coach › Meal Plan › From your trainer): every plan on a membership of the
 * account's verified phone, newest first, with the picked meals that are on the menu and suit the
 * member's own answers (`hidden` counts the rest), and whether they share their answers.
 */
async function forMember(pool, userId) {
  const account = await getAccount(userId, pool);
  if (!account.phone) return { shared: false, plans: [] };
  const [[profile]] = await pool.query("SELECT diet, allergies, dislikes, food_shared_with_trainer AS shared FROM profiles WHERE user_id = ?", [userId]);
  const food = profile ? { diet: profile.diet ?? null, allergies: profile.allergies || null, dislikes: profile.dislikes || null } : null;
  const [rows] = await pool.query(
    `SELECT d.*, g.name AS branch, b.name AS gym, u.full_name AS trainer_name
       FROM trainer_diet_plans d
       JOIN gym_members m ON m.id = d.member_id
       JOIN gyms g ON g.id = m.gym_id
       JOIN gym_brands b ON b.id = g.brand_id
       LEFT JOIN users u ON u.id = d.trainer_id
      WHERE m.phone = ? ORDER BY d.updated_at DESC, d.id DESC`,
    [account.phone],
  );
  const menu = rows.length ? new Map((await menuMeals(pool)).map((m) => [m.id, m])) : new Map();
  const plans = rows.map((row) => {
    const plan = planOut(row);
    let hidden = 0;
    const meals = plan.meals.map((meal) => {
      const picks = meal.picks.map((id) => menu.get(id)).filter(Boolean);
      const suit = picks.filter((m) => !rules.mealConflict(m, food).block);
      hidden += picks.length - suit.length;
      return { ...meal, picks: suit };
    });
    return { ...plan, meals, hidden, trainer: (row.trainer_name && row.trainer_name.trim()) || null, gym: row.gym, branch: row.branch };
  });
  return { shared: profile ? num(profile.shared) === 1 : false, plans };
}

/** The member's switch: let their gym trainers see their diet, allergies and dislikes */
async function setSharing(pool, userId, shared) {
  const [result] = await pool.query("UPDATE profiles SET food_shared_with_trainer = ? WHERE user_id = ?", [shared ? 1 : 0, userId]);
  if (result.affectedRows === 0) throw new ConflictError("Finish your profile first.");
  return { shared };
}

module.exports = { forTrainer, save, remove, forMember, setSharing };
