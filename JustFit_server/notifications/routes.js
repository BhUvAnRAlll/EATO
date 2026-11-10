// In-app notifications (Gym Hub ecosystem, section 9), mounted at /api/notifications in index.js
// behind requireUser and a per-user rate limit: the caller's own notifications, marking them read and
// the categories they've switched off. Every role has an inbox (member, gym staff, trainer, admin).
// Before migration 2027-01-04 the list is empty and saving preferences answers 503.
const express = require("express");

const service = require("./service");
const rules = require("./rules");

const router = express.Router({ caseSensitive: true, strict: true });
const pool = (req) => req.app.locals.pool;
const smallBody = express.json({ limit: "4kb" });
const MIGRATION = "Notifications need the 2027-01-04-notifications migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: MIGRATION });
    next(error);
  });

router.get("/", route(async (req, res) => {
  res.json(await service.list(pool(req), req.userId, rules.listQuery(req.query)));
}));
router.post("/read", smallBody, route(async (req, res) => {
  res.json(await service.markRead(pool(req), req.userId, rules.readBody(req.body)));
}));
// Members don't choose their notifications (2026-11-10, the user's choice): their gym decides the
// membership ones and the Super Admin the rest. The gym team and admins still switch theirs.
const isMember = async (req) => {
  const [[row]] = await pool(req).query("SELECT role FROM users WHERE id = ?", [req.userId]);
  return !row || row.role === "user";
};
router.get("/preferences", route(async (req, res) => {
  if (await isMember(req)) return res.json({ canChoose: false, muted: [], categories: [] });
  res.json({ canChoose: true, ...(await service.preferences(pool(req), req.userId)) });
}));
router.put("/preferences", smallBody, route(async (req, res) => {
  if (await isMember(req)) return res.status(403).json({ error: "Your gym and justFit choose which notifications members get." });
  res.json({ canChoose: true, ...(await service.savePreferences(pool(req), req.userId, rules.preferencesBody(req.body))) });
}));

module.exports = { notificationsRouter: router };
