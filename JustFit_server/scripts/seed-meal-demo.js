// Demo data for testing the meal screens by hand (added 2026-11-10 at the user's request): the
// Meals tab, a meal's page, the cart, coupons, ordering and the Super Admin's meal screens.
//
//   npm run seed-meal-demo              adds Indian meals with photos, tiles and food categories,
//                                       banners, coupons, delivery pincodes and one active kitchen
//                                       that cooks every meal on the menu (so orders go through)
//   npm run seed-meal-demo -- --remove  deletes exactly what it added, nothing else
//
// Demo meals have ids starting "demo-"; everything else it adds (categories, banners, coupons,
// pincodes, the kitchen and its links to the existing meals, the photo files) is listed in
// uploads/seed-meal-demo.json, which --remove reads. Real rows are never changed. Photos are
// the app's own bundled food pictures, copied under new names. Runs against JustFit_server/.env.
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { pool } = require("../database");
const photos = require("../meals/photos");

const RECORD = path.join(__dirname, "..", "uploads", "seed-meal-demo.json");
const ASSETS = path.join(__dirname, "..", "..", "JustFit_client", "assets", "images");
const PICTURES = [
  "home-meal-grilled-chicken.jpg", "home-meal-paneer-tikka.jpg", "home-meal-salmon.jpg", "home-meal-lemon-herb-chicken.jpg",
  "home-hero-bowl.jpg", "home-hero-meals.jpg", "home-hero-nutrition.jpg", "home-hero-delivery.jpg",
];
const BANNER_PICTURES = ["home-hero-bowl.jpg", "home-hero-meals.jpg", "home-hero-nutrition.jpg"];

// India's today as YYYY-MM-DD, and days from it
const todayIndia = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const rupees = (n) => Math.round(n * 100);

// name, diet, tags, kcal, protein, carbs, fat, price, old price (null = none), serving, ingredients, description, popular, category
const MEALS = [
  ["Paneer Tikka Rice Bowl", "vegetarian", "bestseller,high_protein", 520, 32, 58, 16, 249, 299, "1 bowl · 420 g", "Paneer, basmati rice, capsicum, onion, curd, spices", "Smoky tandoori paneer on jeera rice with mint chutney.", 1, "bowls"],
  ["Chicken Tikka Bowl", "non-vegetarian", "bestseller,high_protein", 560, 42, 52, 15, 279, 329, "1 bowl · 450 g", "Chicken breast, brown rice, cucumber, onion, curd", "Char-grilled chicken tikka, brown rice and a cool raita.", 1, "bowls"],
  ["Rajma Chawal Bowl", "vegan", "", 480, 18, 82, 8, 179, null, "1 bowl · 400 g", "Kidney beans, rice, tomato, onion, ginger, garlic", "Home-style Punjabi rajma with steamed rice.", 0, "bowls"],
  ["Egg Bhurji Wrap", "eggetarian", "high_protein", 410, 24, 38, 17, 159, 189, "1 wrap · 250 g", "Eggs, whole-wheat roti, onion, tomato, green chilli", "Spiced scrambled eggs rolled in a whole-wheat roti.", 1, "wraps"],
  ["South Indian Thali", "vegetarian", "special", 640, 20, 98, 18, 299, 349, "1 thali", "Rice, sambar, rasam, poriyal, curd, papad", "Rice, sambar, rasam, a vegetable poriyal, curd and papad.", 1, "thalis"],
  ["North Indian Combo", "vegetarian", "special", 690, 24, 92, 22, 319, null, "1 thali", "Roti, dal makhani, paneer sabzi, jeera rice, salad", "Two rotis, dal makhani, paneer sabzi, jeera rice and salad.", 0, "thalis"],
  ["Chicken Biryani (Lite)", "non-vegetarian", "bestseller,gourmet", 610, 36, 70, 18, 299, 349, "1 plate · 450 g", "Chicken, basmati rice, curd, mint, whole spices", "Dum-style biryani made with less oil and more chicken.", 1, "bowls"],
  ["Masala Oats Upma", "vegan", "", 320, 11, 48, 9, 129, null, "1 bowl · 300 g", "Oats, vegetables, mustard seeds, curry leaves", "Savoury oats with vegetables, South Indian style.", 0, "breakfast"],
  ["Idli Sambar (4 pcs)", "vegan", "", 360, 12, 66, 4, 119, 139, "4 idlis + sambar", "Rice, urad dal, toor dal, vegetables", "Soft steamed idlis with sambar and coconut chutney.", 1, "breakfast"],
  ["Moong Dal Chilla", "vegetarian", "high_protein", 340, 21, 40, 9, 149, null, "3 chillas", "Moong dal, paneer, onion, coriander", "Protein-rich lentil pancakes with a paneer filling.", 0, "breakfast"],
  ["Grilled Fish & Veggies", "non-vegetarian", "gourmet,high_protein", 450, 40, 22, 20, 349, 399, "1 plate · 380 g", "Basa fillet, broccoli, carrot, lemon, garlic", "Lemon-garlic grilled fish with sautéed vegetables.", 0, "bowls"],
  ["Sprouts Chaat Salad", "vegan", "", 260, 14, 38, 5, 139, null, "1 bowl · 280 g", "Moong sprouts, onion, tomato, cucumber, lemon", "Crunchy sprouts tossed with chaat masala and lemon.", 0, "salads"],
  ["Paneer Kathi Roll", "vegetarian", "", 470, 22, 46, 21, 189, 219, "1 roll", "Paneer, whole-wheat paratha, onion, capsicum", "Tandoori paneer wrapped in a flaky whole-wheat paratha.", 0, "wraps"],
  ["Soya Chunks Pulao", "vegan", "high_protein", 430, 28, 60, 8, 169, null, "1 bowl · 400 g", "Soya chunks, rice, peas, carrot, spices", "Fragrant pulao with protein-packed soya chunks.", 0, "bowls"],
  ["Greek Yogurt Fruit Bowl", "vegetarian", "", 290, 17, 40, 6, 159, 179, "1 bowl · 250 g", "Hung curd, banana, apple, pomegranate, honey, nuts", "Thick hung curd with seasonal fruit and a drizzle of honey.", 0, "breakfast"],
  ["Ragi Dosa & Chutney", "vegan", "special", 380, 10, 64, 9, 139, null, "2 dosas", "Ragi, rice, urad dal, coconut", "Crisp finger-millet dosas with coconut chutney.", 0, "breakfast"],
];

