// Home screen content managed by admins: the hero promotions (the carousel at the top
// of the home screen) and the editable labels, quick-action cards and popular-meal
// selection around it. Members read the published content; admins change it.
//
// Nothing here is free text that the app executes. A promotion's button can only open a
// screen from DESTINATIONS, a quick-action card can only use an icon from
// QUICK_ACTION_ICONS, and an image is either one bundled with the app ("asset:<key>",
// see BUNDLED_IMAGES) or an https URL. The app keeps matching lists in
// Eato_client/src/data/home.ts and src/constants/images.ts; keep them in sync.
const { ValidationError } = require("./profile");

// Screens a promotion button or quick-action card may open (resolved to routes by the app)
const DESTINATIONS = ["home", "meals", "explore", "macro", "nutrition", "fitness", "community", "plans", "orders", "profile", "goals", "notifications", "addresses"];
// Icons a quick-action card may show (resolved to platform symbols by the app)
const QUICK_ACTION_ICONS = ["meals", "plans", "nutrition", "delivery", "flame", "heart", "calendar", "bag"];
// Images shipped inside the app (Eato_client/assets/images/home-*.jpg)
const BUNDLED_IMAGES = [
  "hero-bowl", "hero-meals", "hero-nutrition", "hero-delivery",
  "meal-grilled-chicken", "meal-paneer-tikka", "meal-salmon", "meal-lemon-herb-chicken",
];
const STATUSES = ["draft", "published", "disabled"];
const CTA_ACTIONS = ["open_screen"];
const TEXT_ALIGNMENTS = ["left", "center"];
const IMAGE_POSITIONS = ["right", "left"];

const limits = {
  title: 80, eyebrow: 40, headline: 80, description: 160, imageUrl: 500, imageAlt: 160, ctaLabel: 30,
  rotation: { min: 1, max: 30 }, // seconds a slide stays before the carousel moves on
  heading: 40, actionLabel: 30, quickActions: 6, popularMeals: 10, quickActionText: 40,
};

const MEAL_ID = /^[a-z0-9-]{1,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// What the home screen shows when the home_content row is missing (schema.sql seeds it)
const defaultHomeContent = {
  nutritionHeading: "Today's Nutrition",
  nutritionActionLabel: "Edit Goal",
  popularHeading: "Popular Meals",
  popularActionLabel: "View all",
  todayHeading: "Today",
  todayActionLabel: "View all",
  showTodaySection: true,
  quickActions: [
    { id: "meals", title: "Meals", subtitle: "Browse menu", icon: "meals", destination: "explore" },
    { id: "plans", title: "Plans", subtitle: "For your goals", icon: "plans", destination: "plans" },
    { id: "nutrition", title: "Nutrition", subtitle: "Track intake", icon: "nutrition", destination: "nutrition" },
    { id: "delivery", title: "Delivery", subtitle: "At your doorstep", icon: "delivery", destination: "orders" },
  ],
  popularMealIds: ["grilled-chicken-bowl", "paneer-tikka-bowl", "salmon-bowl"],
};

// ---------------------------------------------------------------------------
// Validation (one friendly line per problem, as the profile validators do)
// ---------------------------------------------------------------------------

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function requiredText(value, label, max) {
  if (typeof value !== "string") throw new ValidationError(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed === "") throw new ValidationError(`${label} is required.`);
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return trimmed;
}

function optionalText(value, label, max) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return trimmed === "" ? null : trimmed;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new ValidationError(`${label} isn't a valid choice.`);
  return value;
}

function optionalOneOf(value, allowed, label) {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, allowed, label);
}

