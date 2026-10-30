// The gym assistant's custom answers (gym_faqs), edited from the owner portal. The assistant reads
// the active ones before its built-in knowledge (whatsapp/agent.js). Owner and admins only.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../community/posts");
const { ownerAccess } = require("./owner");

const LIMITS = { question: 200, answer: 1000, count: 60 };

const toApi = (row) => ({ id: row.id, question: row.question, answer: row.answer, active: Boolean(row.active), position: row.position });

async function list(pool, staffId, gymId) {
  await ownerAccess(pool, gymId, staffId);
  const [rows] = await pool.query("SELECT id, question, answer, active, position FROM gym_faqs WHERE gym_id = ? ORDER BY position, created_at, id", [gymId]);
  return { faqs: rows.map(toApi) };
}

// A new custom answer, or changes to one (question, answer, active); unknown fields are refused
function validateFaq(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Write a question and its answer.");
  const extra = Object.keys(body).filter((k) => !["question", "answer", "active"].includes(k));
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  const out = {};
  for (const [key, max] of [["question", LIMITS.question], ["answer", LIMITS.answer]]) {
    if (body[key] === undefined && partial) continue;
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (!value) throw new ValidationError(key === "question" ? "Write the question." : "Write the answer.");
    if (value.length > max) throw new ValidationError(`Keep the ${key} to ${max} characters.`);
    out[key] = value;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new ValidationError("active must be true or false.");
    out.active = body.active;
  }
  if (partial && Object.keys(out).length === 0) throw new ValidationError("Nothing to change.");
  return out;
}

async function create(pool, staffId, gymId, values) {
  await ownerAccess(pool, gymId, staffId);
  const [[{ n, next }]] = await pool.query("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) + 1 AS next FROM gym_faqs WHERE gym_id = ?", [gymId]);
  if (Number(n) >= LIMITS.count) throw new ValidationError(`A gym can keep up to ${LIMITS.count} custom answers.`);
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query("INSERT INTO gym_faqs (id, gym_id, question, answer, position, active) VALUES (?, ?, ?, ?, ?, ?)", [id, gymId, values.question, values.answer, Number(next), values.active ?? true]);
  const [[row]] = await pool.query("SELECT id, question, answer, active, position FROM gym_faqs WHERE id = ?", [id]);
  return { faq: toApi(row) };
}

async function update(pool, staffId, gymId, faqId, values) {
  await ownerAccess(pool, gymId, staffId);
  const sets = Object.keys(values).map((k) => `${k} = ?`); // keys come from validateFaq's fixed list
  const [result] = await pool.query(`UPDATE gym_faqs SET ${sets.join(", ")} WHERE id = ? AND gym_id = ?`, [...Object.values(values), faqId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That custom answer doesn't exist.");
  const [[row]] = await pool.query("SELECT id, question, answer, active, position FROM gym_faqs WHERE id = ?", [faqId]);
  return { faq: toApi(row) };
}

async function remove(pool, staffId, gymId, faqId) {
  await ownerAccess(pool, gymId, staffId);
  const [result] = await pool.query("DELETE FROM gym_faqs WHERE id = ? AND gym_id = ?", [faqId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That custom answer doesn't exist.");
  return { deleted: true };
}

module.exports = { LIMITS, list, validateFaq, create, update, remove };
