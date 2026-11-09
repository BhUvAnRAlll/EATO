// justFit-wide settings (Gym Hub ecosystem, section 7): read (kept 30 seconds in memory, so the hot
// paths don't ask every time) and saved by a justFit admin, audited. Before migration 2027-01-20 the
// defaults apply and saving answers 503.
const { audit } = require("../admin/overview");
const rules = require("./settingsRules");

let cached = { at: 0, value: null };

/** The current settings (defaults for anything never saved, or before the migration) */
async function get(db) {
  if (cached.value && Date.now() - cached.at < 30000) return cached.value;
  let rows = [];
  try {
    [rows] = await db.query("SELECT setting_key, value FROM platform_settings");
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  cached = { at: Date.now(), value: rules.read(rows) };
  return cached.value;
}

/** PUT /api/admin/portal/platform-settings */
async function save(pool, adminId, fields) {
  const keys = Object.keys(fields);
  await pool.query(
    "INSERT INTO platform_settings (setting_key, value, updated_by) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)",
    [keys.map((k) => [k, JSON.stringify(fields[k]), adminId])],
  );
  cached = { at: 0, value: null };
  await audit(pool, adminId, "platform.settings", "gym", null, `Changed the platform settings: ${keys.join(", ")}`);
  return { settings: await get(pool), defaults: rules.DEFAULTS };
}

module.exports = { get, save };