// "asset:<bundled key>" or an https URL without credentials
function imageReference(value, label = "Image") {
  const text = requiredText(value, label, limits.imageUrl);
  if (text.startsWith("asset:")) {
    if (!BUNDLED_IMAGES.includes(text.slice("asset:".length))) throw new ValidationError(`${label} isn't one of the bundled images.`);
    return text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError(`${label} must be a bundled image or an https URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new ValidationError(`${label} must be an https URL.`);
  return url.toString();
}

function optionalHexColor(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new ValidationError(`${label} must be a hex colour like #1A322A.`);
  return value.toUpperCase();
}

// null/"" → null; otherwise an ISO date-time the app sent → Date
function optionalDateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`${label} must be a date.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${label} isn't a valid date.`);
  return date;
}

function rejectUnknownKeys(body, allowed, label) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ValidationError(`${label} has an unexpected field: ${key}.`);
  }
}

const PROMOTION_FIELDS = [
  "title", "eyebrow", "headline", "description", "imageUrl", "imageAlt",
  "ctaLabel", "ctaAction", "ctaDestination", "secondaryCtaLabel", "secondaryCtaAction", "secondaryCtaDestination",
  "textAlign", "imagePosition", "backgroundColor", "textColor",
  "status", "rotationIntervalSeconds", "startsAt", "endsAt",
];

// Checks a complete promotion (create, or an existing one merged with a PATCH) and returns
// clean column values. Throws a ValidationError with one friendly line.
function validatePromotion(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the promotion as an object.");
  rejectUnknownKeys(body, PROMOTION_FIELDS, "The promotion");

  const secondaryLabel = optionalText(body.secondaryCtaLabel, "Secondary button label", limits.ctaLabel);
  const secondaryDestination = optionalOneOf(body.secondaryCtaDestination, DESTINATIONS, "Secondary button destination");
  if ((secondaryLabel === null) !== (secondaryDestination === null)) {
    throw new ValidationError("A secondary button needs both a label and a destination.");
  }

  const rotation = body.rotationIntervalSeconds === undefined ? 2 : body.rotationIntervalSeconds;
  if (!Number.isInteger(rotation) || rotation < limits.rotation.min || rotation > limits.rotation.max) {
    throw new ValidationError(`Rotation must be a whole number of seconds between ${limits.rotation.min} and ${limits.rotation.max}.`);
  }

  const startsAt = optionalDateTime(body.startsAt, "Start date");
  const endsAt = optionalDateTime(body.endsAt, "End date");
  if (startsAt && endsAt && endsAt <= startsAt) throw new ValidationError("The end date must be after the start date.");

  return {
    title: requiredText(body.title, "Title", limits.title),
    eyebrow: requiredText(body.eyebrow, "Eyebrow text", limits.eyebrow),
    headline: requiredText(body.headline, "Headline", limits.headline),
    description: requiredText(body.description, "Description", limits.description),
    image_url: imageReference(body.imageUrl),
    image_alt: optionalText(body.imageAlt, "Image description", limits.imageAlt),
    cta_label: requiredText(body.ctaLabel, "Button label", limits.ctaLabel),
    cta_action: body.ctaAction === undefined ? "open_screen" : oneOf(body.ctaAction, CTA_ACTIONS, "Button action"),
    cta_destination: oneOf(body.ctaDestination, DESTINATIONS, "Button destination"),
    secondary_cta_label: secondaryLabel,
    secondary_cta_action: secondaryLabel === null ? null : optionalOneOf(body.secondaryCtaAction, CTA_ACTIONS, "Secondary button action") ?? "open_screen",
    secondary_cta_destination: secondaryDestination,
    text_align: body.textAlign === undefined ? "left" : oneOf(body.textAlign, TEXT_ALIGNMENTS, "Text alignment"),
    image_position: body.imagePosition === undefined ? "right" : oneOf(body.imagePosition, IMAGE_POSITIONS, "Image position"),
    background_color: optionalHexColor(body.backgroundColor, "Background colour"),
    text_color: optionalHexColor(body.textColor, "Text colour"),
    status: body.status === undefined ? "draft" : oneOf(body.status, STATUSES, "Status"),
    rotation_interval_seconds: rotation,
    starts_at: startsAt,
    ends_at: endsAt,
  };
}

