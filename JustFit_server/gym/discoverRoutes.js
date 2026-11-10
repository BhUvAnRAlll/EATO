// Gym Hub › Discover Gyms for members (phase 3, 2026-11-09), mounted at /api/gyms in index.js behind
// requireUser and a per-user rate limit: the list, a branch's page and its images (read only; the
// member's location, when sent for distances, is used for this answer only and never stored or
// logged), and since phase 4 the member's join requests: ask a gym to call about a plan (it lands
// in that gym's Enquiries; no payment) and list their own. Since Gym Profile phase 4, reviews: a
// branch's reviews, and the member's own (only by someone who is or was a member there).
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const discover = require("./discover");
const trainerProfiles = require("./trainerProfiles");
const joinRequests = require("./joinRequests");
const joinRules = require("./joinRules");
const trials = require("./trials");
const trialRules = require("./trialRules");
const reviews = require("./reviews");
const reviewRules = require("./reviewRules");
const rules = require("./discoverRules");
const gymRules = require("./rules");
const notices = require("../notifications/events");

const router = express.Router({ caseSensitive: true, strict: true });
const pool = (req) => req.app.locals.pool;

const MIGRATION = "Discover Gyms needs the 2026-12-17-gym-public-profile migration on this server.";
const JOIN_MIGRATION = "Asking to join needs the 2026-12-19-gym-app-enquiries migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    // A join request's columns or its 'app' source before migration 2026-12-19
    if ((error?.code === "ER_BAD_FIELD_ERROR" && /user_id|plan_label|catalog_item_id/.test(String(error.sqlMessage ?? ""))) || (error?.code === "WARN_DATA_TRUNCATED" && String(error.sqlMessage ?? "").includes("source"))) {
      return res.status(503).json({ error: JOIN_MIGRATION });
    }
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });
const REVIEW_MIGRATION = "Reviews need the 2026-12-26-gym-reviews migration on this server.";
const reviewRoute = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: REVIEW_MIGRATION });
    next(error);
  });
// 20 review changes an hour per member (GYM_REVIEW_CHANGES_PER_HOUR; the test server raises it)
const reviewLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_REVIEW_CHANGES_PER_HOUR) || 20, windowMs: 60 * 60 * 1000 }));
const gymId = (req) => gymRules.id(req.params.gymId, "gym");
const smallBody = express.json({ limit: "2kb" });
// 10 join requests an hour per member (GYM_JOIN_REQUESTS_PER_HOUR; the test server raises it)
const joinLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_JOIN_REQUESTS_PER_HOUR) || 10, windowMs: 60 * 60 * 1000 }));

// Every route about one branch: members reach only an approved, published one (else 404)
router.param("gymId", (req, res, next, value) => {
  route(async () => {
    await discover.assertVisible(pool(req), gymRules.id(value, "gym"));
    next();
  })(req, res, next);
});

router.get("/", route(async (req, res) => {
  res.json(await discover.discover(pool(req), rules.discoverQuery(req.query)));
}));
// The member's own join requests (before /:gymId, which would read "requests" as a gym's id)
router.get("/requests", route(async (req, res) => {
  res.json(await joinRequests.mine(pool(req), req.userId));
}));
// A gym's page, with the member's standing there: their latest request and whether they're a member
router.get("/:gymId", route(async (req, res) => {
  const id = gymId(req);
  const [page, you, rated] = await Promise.all([discover.gymPage(pool(req), id), joinRequests.standing(pool(req), req.userId, id), discover.reviewsAt(pool(req), id, req.userId)]);
  res.json({ ...page, reviews: rated, you });
}));
router.post("/:gymId/requests", joinLimit, smallBody, route(async (req, res) => {
  const id = gymId(req);
  const answer = await joinRequests.ask(pool(req), req.userId, id, joinRules.joinBody(req.body));
  await notices.joinRequested(pool(req), id, answer.request.id, null);
  res.status(201).json(answer);
}));
// Book a free trial: the member's details (filled in by the app, editable) and a preferred day and
// time; it lands in the gym's Enquiries, which books the time. The join requests' hourly budget.
router.post("/:gymId/trials", joinLimit, smallBody, route(async (req, res) => {
  const id = gymId(req);
  const body = trialRules.trialBody(req.body, gymRules.todayInIndia());
  const sent = await trials.request(pool(req), req.userId, id, body);
  const request = await joinRequests.one(pool(req), req.userId, sent.id);
  await notices.trialRequested(pool(req), id, sent.id, body.name, request?.trial?.preferred ?? null);
  res.status(201).json({ request });
}));
router.delete("/:gymId/trials/:enquiryId", joinLimit, route(async (req, res) => {
  await trials.cancel(pool(req), req.userId, gymId(req), gymRules.id(req.params.enquiryId, "trial"));
  res.json({ ok: true });
}));
// Reviews (Gym Profile phase 4): a page of them, and the member's own to write, change or delete
router.get("/:gymId/reviews", reviewRoute(async (req, res) => {
  const id = gymId(req);
  res.json(await reviews.forMember(pool(req), id, req.userId, reviewRules.memberQuery(req.query)));
}));
router.put("/:gymId/review", reviewLimit, smallBody, reviewRoute(async (req, res) => {
  const id = gymId(req);
  res.json(await reviews.save(pool(req), req.userId, id, reviewRules.reviewBody(req.body)));
}));
router.delete("/:gymId/review", reviewLimit, reviewRoute(async (req, res) => {
  res.json(await reviews.remove(pool(req), req.userId, gymId(req)));
}));
router.get("/:gymId/photos/:photoId", route(async (req, res) => {
  discover.send(res, await discover.photo(pool(req), gymId(req), gymRules.id(req.params.photoId, "photo")));
}));
// A trainer's photo: only one members can see at that branch (Gym Profile phase 3)
router.get("/:gymId/trainers/:trainerId/photo", route(async (req, res) => {
  discover.send(res, await trainerProfiles.memberPhoto(pool(req), gymId(req), gymRules.id(req.params.trainerId, "trainer")));
}));
router.get("/:gymId/logo", route(async (req, res) => {
  discover.send(res, await discover.logo(pool(req), gymId(req)));
}));

module.exports = { discoverRouter: router };
