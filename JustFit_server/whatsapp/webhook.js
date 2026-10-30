// Meta's webhook for WhatsApp, mounted at /api/whatsapp/webhook. Meta calls it, so there is no
// session: the GET handshake needs our verify token, and every POST must carry a valid
// X-Hub-Signature-256 over the exact bytes received. Events are saved once (event_key) and
// queued; the answer goes back at once, and the work happens in the worker (process.js).
const express = require("express");
const { validSignature, verifyHandshake } = require("./signature");
const { parseWebhook } = require("./parse");
const { routeByPhoneNumber } = require("./connections");
const { enqueue } = require("./jobs");

const MAX_BODY = "1mb";

function webhookRouter({ pool, config, limiter }) {
  const router = express.Router();

  router.get("/webhook", (req, res) => {
    const challenge = verifyHandshake(req.query, config.verifyToken);
    if (challenge === null) return res.status(403).json({ error: "Verification failed." });
    res.type("text/plain").send(challenge);
  });

  router.post("/webhook", express.raw({ type: () => true, limit: MAX_BODY }), async (req, res, next) => {
    // One budget for all of Meta's traffic: Meta sends from many addresses, so a per-address
    // limit could drop real events; this only stops a flood
    const budget = limiter.check("meta-webhook");
    if (!budget.ok) return res.status(429).json({ error: "Too many requests." });
    if (!config.appSecret) return res.status(503).json({ error: "WhatsApp isn't configured on this server." });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!validSignature(raw, req.get("x-hub-signature-256"), config.appSecret)) return res.status(401).json({ error: "Invalid signature." });
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "The body isn't JSON." }); }
    try {
      let accepted = 0;
      for (const event of parseWebhook(body)) {
        const route = await routeByPhoneNumber(pool, event.phoneNumberId);
        const status = route.active ? "pending" : "quarantined"; // unknown or switched-off numbers are kept aside, never processed
        const [saved] = await pool.query(
          "INSERT IGNORE INTO whatsapp_webhook_events (event_key, phone_number_id, gym_id, kind, payload, status) VALUES (?, ?, ?, ?, ?, ?)",
          [event.key, event.phoneNumberId, route.gymId, event.kind, JSON.stringify(event), status],
        );
        if (saved.affectedRows !== 1) continue; // a repeated delivery: already saved
        if (status === "pending") {
          const [[row]] = await pool.query("SELECT id FROM whatsapp_webhook_events WHERE event_key = ?", [event.key]);
          await enqueue(pool, "whatsapp.event", { eventId: row.id }, { gymId: route.gymId, idempotencyKey: `event:${event.key}` });
          accepted += 1;
        }
      }
      res.json({ received: true, accepted });
    } catch (error) {
      next(error); // a 500 makes Meta retry, and the event keys keep the retry from duplicating
    }
  });

  return router;
}

module.exports = { webhookRouter };
