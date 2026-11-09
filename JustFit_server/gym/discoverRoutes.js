// Gym Hub › Discover Gyms for members (phase 3, 2026-11-09), mounted at /api/gyms in index.js behind
// requireUser and a per-user rate limit. Read only: the list, a branch's page and its images. The
// member's location, when sent for distances, is used for this answer only and never stored or
// logged.
const express = require("express");

const discover = require("./discover");
const rules = require("./discoverRules");
const gymRules = require("./rules");

const router = express.Router({ caseSensitive: true, strict: true });
const pool = (req) => req.app.locals.pool;

const MIGRATION = "Discover Gyms needs the 2026-12-17-gym-public-profile migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });
const gymId = (req) => gymRules.id(req.params.gymId, "gym");

router.get("/", route(async (req, res) => {
  res.json(await discover.discover(pool(req), rules.discoverQuery(req.query)));
}));
router.get("/:gymId", route(async (req, res) => {
  res.json(await discover.gymPage(pool(req), gymId(req)));
}));
router.get("/:gymId/photos/:photoId", route(async (req, res) => {
  discover.send(res, await discover.photo(pool(req), gymId(req), gymRules.id(req.params.photoId, "photo")));
}));
router.get("/:gymId/logo", route(async (req, res) => {
  discover.send(res, await discover.logo(pool(req), gymId(req)));
}));

module.exports = { discoverRouter: router };
