// Members' meal problems, customers and reports (Meal Operations phase 6, 2026-11-10).
// Members, /api/meal-issues (requireUser in index.js): GET / (theirs), POST / { orderId | subscriptionId,
//   category, description, photo? } (5 an hour, MEAL_ISSUES_PER_HOUR).
// Admin, inside /api/admin/kitchen (adminOnly): GET /issues?status=&search=, GET /issues/:id,
//   GET /issues/:id/photo, POST /issues/:id/assign|progress|note|resolve|reject|reopen,
//   GET /customers/:userId (the member's meal side), GET /reports?from=&to=&format=.
// Before migration 2027-01-09 the issue routes answer 503 naming it (reports work without it).
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const { recordAdminAction } = require("../admin/overview");
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const photos = require("../meals/photos");
const reports = require("../reports/service");
const issues = require("./service");
const rules = require("./rules");

const pool = (req) => req.app.locals.pool;
const photoBody = express.json({ limit: Math.ceil(photos.mealPhotoLimits.maxBytes * (4 / 3)) + 8 * 1024 });
const smallBody = express.json({ limit: "8kb" });
const MIGRATION = "Meal issues need the 2027-01-09-meal-issues migration on this server.";
const route = (handler, { needsIssues = true } = {}) => async (req, res, next) => {
  try {
    if (needsIssues && !(await issues.ready(pool(req)))) return res.status(503).json({ error: MIGRATION });
    await handler(req, res, next);
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  }
};
const issueId = (value) => {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ValidationError("That issue isn't valid.");
  return Number(value);
};

// ---- Members ----

const memberRouter = express.Router({ caseSensitive: true, strict: true });
const reportLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.MEAL_ISSUES_PER_HOUR) || 5, windowMs: 60 * 60 * 1000 }));

memberRouter.get("/", route(async (req, res) => {
  res.json(await issues.mine(pool(req), req.userId));
}));
// { …fields, photo?: { data, mediaType } }: the photo is checked from its bytes and kept only for admins
memberRouter.post("/", reportLimit, photoBody, route(async (req, res) => {
  const { photo, ...fields } = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const body = rules.issueBody(fields);
  let photoKey = null;
  if (photo !== undefined && photo !== null) {
    const checked = photos.checkMealPhoto(photo);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    photoKey = await photos.save(checked.bytes, checked.mediaType);
  }
  try {
    res.status(201).json(await issues.report(pool(req), req.userId, body, photoKey));
  } catch (error) {
    if (photoKey) await photos.remove(photoKey).catch(() => {});
    throw error;
  }
}));

// ---- The Super Admin ----

const adminRouter = express.Router({ caseSensitive: true, strict: true });
const adminLimit = limitPerUser(createRateLimiter({ limit: 300, windowMs: 60 * 60 * 1000 }));

adminRouter.get("/issues", route(async (req, res) => {
  res.json(await issues.adminList(pool(req), rules.listQuery(req.query)));
}));
adminRouter.get("/issues/:id", route(async (req, res) => {
  res.json(await issues.adminOne(pool(req), issueId(req.params.id)));
}));
adminRouter.get("/issues/:id/photo", route(async (req, res) => {
  const file = await photos.read(await issues.photoKey(pool(req), issueId(req.params.id)));
  if (!file) return res.status(404).json({ error: "That issue has no photo." });
  photos.send(res, file);
}));
adminRouter.post("/issues/:id/:action", adminLimit, smallBody, route(async (req, res) => {
  const id = issueId(req.params.id);
  if (!rules.ACTIONS.includes(req.params.action)) throw new NotFoundError("Not found.");
  const saved = await issues.act(pool(req), id, req.params.action, req.body, req.userId);
  await recordAdminAction(pool(req), req, `order.issue_${req.params.action}`, "order", saved.issue.orderId, `Issue ${saved.issue.code}: ${req.params.action}${saved.issue.refund && req.params.action === "resolve" ? ` (refund ₹${saved.issue.refund})` : ""}`);
  res.json(saved);
}));

// The member's meal side for the admin: addresses, food preferences, orders, plans and issues
adminRouter.get("/customers/:userId", route(async (req, res) => {
  const userId = req.params.userId;
  if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new ValidationError("That account isn't valid.");
  const db = pool(req);
  const [[user]] = await db.query("SELECT id, full_name, phone, created_at FROM users WHERE id = ?", [userId]);
  if (!user) throw new NotFoundError("That account doesn't exist.");
  const [[profile]] = await db.query("SELECT diet, cuisines, dislikes, allergies FROM profiles WHERE user_id = ?", [userId]);
  const [addresses] = await db.query("SELECT id, kind, receiver_name, house, street, city, pincode, is_default FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC", [userId]).catch(() => [[]]);
  const [orders] = await db.query(
    "SELECT id, delivery_date, meal_slot, status, total_paise, created_at FROM orders WHERE user_id = ? AND status <> 'awaiting_payment' ORDER BY created_at DESC LIMIT 15",
    [userId],
  );
  const [subs] = await db.query("SELECT id, plan_name, days, status, starts_on, ends_on FROM meal_subscriptions WHERE user_id = ? AND status <> 'awaiting_payment' ORDER BY created_at DESC LIMIT 10", [userId]).catch(() => [[]]);
  const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));
  res.json({
    customer: {
      id: user.id, name: user.full_name ?? null, phone: user.phone ?? null, joinedAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
      preferences: profile
        ? { diet: profile.diet ?? null, cuisines: typeof profile.cuisines === "string" ? JSON.parse(profile.cuisines) : profile.cuisines ?? [], dislikes: profile.dislikes ?? null, allergies: profile.allergies ?? null }
        : null,
      addresses: addresses.map((a) => ({ id: a.id, kind: a.kind, line: [a.house, a.street, a.city, a.pincode].filter(Boolean).join(", "), selected: Number(a.is_default) === 1 })),
      orders: orders.map((o) => ({ id: o.id, code: o.id.slice(0, 8).toUpperCase(), date: day(o.delivery_date), slot: o.meal_slot, status: o.status, total: Math.round(Number(o.total_paise) / 100) })),
      subscriptions: subs.map((s) => ({ id: s.id, planName: s.plan_name, days: Number(s.days), status: s.status, startsOn: day(s.starts_on), endsOn: day(s.ends_on) })),
      issues: await issues.forUser(db, userId),
    },
  });
}));

const reportFileLimit = limitPerUser(createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 }));
adminRouter.get("/reports", route(async (req, res) => {
  const range = reports.rangeQuery(req.query);
  const data = await reports.report(pool(req), range);
  if (!range.format) return res.json(data);
  return reportFileLimit(req, res, () => {
    const file = reports.exportReport(data, range.format);
    res.setHeader("Content-Type", file.type);
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
    res.send(file.body);
  });
}, { needsIssues: false }));

module.exports = { mealIssuesRouter: memberRouter, mealIssuesAdminRouter: adminRouter };