const slug = (name) => `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`.slice(0, 64);

// Every photo file written this run, deleted again if the seed fails (the rows roll back)
const written = [];
async function savePicture(file, record) {
  const bytes = fs.readFileSync(path.join(ASSETS, file));
  const key = await photos.save(bytes, "image/jpeg");
  record.photoKeys.push(key);
  written.push(key);
  return key;
}

async function seed(db) {
  if (fs.existsSync(RECORD)) throw new Error("Demo meal data is already there (uploads/seed-meal-demo.json). Run with --remove first.");
  const today = todayIndia();
  const record = { addedAt: new Date().toISOString(), photoKeys: [], categories: [], banners: [], coupons: [], pincodes: [], kitchenId: null, kitchenMeals: [] };

  // Meals, each with its own copy of a bundled picture
  const ids = {};
  for (const [i, m] of MEALS.entries()) {
    const [name, diet, tags, kcal, p, c, f, price, mrp, serving, ingredients, description, popular] = m;
    const id = slug(name);
    ids[name] = id;
    const key = await savePicture(PICTURES[i % PICTURES.length], record);
    await db.query(
      `INSERT INTO meals (id, name, description, serving_size, ingredients, image_key, diet, tags, calories, protein_g, carbs_g, fat_g, price_paise, mrp_paise, is_popular, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, name, description, serving, ingredients, key, diet, tags, kcal, p, c, f, rupees(price), mrp ? rupees(mrp) : null, popular],
    );
  }
  const byGroup = (group) => MEALS.filter((m) => m[13] === group).map((m) => ids[m[0]]);

  // Tiles (quick picks on the Meals tab) and food categories (circles; featured ones get a row of cards)
  const categories = [
    { kind: "tile", name: "Under ₹199", subtitle: "Light on the wallet", badge: "Value", maxPrice: 199, picture: 0 },
    { kind: "tile", name: "Protein Packed", subtitle: "25 g and more", badge: "Gym", tag: "high_protein", picture: 1 },
    { kind: "tile", name: "Chef's Specials", subtitle: "Today's picks", badge: "New", tag: "special", picture: 2 },
    { kind: "food", name: "Meal Bowls", subtitle: "Balanced one-bowl meals", group: "bowls", featured: 1, picture: 4 },
    { kind: "food", name: "Thalis & Combos", subtitle: "A full plate", group: "thalis", featured: 1, picture: 5 },
    { kind: "food", name: "Breakfast", subtitle: "Start the day right", group: "breakfast", featured: 1, picture: 6 },
    { kind: "food", name: "Wraps & Rolls", subtitle: "On the go", group: "wraps", featured: 0, picture: 3 },
    { kind: "food", name: "Salads", subtitle: "Fresh and light", group: "salads", featured: 0, picture: 7 },
  ];
  for (const [order, cat] of categories.entries()) {
    const key = await savePicture(PICTURES[cat.picture], record);
    const [r] = await db.query(
      "INSERT INTO meal_categories (kind, name, subtitle, badge, image_key, match_tag, max_price_paise, featured, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
      [cat.kind, cat.name, cat.subtitle, cat.badge ?? null, key, cat.tag ?? null, cat.maxPrice ? rupees(cat.maxPrice) : null, cat.featured ?? 0, order + 1],
    );
    record.categories.push(r.insertId);
    cat.id = r.insertId;
    if (cat.group) for (const mealId of byGroup(cat.group)) await db.query("INSERT INTO meal_category_items (category_id, meal_id) VALUES (?, ?)", [r.insertId, mealId]);
  }
  const combos = categories.find((c) => c.group === "thalis");

  // Banners for the carousel, live for a month
  const banners = [
    { title: "Fuel your workouts", description: "High-protein meals from ₹159", badge: "Protein", cta: "Order Now", kind: "tag", ref: "high_protein" },
    { title: "Thali Tuesdays", description: "Full South and North Indian plates", badge: "Combo", cta: "See thalis", kind: "category", ref: String(combos.id) },
    { title: "Try the Lite Biryani", description: "All the flavour, less oil", badge: "Bestseller", cta: "Order Now", kind: "meal", ref: ids["Chicken Biryani (Lite)"] },
  ];
  for (const [order, b] of banners.entries()) {
    const key = await savePicture(BANNER_PICTURES[order], record);
    const [r] = await db.query(
      "INSERT INTO meal_banners (title, description, badge, cta_label, target_kind, target_ref, image_key, starts_on, ends_on, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
      [b.title, b.description, b.badge, b.cta, b.kind, b.ref, key, addDays(today, -1), addDays(today, 30), order + 1],
    );
    record.banners.push(r.insertId);
  }

  // Coupons (Offers for you on the Meals tab; applied in the cart)
  const coupons = [
    ["FIT10", "10% off, up to ₹100", "percent", 10, null, 100, 299, 5],
    ["FIRST50", "₹50 off your first order", "flat", null, 50, null, 199, 1],
    ["PROTEIN20", "20% off, up to ₹150", "percent", 20, null, 150, 499, 3],
  ];
  for (const [code, title, kind, pct, flat, max, min, uses] of coupons) {
    const [existing] = await db.query("SELECT id FROM meal_coupons WHERE code = ?", [code]);
    if (existing.length) continue; // a real coupon with that code stays as it is
    const [r] = await db.query(
      "INSERT INTO meal_coupons (code, title, kind, percent_off, flat_off_paise, max_discount_paise, min_order_paise, per_member_limit, starts_on, ends_on, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [code, title, kind, pct, flat ? rupees(flat) : null, max ? rupees(max) : null, rupees(min), uses, addDays(today, -1), addDays(today, 30)],
    );
    record.coupons.push(r.insertId);
  }
  // FIRST50 is a welcome offer: only for members who have never ordered (once migration 2027-01-28 has run)
  const [[firstOrder]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_coupons' AND COLUMN_NAME = 'first_order_only'");
  if (Number(firstOrder.n) > 0 && record.coupons.length) await db.query("UPDATE meal_coupons SET first_order_only = 1 WHERE code = 'FIRST50' AND id IN (?)", [record.coupons]);

  // Delivery pincodes around Tumakuru (572103 is usually there already)
  for (const [pincode, area] of [["572101", "Tumakuru Town"], ["572102", "Batawadi"], ["572103", "Tumakuru"], ["572104", "Siddaganga"], ["572106", "Kyathasandra"]]) {
    const [existing] = await db.query("SELECT pincode FROM delivery_pincodes WHERE pincode = ?", [pincode]);
    if (existing.length) continue;
    await db.query("INSERT INTO delivery_pincodes (pincode, area, active) VALUES (?, ?, 1)", [pincode, area]);
    record.pincodes.push(pincode);
  }

  // One active kitchen open all day, serving those pincodes and cooking every meal on the menu
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["06:00", "22:00"]]]));
  const [k] = await db.query(
    `INSERT INTO kitchens (name, contact_name, phone, email, address, area, city, pincode, latitude, longitude, opening_hours, max_daily_orders, prep_capacity, radius_km, status)
     VALUES ('justFit Kitchen, Tumakuru (demo)', 'Ravi Kumar', '9000012345', 'kitchen.demo@justfit.test', '12, BH Road, near SIT College', 'SIT Extension', 'Tumakuru', '572103', 13.3379, 77.1173, ?, 300, 80, 20, 'active')`,
    [JSON.stringify(hours)],
  );
  record.kitchenId = k.insertId;
  for (const pincode of ["572101", "572102", "572103", "572104", "572106"]) await db.query("INSERT INTO kitchen_pincodes (kitchen_id, pincode) VALUES (?, ?)", [k.insertId, pincode]);
  const [menu] = await db.query("SELECT id FROM meals WHERE is_available = 1");
  for (const { id } of menu) {
    await db.query("INSERT INTO kitchen_meals (kitchen_id, meal_id, available) VALUES (?, ?, 1)", [k.insertId, id]);
    record.kitchenMeals.push(id);
  }

  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2));
  console.log(`Added ${MEALS.length} meals, ${record.categories.length} categories, ${record.banners.length} banners, ${record.coupons.length} coupons, ${record.pincodes.length} pincodes and 1 kitchen cooking ${record.kitchenMeals.length} meals.`);
}

async function removeDemo(db) {
  const record = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, "utf8")) : { photoKeys: [], categories: [], banners: [], coupons: [], pincodes: [], kitchenId: null };
  const counts = {};
  if (record.kitchenId) {
    counts.kitchenMeals = (await db.query("DELETE FROM kitchen_meals WHERE kitchen_id = ?", [record.kitchenId]))[0].affectedRows;
    await db.query("DELETE FROM kitchen_pincodes WHERE kitchen_id = ?", [record.kitchenId]);
    await db.query("UPDATE orders SET kitchen_id = NULL WHERE kitchen_id = ?", [record.kitchenId]);
    counts.kitchens = (await db.query("DELETE FROM kitchens WHERE id = ?", [record.kitchenId]))[0].affectedRows;
  }
  if (record.banners.length) counts.banners = (await db.query("DELETE FROM meal_banners WHERE id IN (?)", [record.banners]))[0].affectedRows;
  if (record.categories.length) {
    await db.query("DELETE FROM meal_category_items WHERE category_id IN (?)", [record.categories]);
    counts.categories = (await db.query("DELETE FROM meal_categories WHERE id IN (?)", [record.categories]))[0].affectedRows;
  }
  if (record.coupons.length) {
    await db.query("UPDATE orders SET coupon_id = NULL WHERE coupon_id IN (?)", [record.coupons]);
    counts.coupons = (await db.query("DELETE FROM meal_coupons WHERE id IN (?)", [record.coupons]))[0].affectedRows;
  }
  // Demo meals: orders keep their copies (order_items.meal_id goes to NULL, as when an admin deletes a meal)
  const [demo] = await db.query("SELECT id, image_key FROM meals WHERE id LIKE 'demo-%'");
  if (demo.length) {
    const demoIds = demo.map((m) => m.id);
    await db.query("DELETE FROM meal_category_items WHERE meal_id IN (?)", [demoIds]);
    await db.query("DELETE FROM kitchen_meals WHERE meal_id IN (?)", [demoIds]);
    await db.query("UPDATE order_items SET meal_id = NULL WHERE meal_id IN (?)", [demoIds]);
    for (const table of ["meal_favorites", "meal_recipes", "meal_prep"]) {
      try { await db.query(`DELETE FROM ${table} WHERE meal_id IN (?)`, [demoIds]); } catch (error) { if (error?.code !== "ER_NO_SUCH_TABLE") throw error; }
    }
    counts.meals = (await db.query("DELETE FROM meals WHERE id IN (?)", [demoIds]))[0].affectedRows;
  }
  // Only pincodes this script added (an address there stays saved; deliveries there stop)
  if (record.pincodes.length) counts.pincodes = (await db.query("DELETE FROM delivery_pincodes WHERE pincode IN (?)", [record.pincodes]))[0].affectedRows;
  return { counts, photoKeys: [...record.photoKeys, ...demo.map((m) => m.image_key).filter(Boolean)] };
}

async function main() {
  const remove = process.argv.includes("--remove");
  const db = await pool.getConnection();
  console.log(`Database ${process.env.DB_NAME}`);
  try {
    await db.beginTransaction();
    if (remove) {
      const { counts, photoKeys } = await removeDemo(db);
      await db.commit();
      for (const key of new Set(photoKeys)) await photos.remove(key).catch(() => {});
      if (fs.existsSync(RECORD)) fs.unlinkSync(RECORD);
      console.log("Removed:", counts);
    } else {
      await seed(db);
      await db.commit();
    }
  } catch (error) {
    await db.rollback();
    for (const key of written) await photos.remove(key).catch(() => {});
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
