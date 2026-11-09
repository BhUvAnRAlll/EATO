// Reminder Templates (2026-11-08): a branch's own wording for Send Reminder and the enquiry
// WhatsApp button. Every portal login reads them (Send Reminder is used from many screens); only
// the gym admin changes them (ownerOnly in routes.js). A kind without a row uses the app's default
// text, so `templates` answers null for it. Rules in templateRules.js.
//
// Added templates (2026-11-08): the gym admin's own named messages (up to 20 a branch), listed in
// Send Reminder's Use Template beside the four. Table gym_added_templates (migration
// 2026-12-13-added-templates.sql); before it the list reads as empty and adding answers 503.
const { audit } = require("../admin/overview");
const { NotFoundError, ConflictError } = require("../errors");
const { inTransaction } = require("./service");
const templateRules = require("./templateRules");

const LABEL = { due: "payment due", expiry: "membership expiring", expired: "membership expired", enquiry: "enquiry follow-up" };

const missingTable = (error) => error?.code === "ER_NO_SUCH_TABLE";

// The branch's added templates, oldest first; null before the migration
async function addedTemplates(db, gymId) {
  try {
    const [rows] = await db.query("SELECT id, name, body FROM gym_added_templates WHERE gym_id = ? ORDER BY id", [gymId]);
    return rows.map((r) => ({ id: r.id, name: r.name, text: r.body }));
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

async function list(pool, gym) {
  const [[rows], added] = await Promise.all([
    pool.query("SELECT kind, body FROM gym_reminder_templates WHERE gym_id = ?", [gym.id]),
    addedTemplates(pool, gym.id),
  ]);
  const templates = Object.fromEntries(templateRules.KINDS.map((kind) => [kind, rows.find((r) => r.kind === kind)?.body ?? null]));
  // canAdd: false before the added templates' migration (the app hides Add)
  return { templates, added: added ?? [], canEdit: gym.kind === "owner", canAdd: gym.kind === "owner" && added !== null };
}

const sameName = (error) => error?.code === "ER_DUP_ENTRY";
const SAME_NAME = (name) => `You already have a template called ${name}.`;

async function addTemplate(pool, gym, userId, { name, text }) {
  try {
    await inTransaction(pool, async (db) => {
      // The branch row is the lock, so two adds at once can't pass the limit together
      await db.query("SELECT id FROM gyms WHERE id = ? FOR UPDATE", [gym.id]);
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_added_templates WHERE gym_id = ?", [gym.id]);
      if (n >= templateRules.ADDED_MAX) throw new ConflictError(`A branch can keep ${templateRules.ADDED_MAX} templates of its own. Delete one to add another.`);
      await db.query("INSERT INTO gym_added_templates (gym_id, name, body, updated_by) VALUES (?, ?, ?, ?)", [gym.id, name, text, userId]);
      await audit(db, userId, "gym.template_add", "gym", gym.id, `The gym admin added the template ${name} to ${gym.brand}’s ${gym.branch} branch`);
    });
  } catch (error) {
    if (sameName(error)) throw new ConflictError(SAME_NAME(name));
    throw error;
  }
  return list(pool, gym);
}

async function editTemplate(pool, gym, userId, id, { name, text }) {
  try {
    await inTransaction(pool, async (db) => {
      const [result] = await db.query("UPDATE gym_added_templates SET name = ?, body = ?, updated_by = ? WHERE id = ? AND gym_id = ?", [name, text, userId, id, gym.id]);
      if (result.affectedRows === 0) throw new NotFoundError("That template doesn't exist.");
      await audit(db, userId, "gym.template_edit", "gym", gym.id, `The gym admin changed the template ${name} of ${gym.brand}’s ${gym.branch} branch`);
    });
  } catch (error) {
    if (sameName(error)) throw new ConflictError(SAME_NAME(name));
    throw error;
  }
  return list(pool, gym);
}

async function deleteTemplate(pool, gym, userId, id) {
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT name FROM gym_added_templates WHERE id = ? AND gym_id = ? FOR UPDATE", [id, gym.id]);
    if (!row) throw new NotFoundError("That template doesn't exist.");
    await db.query("DELETE FROM gym_added_templates WHERE id = ? AND gym_id = ?", [id, gym.id]);
    await audit(db, userId, "gym.template_delete", "gym", gym.id, `The gym admin deleted the template ${row.name} of ${gym.brand}’s ${gym.branch} branch`);
  });
  return list(pool, gym);
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

module.exports = { list, save, reset, addTemplate, editTemplate, deleteTemplate };