const HOME_CONTENT_FIELDS = [
  "nutritionHeading", "nutritionActionLabel", "popularHeading", "popularActionLabel",
  "todayHeading", "todayActionLabel", "showTodaySection", "quickActions", "popularMealIds",
];

function validateQuickAction(value, index) {
  const label = `Quick action ${index + 1}`;
  if (!isPlainObject(value)) throw new ValidationError(`${label} must be an object.`);
  rejectUnknownKeys(value, ["id", "title", "subtitle", "icon", "destination"], label);
  const id = requiredText(value.id, `${label} id`, 40);
  if (!MEAL_ID.test(id)) throw new ValidationError(`${label} id may only use lowercase letters, digits and dashes.`);
  return {
    id,
    title: requiredText(value.title, `${label} title`, limits.quickActionText),
    subtitle: requiredText(value.subtitle, `${label} subtitle`, limits.quickActionText),
    icon: oneOf(value.icon, QUICK_ACTION_ICONS, `${label} icon`),
    destination: oneOf(value.destination, DESTINATIONS, `${label} destination`),
  };
}

// Checks the editable home screen settings and returns clean column values
function validateHomeContent(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send the home screen settings as an object.");
  rejectUnknownKeys(body, HOME_CONTENT_FIELDS, "The home screen settings");
  if (typeof body.showTodaySection !== "boolean") throw new ValidationError("showTodaySection must be true or false.");

  if (!Array.isArray(body.quickActions)) throw new ValidationError("Quick actions must be a list.");
  if (body.quickActions.length > limits.quickActions) throw new ValidationError(`At most ${limits.quickActions} quick actions.`);
  const quickActions = body.quickActions.map(validateQuickAction);
  if (new Set(quickActions.map((action) => action.id)).size !== quickActions.length) {
    throw new ValidationError("Quick action ids must be unique.");
  }

  if (!Array.isArray(body.popularMealIds) || body.popularMealIds.some((id) => typeof id !== "string" || !MEAL_ID.test(id))) {
    throw new ValidationError("Popular meals must be a list of meal ids.");
  }
  if (body.popularMealIds.length > limits.popularMeals) throw new ValidationError(`At most ${limits.popularMeals} popular meals.`);
  if (new Set(body.popularMealIds).size !== body.popularMealIds.length) throw new ValidationError("A meal can only be listed once.");

  return {
    nutrition_heading: requiredText(body.nutritionHeading, "Nutrition heading", limits.heading),
    nutrition_action_label: requiredText(body.nutritionActionLabel, "Nutrition action label", limits.actionLabel),
    popular_heading: requiredText(body.popularHeading, "Popular meals heading", limits.heading),
    popular_action_label: requiredText(body.popularActionLabel, "Popular meals action label", limits.actionLabel),
    today_heading: requiredText(body.todayHeading, "Today heading", limits.heading),
    today_action_label: requiredText(body.todayActionLabel, "Today action label", limits.actionLabel),
    show_today_section: body.showTodaySection,
    quick_actions: quickActions,
    popular_meal_ids: body.popularMealIds,
  };
}

// Route parameter → positive integer id, or a 400
function promotionId(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) throw new ValidationError("That promotion id isn't valid.");
  return Number(value);
}

// ---------------------------------------------------------------------------
// Rows ↔ API shape
// ---------------------------------------------------------------------------

const toIso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

// The status the admin sees: a published promotion whose window hasn't opened is "scheduled",
// one whose window has closed is "ended". Both are stored as "published".
function effectiveStatus(row, now) {
  if (row.status !== "published") return row.status;
  if (row.starts_at && row.starts_at > now) return "scheduled";
  if (row.ends_at && row.ends_at <= now) return "ended";
  return "published";
}

