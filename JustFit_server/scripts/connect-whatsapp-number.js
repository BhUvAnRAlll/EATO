// Connects ONE gym to a WhatsApp number using a token from JustFit_server/.env: for development
// with Meta's test number, until owners connect through Embedded Signup. It checks the token
// with Meta, then stores it encrypted (WHATSAPP_TOKEN_KEY) against that gym. It never prints
// the token. Refuses a number already connected to another gym.
//
//   node scripts/connect-whatsapp-number.js --gym "<gym name or id>"
//
// Reads from .env: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID
// (optional), META_GRAPH_VERSION, WHATSAPP_TOKEN_KEY, and the DB_* settings.
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { pool } = require("../database");
const { whatsappConfig } = require("../whatsapp/config");
const { createMetaClient } = require("../whatsapp/metaClient");
const { encryptToken } = require("../whatsapp/secrets");
const { provisionAgent } = require("../whatsapp/provision");

function fail(message) {
  console.error(`Not connected: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const index = process.argv.indexOf("--gym");
  const gymArg = index > 0 ? process.argv[index + 1] : null;
  if (!gymArg) return fail('pass --gym "<gym name or id>".');
  const token = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
  const config = whatsappConfig();
  const missing = [
    !token && "WHATSAPP_ACCESS_TOKEN",
    !/^\d{6,32}$/.test(phoneNumberId) && "WHATSAPP_PHONE_NUMBER_ID",
    !config.graphVersion && "META_GRAPH_VERSION (like v23.0)",
    !process.env.WHATSAPP_TOKEN_KEY && "WHATSAPP_TOKEN_KEY",
  ].filter(Boolean);
  if (missing.length) return fail(`set ${missing.join(", ")} in JustFit_server/.env.`);
  if (wabaId && !/^\d{6,32}$/.test(wabaId)) return fail("WHATSAPP_BUSINESS_ACCOUNT_ID should be digits only.");

  const [gyms] = await pool.query("SELECT id, name FROM gyms WHERE id = ? OR name = ?", [gymArg, gymArg]);
  if (gyms.length !== 1) return fail(gyms.length === 0 ? "no gym has that name or id." : "more than one gym matches; use the id.");
  const gym = gyms[0];
  const [taken] = await pool.query("SELECT gym_id FROM whatsapp_connections WHERE phone_number_id = ? AND gym_id <> ?", [phoneNumberId, gym.id]);
  if (taken.length) return fail("that number is already connected to another gym.");

  let number;
  try {
    number = await createMetaClient(config).getPhoneNumber({ phoneNumberId, token });
  } catch (error) {
    return fail(`Meta didn't accept the token for that number (${error.publicMessage ?? error.name}).`);
  }
  const sealed = encryptToken(token);
  await provisionAgent(pool, gym.id);
  await pool.query(
    `UPDATE whatsapp_connections SET status = 'connected', phone_number_id = ?, waba_id = ?, display_phone = ?, token_ciphertext = ?, token_iv = ?, token_tag = ?,
       token_expires_at = NULL, last_health_at = NOW(), last_error = NULL, connected_at = NOW() WHERE gym_id = ?`,
    [phoneNumberId, wabaId, number.displayPhone, sealed.ciphertext, sealed.iv, sealed.tag, gym.id],
  );
  await pool.query("INSERT INTO whatsapp_audit (gym_id, action, detail) VALUES (?, 'connect.script', ?)", [gym.id, JSON.stringify({ phoneNumberId, displayPhone: number.displayPhone })]);
  console.log(`Connected ${gym.name} to ${number.displayPhone ?? phoneNumberId}${number.verifiedName ? ` (${number.verifiedName})` : ""}. The agent stays disabled until it's switched on.`);
}

main().catch((error) => fail(error?.code === "ER_NO_SUCH_TABLE" ? "run migrations/2026-10-24-whatsapp-agent.sql first." : (error?.name ?? "error"))).finally(() => pool.end());
