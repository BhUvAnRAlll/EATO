// Gym Hub › Discover Gyms for members (phase 3, 2026-11-09), mounted at /api/gyms in index.js behind
// requireUser and a per-user rate limit: the list, a branch's page and its images (read only; the
// member's location, when sent for distances, is used for this answer only and never stored or
// logged), and since phase 4 the member's join requests: ask a gym to call about a plan (it lands
// in that gym's Enquiries; no payment) and list their own.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const discover = require("./discover");
const trainerProfiles = require("./trainerProfiles");
const joinRequests = require("./joinRequests");
const joinRules = require("./joinRules");
const rules = require("./discoverRules");
const gymRules = require("./rules");

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
  const [page, you] = await Promise.all([discover.gymPage(pool(req), id), joinRequests.standing(pool(req), req.userId, id)]);
  res.json({ ...page, you });
}));
router.post("/:gymId/requests", joinLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await joinRequests.ask(pool(req), req.userId, gymId(req), joinRules.joinBody(req.body)));
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
