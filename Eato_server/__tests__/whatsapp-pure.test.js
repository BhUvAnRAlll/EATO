// Unit tests for the WhatsApp agent's pure helpers: token encryption, Meta's webhook signature
// and handshake, and webhook parsing. No database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const { encryptToken, decryptToken } = require("../whatsapp/secrets.js");
const { validSignature, verifyHandshake } = require("../whatsapp/signature.js");
const { parseWebhook } = require("../whatsapp/parse.js");

const KEY = crypto.randomBytes(32).toString("hex");

describe("whatsapp token encryption", () => {
  it("round-trips, uses a fresh IV each time, and never contains the plain token", () => {
    const token = "EAAG-test-token-not-real";
    const a = encryptToken(token, KEY);
    const b = encryptToken(token, KEY);
    assert.equal(decryptToken(a, KEY), token);
    assert.notDeepEqual(a.iv, b.iv);
    assert.equal(a.ciphertext.includes(Buffer.from(token)), false);
  });

  it("fails on a wrong key or tampering, and refuses a missing or short key", () => {
    const sealed = encryptToken("secret", KEY);
    assert.throws(() => decryptToken(sealed, crypto.randomBytes(32).toString("hex")));
    const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
    tampered.ciphertext[0] ^= 1;
    assert.throws(() => decryptToken(tampered, KEY));
    assert.throws(() => encryptToken("x", ""), /missing/);
    assert.throws(() => encryptToken("x", "abcd"), /32 bytes/);
  });
});

describe("meta webhook signature and handshake", () => {
  const secret = "app-secret-for-tests";
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const sign = (raw, key = secret) => `sha256=${crypto.createHmac("sha256", key).update(raw).digest("hex")}`;

  it("accepts the exact body signed with the app secret only", () => {
    assert.equal(validSignature(body, sign(body), secret), true);
    assert.equal(validSignature(body, sign(body, "other-secret"), secret), false);
    assert.equal(validSignature(Buffer.concat([body, Buffer.from(" ")]), sign(body), secret), false, "one changed byte");
    assert.equal(validSignature(body, undefined, secret), false);
    assert.equal(validSignature(body, "sha1=abc", secret), false);
    assert.equal(validSignature(body, sign(body), ""), false, "no secret configured: nothing is valid");
  });

  it("echoes the challenge only for subscribe with our verify token", () => {
    const ok = { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" };
    assert.equal(verifyHandshake(ok, "verify-me"), "1158201444");
    assert.equal(verifyHandshake({ ...ok, "hub.verify_token": "wrong" }, "verify-me"), null);
    assert.equal(verifyHandshake({ ...ok, "hub.mode": "unsubscribe" }, "verify-me"), null);
    assert.equal(verifyHandshake({ ...ok, "hub.challenge": "<script>" }, "verify-me"), null);
    assert.equal(verifyHandshake(ok, ""), null, "no token configured");
  });
});

describe("meta webhook parsing", () => {
  const envelope = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value }] }] });
  const metadata = { display_phone_number: "919800000001", phone_number_id: "1100000001" };

  it("reads text and image messages with the receiving number id and a stable key", () => {
    const events = parseWebhook(envelope({
      metadata,
      contacts: [{ profile: { name: "Asha" }, wa_id: "919811111111" }],
      messages: [
        { from: "919811111111", id: "wamid.A1", timestamp: "1760000000", type: "text", text: { body: "What are your timings?" } },
        { from: "919811111111", id: "wamid.A2", timestamp: "1760000001", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "My receipt" } },
        { from: "919811111111", id: "wamid.A3", timestamp: "1760000002", type: "sticker" },
      ],
    }));
    assert.equal(events.length, 3);
    assert.deepEqual(
      { kind: events[0].kind, key: events[0].key, phone: events[0].phoneNumberId, from: events[0].from, name: events[0].profileName, body: events[0].body },
      { kind: "message", key: "msg:wamid.A1", phone: "1100000001", from: "919811111111", name: "Asha", body: "What are your timings?" },
    );
    assert.deepEqual([events[1].type, events[1].media.id, events[1].body], ["image", "MEDIA1", "My receipt"]);
    assert.equal(events[2].type, "other");
  });

  it("reads delivery statuses (never as messages), with one key per status change", () => {
    const events = parseWebhook(envelope({
      metadata,
      statuses: [
        { id: "wamid.B1", status: "delivered", timestamp: "1760000100", recipient_id: "919811111111", pricing: { billable: true, category: "service" } },
        { id: "wamid.B1", status: "failed", timestamp: "1760000101", errors: [{ code: 131047, title: "Re-engagement message" }] },
        { id: "wamid.B1", status: "weird" },
      ],
    }));
    assert.deepEqual(events.map((e) => [e.kind, e.key]), [["status", "status:wamid.B1:delivered"], ["status", "status:wamid.B1:failed"]]);
    assert.equal(events[1].errorCode, "131047");
    assert.equal(events[0].category, "service");
  });

  it("ignores anything that isn't a WhatsApp messages change or has bad ids", () => {
    assert.deepEqual(parseWebhook({ object: "page", entry: [] }), []);
    assert.deepEqual(parseWebhook(null), []);
    assert.deepEqual(parseWebhook(envelope({ metadata: { phone_number_id: "../etc" }, messages: [{ from: "1", id: "x", type: "text" }] })), []);
    assert.deepEqual(parseWebhook(envelope({ metadata, messages: [{ from: "not-a-number", id: "wamid.C", type: "text", text: { body: "hi" } }] })), []);
    assert.deepEqual(parseWebhook(envelope({ metadata, messages: [{ from: "919811111111", id: "bad id with spaces", type: "text" }] })), []);
  });

  it("caps text length so an oversized body can't flood storage", () => {
    const [event] = parseWebhook(envelope({ metadata, messages: [{ from: "919811111111", id: "wamid.D", type: "text", text: { body: "x".repeat(10000) } }] }));
    assert.equal(event.body.length, 4096);
  });
});

describe("whatsapp worker start-up", () => {
  const { createWorker } = require("../whatsapp/worker.js");

  it("stays off with one log line when the database hasn't had the WhatsApp migration", async () => {
    const logs = [];
    const missing = Object.assign(new Error("Table 'eato.jobs' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02" });
    const pool = { query: async () => { throw missing; } };
    const worker = createWorker(pool, {}, { log: (entry) => logs.push(entry) });
    assert.equal(await worker.start(), false);
    assert.equal(logs.length, 1);
    assert.match(logs[0].off, /2026-10-24-whatsapp-agent\.sql/);
    assert.equal(JSON.stringify(logs[0]).includes("eato.jobs"), false, "the database message isn't logged");
  });
});
