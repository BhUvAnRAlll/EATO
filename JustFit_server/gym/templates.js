// Reminder Templates (2026-11-08): a branch's own wording for Send Reminder and the enquiry
// WhatsApp button. Every portal login reads them (Send Reminder is used from many screens); only
// the gym admin changes them (ownerOnly in routes.js). A kind without a row uses the app's default
// text, so `templates` answers null for it. Rules in templateRules.js.
const { audit } = require("../admin/overview");
const { inTransaction } = require("./service");
const templateRules = require("./templateRules");

const LABEL = { due: "payment due", expiry: "membership expiring", expired: "membership expired", enquiry: "enquiry follow-up" };

async function list(pool, gym) {
  const [rows] = await pool.query("SELECT kind, body FROM gym_reminder_templates WHERE gym_id = ?", [gym.id]);
  const templates = Object.fromEntries(templateRules.KINDS.map((kind) => [kind, rows.find((r) => r.kind === kind)?.body ?? null]));
  return { templates, canEdit: gym.kind === "owner" };
}

async function save(pool, gym, userId, kind, text) {
  await inTransaction(pool, async (db) => {
    await db.query(
      "INSERT INTO gym_reminder_templates (gym_id, kind, body, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), updated_by = VALUES(updated_by)",
      [gym.id, kind, text, userId],
    );
    await audit(db, userId, "gym.template_edit", "gym", gym.id, `The gym admin reworded the ${LABEL[kind]} reminder of ${gym.brand}’s ${gym.branch} branch`);
  });
  return list(pool, gym);
}

// Back to justFit's default text
async function reset(pool, gym, userId, kind) {
  await inTransaction(pool, async (db) => {
    const [result] = await db.query("DELETE FROM gym_reminder_templates WHERE gym_id = ? AND kind = ?", [gym.id, kind]);
    if (result.affectedRows > 0) await audit(db, userId, "gym.template_edit", "gym", gym.id, `The gym admin put the ${LABEL[kind]} reminder of ${gym.brand}’s ${gym.branch} branch back to the default`);
  });
  return list(pool, gym);
}

module.exports = { list, save, reset };