function promotionToApi(row, now = new Date()) {
  return {
    id: row.id,
    title: row.title,
    eyebrow: row.eyebrow,
    headline: row.headline,
    description: row.description,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    ctaLabel: row.cta_label,
    ctaAction: row.cta_action,
    ctaDestination: row.cta_destination,
    secondaryCtaLabel: row.secondary_cta_label,
    secondaryCtaAction: row.secondary_cta_action,
    secondaryCtaDestination: row.secondary_cta_destination,
    textAlign: row.text_align,
    imagePosition: row.image_position,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    status: row.status,
    effectiveStatus: effectiveStatus(row, now),
    displayOrder: row.display_order,
    rotationIntervalSeconds: row.rotation_interval_seconds,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// mysql2 parses JSON columns itself; a string means the column was stored as text
const fromJson = (value, fallback) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
};

function mealToApi(row) {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
  };
}

const PROMOTION_COLUMNS = [
  "title", "eyebrow", "headline", "description", "image_url", "image_alt",
  "cta_label", "cta_action", "cta_destination", "secondary_cta_label", "secondary_cta_action", "secondary_cta_destination",
  "text_align", "image_position", "background_color", "text_color",
  "status", "rotation_interval_seconds", "starts_at", "ends_at",
];

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function listPromotions(pool) {
  const [rows] = await pool.query("SELECT * FROM promotions ORDER BY display_order, id");
  const now = new Date();
  return rows.map((row) => promotionToApi(row, now));
}

async function getPromotion(pool, id) {
  const [rows] = await pool.query("SELECT * FROM promotions WHERE id = ?", [id]);
  return rows.length === 0 ? null : promotionToApi(rows[0]);
}

// Published promotions inside their display window, in display order (what members see)
async function activePromotions(pool) {
  const [rows] = await pool.query(
    `SELECT * FROM promotions
     WHERE status = 'published'
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at > NOW())
     ORDER BY display_order, id`,
  );
  const now = new Date();
  return rows.map((row) => promotionToApi(row, now));
}

