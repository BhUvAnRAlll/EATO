// /api/addresses (mounted in index.js behind requireUser and a per-user rate limit): a member's
// delivery addresses. Who is asking comes from the session only; an address id that isn't theirs
// answers 404. Before migration 2026-12-16 every route answers 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const addresses = require("./service");
const rules = require("./rules");

const router = express.Router({ caseSensitive: true, strict: true });
const smallBody = express.json({ limit: "4kb" });
const pool = (req) => req.app.locals.pool;

const MIGRATION = "Delivery addresses need the 2026-12-16-delivery-addresses migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return res.status(503).json({ error: MIGRATION });
    next(error);
  });
// 60 address changes an hour per account (ADDRESS_CHANGES_PER_HOUR; the test server raises it)
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.ADDRESS_CHANGES_PER_HOUR) || 60, windowMs: 60 * 60 * 1000 }));

router.get("/", route(async (req, res) => {
  res.json(await addresses.list(pool(req), req.userId));
}));
router.get("/serviceable", route(async (req, res) => {
  res.json(await addresses.serviceable(pool(req), rules.serviceableQuery(req.query)));
}));
router.post("/", changeLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await addresses.create(pool(req), req.userId, rules.addressBody(req.body)));
}));
router.put("/:id", changeLimit, smallBody, route(async (req, res) => {
  res.json(await addresses.update(pool(req), req.userId, rules.addressId(req.params.id), rules.addressBody(req.body)));
}));
router.delete("/:id", changeLimit, route(async (req, res) => {
  res.json(await addresses.remove(pool(req), req.userId, rules.addressId(req.params.id)));
}));
router.post("/:id/default", changeLimit, route(async (req, res) => {
  res.json(await addresses.select(pool(req), req.userId, rules.addressId(req.params.id)));
}));

module.exports = { addressesRouter: router };
