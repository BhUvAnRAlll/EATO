// HTTP routes for the Macro diary, mounted at /api/macro in index.js behind requireUser and
// the per-user rate limit. Each handler validates its input, calls diary.js with the
// verified member id (never one from the request), and hands any error to the shared
// handler, which answers 400/404 with the message and logs only safe fields.
const express = require("express");

const { ensureUser } = require("../community/members");
const diary = require("./diary");
const targets = require("./targets");
const water = require("./water");
const v = require("./validate");

const router = express.Router();
// A meal holds at most 50 foods; this is ample for that and refuses anything larger early
const smallBody = express.json({ limit: "64kb" });

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;
// A write needs a users row for the caller (created from Clerk on first use)
const withUser = route(async (req, res, next) => {
  await ensureUser(pool(req), req.userId);
  next();
});

// ---- reading --------------------------------------------------------------------

router.get("/day", route(async (req, res) => {
  res.json(await diary.day(pool(req), req.userId, v.isoDate(req.query.date)));
}));

router.get("/progress", route(async (req, res) => {
  res.json({ days: await diary.dayProgress(pool(req), req.userId, v.dateList(req.query.dates)) });
}));

router.get("/recent", route(async (req, res) => {
  res.json({ meals: await diary.recentMeals(pool(req), req.userId, v.recentQuery(req.query, Date.now())) });
}));

router.get("/summary", route(async (req, res) => {
  res.json({ summary: await diary.periodSummary(pool(req), req.userId, v.summaryQuery(req.query, Date.now())) });
}));

router.get("/favorites", route(async (req, res) => {
  res.json({ favorites: await diary.listFavorites(pool(req), req.userId) });
}));

// ---- targets --------------------------------------------------------------------

router.get("/targets", route(async (req, res) => {
  res.json(await targets.status(pool(req), req.userId));
}));

router.put("/targets", smallBody, route(async (req, res) => {
  res.json(await targets.setManual(pool(req), req.userId, req.body));
}));

router.post("/targets/reset", route(async (req, res) => {
  res.json(await targets.reset(pool(req), req.userId));
}));

// ---- water ----------------------------------------------------------------------

router.get("/water", route(async (req, res) => {
  res.json(await water.day(pool(req), req.userId, v.isoDate(req.query.date)));
}));

router.post("/water", smallBody, withUser, route(async (req, res) => {
  res.status(201).json(await water.logWater(pool(req), req.userId, req.body, Date.now()));
}));

router.delete("/water/:entryId", route(async (req, res) => {
  res.json(await water.removeEntry(pool(req), req.userId, v.id(req.params.entryId, "The entry"), Date.now()));
}));

router.put("/water/reminders", smallBody, withUser, route(async (req, res) => {
  res.json(await water.setReminders(pool(req), req.userId, req.body));
}));

// ---- meals ----------------------------------------------------------------------

router.post("/meals", smallBody, withUser, route(async (req, res) => {
  res.status(201).json(await diary.logMeal(pool(req), req.userId, v.validateMeal(req.body, Date.now())));
}));

router.delete("/meals/:mealId", route(async (req, res) => {
  res.json(await diary.deleteMeal(pool(req), req.userId, v.id(req.params.mealId, "The meal")));
}));

// ---- favourites -----------------------------------------------------------------

router.post("/favorites/toggle", smallBody, withUser, route(async (req, res) => {
  res.json(await diary.toggleFavorite(pool(req), req.userId, v.validateFavoriteToggle(req.body)));
}));

router.delete("/favorites/:favoriteId", route(async (req, res) => {
  res.json(await diary.removeFavorite(pool(req), req.userId, v.id(req.params.favoriteId, "The favourite")));
}));

router.post("/favorites/:favoriteId/log", smallBody, withUser, route(async (req, res) => {
  const favoriteId = v.id(req.params.favoriteId, "The favourite");
  res.status(201).json(await diary.logFromFavorite(pool(req), req.userId, favoriteId, v.validateFavoriteLog(req.body, Date.now())));
}));

module.exports = { macroRouter: router };
