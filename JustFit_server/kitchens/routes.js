// Kitchens and the meal-operations dashboard (Meal Operations phase 1, 2026-11-10), mounted inside
// /api/admin/kitchen (adminOnly: the role is read from the database on every request):
//   GET  /dashboard?day=            one India day of operations
//   GET  /report?day=&format=       that day's paid orders as xlsx (default) or csv
//   GET  /kitchens?status=&search=  POST /kitchens (photo optional)
//   GET  /kitchens/:id              PUT /kitchens/:id (every field)   GET /kitchens/:id/photo
//   POST /kitchens/:id/status       { status, note }
//   POST /kitchens/:id/staff        PUT|DELETE /kitchens/:id/staff/:staffId
// Before migration 2026-12-30 these answer 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const photos = require("../meals/photos");
const { ValidationError } = require("../profile");
const kitchens = require("./service");
const rules = require("./rules");

const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "16kb" });
const photoBody = express.json({ limit: Math.ceil(photos.mealPhotoLimits.maxBytes * (4 / 3)) + 32 * 1024 });
// 120 kitchen and staff changes an hour per admin (KITCHEN_CHANGES_PER_HOUR); 30 reports an hour
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.KITCHEN_CHANGES_PER_HOUR) || 120, windowMs: 60 * 60 * 1000 }));
const reportLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));

const MIGRATION = "Kitchens need the 2026-12-30-kitchens migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });

const router = express.Router({ caseSensitive: true, strict: true });

router.get("/dashboard", route(async (req, res) => {
  const { day, today } = rules.dashboardQuery(req.query);
  res.json(await kitchens.dashboard(pool(req), { day, today }));
}));
router.get("/report", reportLimit, route(async (req, res) => {
  const file = await kitchens.report(pool(req), rules.dashboardQuery(req.query));
  res.setHeader("Content-Type", file.type);
  res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
  res.send(file.body);
}));

function listQuery(query) {
  rules.onlyFields(query, ["status", "search"]);
  const status = query.status ?? null;
  if (status !== null && !rules.STATUSES.includes(status)) throw new ValidationError("Pick a kitchen status from the list.");
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 40) : "";
  if (query.search !== undefined && typeof query.search !== "string") throw new ValidationError("Search with text.");
  return { status, search };
}

router.get("/kitchens", route(async (req, res) => {
  res.json(await kitchens.list(pool(req), listQuery(req.query)));
}));

// The kitchen's fields with an optional photo: { …fields, photo?: { data, mediaType }, removePhoto?: true }
async function withPhoto(req, res) {
  const { photo, removePhoto, ...fields } = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const values = rules.kitchenBody(fields);
  if (removePhoto !== undefined && removePhoto !== true) throw new ValidationError("Unexpected field: removePhoto.");
  if (photo === undefined || photo === null) return { values, imageKey: removePhoto ? null : undefined };
  const checked = photos.checkMealPhoto(photo);
  if (!checked.ok) {
    res.status(checked.status).json({ error: checked.error });
    return null;
  }
  return { values, imageKey: await photos.save(checked.bytes, checked.mediaType) };
}
async function keepingPhoto(imageKey, write) {
  try {
    return await write();
  } catch (error) {
    if (imageKey) await photos.remove(imageKey).catch(() => {});
    throw error;
  }
}

router.post("/kitchens", changeLimit, photoBody, route(async (req, res) => {
  const got = await withPhoto(req, res);
  if (!got) return;
  const { oldImageKey: _none, ...saved } = await keepingPhoto(got.imageKey, () => kitchens.save(pool(req), null, got.values, got.imageKey, req.userId));
  await recordAdminAction(pool(req), req, "kitchen.create", "kitchen", String(saved.kitchen.id), `Added kitchen “${saved.kitchen.name}”`);
  res.status(201).json(saved);
}));
router.get("/kitchens/:id", route(async (req, res) => {
  res.json(await kitchens.get(pool(req), rules.positiveId(req.params.id, "kitchen")));
}));
router.put("/kitchens/:id", changeLimit, photoBody, route(async (req, res) => {
  const id = rules.positiveId(req.params.id, "kitchen");
  const got = await withPhoto(req, res);
  if (!got) return;
  const { oldImageKey, ...saved } = await keepingPhoto(got.imageKey, () => kitchens.save(pool(req), id, got.values, got.imageKey, req.userId));
  if (oldImageKey && oldImageKey !== got.imageKey) await photos.remove(oldImageKey).catch(() => {});
  await recordAdminAction(pool(req), req, "kitchen.edit", "kitchen", String(id), `Edited kitchen “${saved.kitchen.name}”`);
  res.json(saved);
}));
router.get("/kitchens/:id/photo", route(async (req, res) => {
  const file = await photos.read(await kitchens.photoKey(pool(req), rules.positiveId(req.params.id, "kitchen")));
  if (!file) return res.status(404).json({ error: "That kitchen has no photo." });
  photos.send(res, file);
}));

const STATUS_WORD = { active: "Activated", inactive: "Deactivated", temporarily_closed: "Closed for a while", maintenance: "Put under maintenance" };
router.post("/kitchens/:id/status", changeLimit, smallBody, route(async (req, res) => {
  const id = rules.positiveId(req.params.id, "kitchen");
  const body = rules.statusBody(req.body);
  const saved = await kitchens.setStatus(pool(req), id, body);
  await recordAdminAction(pool(req), req, `kitchen.${body.status}`, "kitchen", String(id), `${STATUS_WORD[body.status]} kitchen “${saved.kitchen.name}”`);
  res.json(saved);
}));

router.post("/kitchens/:id/staff", changeLimit, smallBody, route(async (req, res) => {
  const id = rules.positiveId(req.params.id, "kitchen");
  const saved = await kitchens.addStaff(pool(req), id, rules.staffBody(req.body));
  await recordAdminAction(pool(req), req, "kitchen.staff_add", "kitchen", String(id), `Added staff to kitchen “${saved.kitchen.name}”`);
  res.status(201).json(saved);
}));
router.put("/kitchens/:id/staff/:staffId", changeLimit, smallBody, route(async (req, res) => {
  const id = rules.positiveId(req.params.id, "kitchen");
  const saved = await kitchens.editStaff(pool(req), id, rules.positiveId(req.params.staffId, "staff member"), rules.staffBody(req.body));
  await recordAdminAction(pool(req), req, "kitchen.staff_edit", "kitchen", String(id), `Edited staff at kitchen “${saved.kitchen.name}”`);
  res.json(saved);
}));
router.delete("/kitchens/:id/staff/:staffId", changeLimit, route(async (req, res) => {
  const id = rules.positiveId(req.params.id, "kitchen");
  const saved = await kitchens.removeStaff(pool(req), id, rules.positiveId(req.params.staffId, "staff member"));
  await recordAdminAction(pool(req), req, "kitchen.staff_remove", "kitchen", String(id), `Removed staff from kitchen “${saved.kitchen.name}”`);
  res.json(saved);
}));

module.exports = { kitchensRouter: router };
