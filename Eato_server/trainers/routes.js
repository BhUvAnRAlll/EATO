// HTTP routes for trainers, mounted at /api/trainers in index.js behind requireUser and the
// per-user rate limit. The caller is always req.userId. Trainer-only routes check the Clerk
// role ("trainer") on every call; acting on a client is checked in trainers.js against
// trainer_clients, never against the role alone.
const express = require("express");

const { ValidationError } = require("../profile");
const { ensureUser, currentRole } = require("../community/members");
const { isSuspended } = require("../community/visibility");
const cv = require("../community/validate");
const { isoDate, isNearToday } = require("../macro/validate");
const v = require("./validate");
const trainers = require("./trainers");

const router = express.Router();
const smallBody = express.json({ limit: "20kb" });
const planBody = express.json({ limit: "120kb" }); // a whole diet or workout plan

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;
const clientId = (req) => cv.clerkUserId(req.params.clientId, "The member");
const trainerId = (req) => cv.clerkUserId(req.params.trainerId, "The trainer");

const withUser = route(async (req, res, next) => {
  await ensureUser(pool(req), req.userId);
  if (await isSuspended(pool(req), req.userId)) return res.status(403).json({ error: "Your community access is suspended." });
  next();
});

// 403 unless Clerk says the caller is a trainer (read on every call, so a role change counts at once)
const requireTrainer = route(async (req, res, next) => {
  if ((await currentRole(req.userId)) !== "trainer") return res.status(403).json({ error: "Only trainers can do that." });
  next();
});

// The member's local day ("?date=" or body.date); the server checks it is near its own today
const dayParam = (value) => isoDate(value, "The date");

// ---- finding a trainer -------------------------------------------------------------------

router.get("/", route(async (req, res) => {
  res.json({ trainers: await trainers.listTrainers(pool(req), req.userId, v.discoveryQuery(req.query)) });
}));

router.get("/library", requireTrainer, route(async (req, res) => {
  res.json({ exercises: await trainers.listLibrary(pool(req)) });
}));

// ---- the trainer's own profile ------------------------------------------------------------

router.get("/me/profile", requireTrainer, route(async (req, res) => {
  res.json({ profile: await trainers.ownProfile(pool(req), req.userId) });
}));

router.put("/me/profile", requireTrainer, smallBody, withUser, route(async (req, res) => {
  res.json({ profile: await trainers.saveOwnProfile(pool(req), req.userId, v.validateTrainerProfile(req.body)) });
}));

// ---- the member's connection ---------------------------------------------------------------

router.get("/me/connection", route(async (req, res) => {
  res.json(await trainers.myConnection(pool(req), req.userId));
}));

router.delete("/me/connection", route(async (req, res) => {
  res.json(await trainers.endMyConnection(pool(req), req.userId));
}));

// ---- the member's diet plan, recommendation and targets ------------------------------------

router.get("/me/plan", route(async (req, res) => {
  res.json(await trainers.myDietPlan(pool(req), req.userId, dayParam(req.query.date)));
}));

router.post("/me/plan/meals/:mealId/log", smallBody, withUser, route(async (req, res) => {
  const mealId = cv.id(req.params.mealId, "The meal");
  // The item count is checked again in logPlanMeal; here it only sizes the servings list
  const count = Array.isArray(req.body?.servings) ? req.body.servings.length : 0;
  res.status(201).json(await trainers.logPlanMeal(pool(req), req.userId, mealId, v.validatePlanLog(req.body, count)));
}));

router.post("/me/plan/meals/:mealId/done", smallBody, withUser, route(async (req, res) => {
  res.json(await trainers.setDone(pool(req), req.userId, cv.id(req.params.mealId, "The meal"), v.validateDoneBody(req.body).date, true));
}));

router.delete("/me/plan/meals/:mealId/done", smallBody, route(async (req, res) => {
  res.json(await trainers.setDone(pool(req), req.userId, cv.id(req.params.mealId, "The meal"), v.validateDoneBody(req.body).date, false));
}));

router.get("/me/recommendation", route(async (req, res) => {
  res.json(await trainers.myRecommendation(pool(req), req.userId));
}));

router.post("/me/recommendation/apply", withUser, route(async (req, res) => {
  res.json(await trainers.applyRecommendation(pool(req), req.userId));
}));

router.post("/me/targets/restore", withUser, route(async (req, res) => {
  res.json(await trainers.restoreTargets(pool(req), req.userId));
}));

// ---- the trainer's requests and clients ----------------------------------------------------

router.get("/me/requests", requireTrainer, route(async (req, res) => {
  res.json({ requests: await trainers.listRequests(pool(req), req.userId) });
}));

for (const [action, accept] of [["accept", true], ["decline", false]]) {
  router.post(`/me/requests/:clientId/${action}`, requireTrainer, withUser, route(async (req, res) => {
    res.json(await trainers.answerRequest(pool(req), req.userId, clientId(req), accept));
  }));
}

router.get("/me/clients", requireTrainer, route(async (req, res) => {
  res.json({ clients: await trainers.listClients(pool(req), req.userId) });
}));

router.get("/me/clients/:clientId", requireTrainer, route(async (req, res) => {
  res.json({ client: await trainers.clientDetail(pool(req), req.userId, clientId(req)) });
}));

router.delete("/me/clients/:clientId", requireTrainer, route(async (req, res) => {
  res.json(await trainers.endClient(pool(req), req.userId, clientId(req)));
}));

router.put("/me/clients/:clientId/recommendation", requireTrainer, smallBody, withUser, route(async (req, res) => {
  res.json({ recommendation: await trainers.setRecommendation(pool(req), req.userId, clientId(req), v.validateRecommendation(req.body)) });
}));

router.put("/me/clients/:clientId/plan", requireTrainer, planBody, withUser, route(async (req, res) => {
  res.json({ plan: await trainers.setDietPlan(pool(req), req.userId, clientId(req), v.validateDietPlan(req.body)) });
}));

// { today, ...workout }: the plan starts on the trainer's local day
router.put("/me/clients/:clientId/workout", requireTrainer, planBody, withUser, route(async (req, res) => {
  const { today, ...workout } = cv.requireObject(req.body, "workout");
  const start = dayParam(today);
  if (!isNearToday(start, Date.now())) throw new ValidationError("The start date must be today.");
  res.json({ workout: await trainers.setWorkoutPlan(pool(req), req.userId, clientId(req), v.validateWorkoutPlan(workout), start) });
}));

// ---- one trainer, as a member sees them (after /me and /library so those never match here) -----

router.get("/:trainerId", route(async (req, res) => {
  res.json({ trainer: await trainers.getTrainer(pool(req), req.userId, trainerId(req)) });
}));

// Connect (or ask to switch from another trainer with { replace: true })
router.post("/:trainerId/connect", smallBody, withUser, route(async (req, res) => {
  const body = req.body ?? {};
  cv.rejectUnknownKeys(cv.requireObject(body, "request"), ["replace"], "The request");
  if (body.replace !== undefined && typeof body.replace !== "boolean") throw new ValidationError("replace must be true or false.");
  res.json(await trainers.requestConnection(pool(req), req.userId, trainerId(req), { replace: body.replace === true }));
}));

module.exports = { trainersRouter: router };
