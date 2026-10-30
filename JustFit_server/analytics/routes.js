// POST /api/analytics/events: the app's usage events, for the signed-in member only. Mounted in
// index.js behind requireUser and a per-user budget; the body is small and checked field by
// field (analytics/rules.js). Answers { stored, dropped } so the app can clear its queue.
//
// Before the analytics migration has run on this database the tables are missing: the route
// answers 503 with one clear line, and the app keeps its queue for a later try.
const express = require("express");
const { ValidationError } = require("../profile");
const rules = require("./rules");
const { storeBatch } = require("./events");

const body = express.json({ limit: "64kb" });

function analyticsRouter({ pool }) {
  const router = express.Router();
  router.post("/events", body, async (req, res, next) => {
    try {
      const batch = rules.cleanBatch(req.body);
      const { stored } = await storeBatch(pool, req.userId, batch);
      res.json({ stored, dropped: batch.dropped });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      if (error?.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: "Usage tracking isn't set up on this server yet." });
      next(error);
    }
  });
  return router;
}

module.exports = { analyticsRouter };