// New promotions go to the end of the carousel
async function createPromotion(pool, values, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[{ next }]] = await connection.query("SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM promotions FOR UPDATE");
    const columns = [...PROMOTION_COLUMNS, "display_order", "created_by", "updated_by"];
    const params = [...PROMOTION_COLUMNS.map((column) => values[column]), next, userId, userId];
    const [result] = await connection.query(
      `INSERT INTO promotions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      params,
    );
    await connection.commit();
    return getPromotion(pool, result.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updatePromotion(pool, id, values, userId) {
  const assignments = PROMOTION_COLUMNS.map((column) => `${column} = ?`).join(", ");
  const [result] = await pool.query(
    `UPDATE promotions SET ${assignments}, updated_by = ? WHERE id = ?`,
    [...PROMOTION_COLUMNS.map((column) => values[column]), userId, id],
  );
  return result.affectedRows === 1 ? getPromotion(pool, id) : null;
}

async function setPromotionStatus(pool, id, status, userId) {
  if (!STATUSES.includes(status)) throw new ValidationError("Status isn't a valid choice.");
  const [result] = await pool.query("UPDATE promotions SET status = ?, updated_by = ? WHERE id = ?", [status, userId, id]);
  return result.affectedRows === 1 ? getPromotion(pool, id) : null;
}

async function deletePromotion(pool, id) {
  const [result] = await pool.query("DELETE FROM promotions WHERE id = ?", [id]);
  return result.affectedRows === 1;
}

// `ids` is the complete new order (every promotion exactly once); positions become 1, 2, 3…
async function reorderPromotions(pool, ids, userId) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new ValidationError("Send the promotion ids in their new order.");
  }
  if (new Set(ids).size !== ids.length) throw new ValidationError("Each promotion can appear only once.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT id FROM promotions FOR UPDATE");
    const existing = new Set(rows.map((row) => row.id));
    if (ids.length !== existing.size || ids.some((id) => !existing.has(id))) {
      throw new ValidationError("The list must include every promotion exactly once.");
    }
    for (let position = 0; position < ids.length; position++) {
      await connection.query("UPDATE promotions SET display_order = ?, updated_by = ? WHERE id = ?", [position + 1, userId, ids[position]]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return listPromotions(pool);
}

// The editable settings plus the popular meals they point at (available ones, in the saved order)
async function loadHomeContent(pool) {
  const [rows] = await pool.query("SELECT * FROM home_content WHERE id = 1");
  const row = rows[0];
  const content = row
    ? {
        nutritionHeading: row.nutrition_heading,
        nutritionActionLabel: row.nutrition_action_label,
        popularHeading: row.popular_heading,
        popularActionLabel: row.popular_action_label,
        todayHeading: row.today_heading,
        todayActionLabel: row.today_action_label,
        showTodaySection: Boolean(row.show_today_section),
        quickActions: fromJson(row.quick_actions, defaultHomeContent.quickActions),
        popularMealIds: fromJson(row.popular_meal_ids, defaultHomeContent.popularMealIds),
      }
    : { ...defaultHomeContent };

  let popularMeals = [];
  if (content.popularMealIds.length > 0) {
    const [meals] = await pool.query(
      "SELECT id, name, image_url, calories, protein_g, carbs_g, fat_g FROM meals WHERE is_available = TRUE AND id IN (?)",
      [content.popularMealIds],
    );
    const byId = new Map(meals.map((meal) => [meal.id, mealToApi(meal)]));
    popularMeals = content.popularMealIds.map((id) => byId.get(id)).filter(Boolean);
  }
  return { ...content, popularMeals, updatedAt: toIso(row?.updated_at) };
}

async function saveHomeContent(pool, values, userId) {
  if (values.popular_meal_ids.length > 0) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM meals WHERE id IN (?)", [values.popular_meal_ids]);
    if (n !== values.popular_meal_ids.length) throw new ValidationError("One of the popular meals doesn't exist.");
  }
  await pool.query(
    `INSERT INTO home_content (id, nutrition_heading, nutrition_action_label, popular_heading, popular_action_label,
       today_heading, today_action_label, show_today_section, quick_actions, popular_meal_ids, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nutrition_heading = VALUES(nutrition_heading), nutrition_action_label = VALUES(nutrition_action_label),
       popular_heading = VALUES(popular_heading), popular_action_label = VALUES(popular_action_label),
       today_heading = VALUES(today_heading), today_action_label = VALUES(today_action_label),
       show_today_section = VALUES(show_today_section), quick_actions = VALUES(quick_actions),
       popular_meal_ids = VALUES(popular_meal_ids), updated_by = VALUES(updated_by)`,
    [
      values.nutrition_heading, values.nutrition_action_label, values.popular_heading, values.popular_action_label,
      values.today_heading, values.today_action_label, values.show_today_section,
      JSON.stringify(values.quick_actions), JSON.stringify(values.popular_meal_ids), userId,
    ],
  );
  return loadHomeContent(pool);
}

// Every meal on the menu, for the admin's popular-meal picker
async function listMeals(pool) {
  const [rows] = await pool.query(
    "SELECT id, name, image_url, calories, protein_g, carbs_g, fat_g FROM meals WHERE is_available = TRUE ORDER BY name",
  );
  return rows.map(mealToApi);
}

module.exports = {
  DESTINATIONS, QUICK_ACTION_ICONS, BUNDLED_IMAGES, STATUSES, limits, defaultHomeContent,
  validatePromotion, validateHomeContent, promotionId, promotionToApi, effectiveStatus,
  listPromotions, getPromotion, activePromotions, createPromotion, updatePromotion, setPromotionStatus,
  deletePromotion, reorderPromotions, loadHomeContent, saveHomeContent, listMeals,
};
