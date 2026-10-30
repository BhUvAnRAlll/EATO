// Looking up a gym's WhatsApp connection. routeByPhoneNumber is the ONLY way an incoming event
// is tied to a gym: by the receiving phone-number id Meta reports, through our own table.
const { decryptToken } = require("./secrets");

// The gym an event belongs to, or null when the number is unknown, not connected or switched off
async function routeByPhoneNumber(db, phoneNumberId) {
  const [rows] = await db.query("SELECT gym_id, status, disabled_by_admin FROM whatsapp_connections WHERE phone_number_id = ?", [phoneNumberId]);
  const row = rows[0];
  if (!row || row.status !== "connected" || row.disabled_by_admin) return { gymId: row?.gym_id ?? null, active: false };
  return { gymId: row.gym_id, active: true };
}

// The connection a gym sends through, with its token decrypted (server-side use only)
async function sendingConnection(db, gymId) {
  const [rows] = await db.query(
    "SELECT phone_number_id, status, disabled_by_admin, token_ciphertext, token_iv, token_tag FROM whatsapp_connections WHERE gym_id = ?",
    [gymId],
  );
  const row = rows[0];
  if (!row || row.status !== "connected" || row.disabled_by_admin || !row.phone_number_id || !row.token_ciphertext) return null;
  return { phoneNumberId: row.phone_number_id, token: decryptToken({ ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag }) };
}

module.exports = { routeByPhoneNumber, sendingConnection };
