// Questions for the gym's team: what the in-app assistant couldn't answer (recorded from
// whatsapp/assistant.js when it escalates), the owner portal's list and replies, and the asker's own
// view of their questions. Replies reach the asker in the gym's Ask chat and in their bell.
//
// Staff routes go through ownerAccess (the gym's owner and admins, or an JustFit admin). The asker
// only ever reads their own rows.
const { ValidationError } = require("../profile");
const { memberSummary } = require("../community/members");
const { NotFoundError } = require("../community/posts");
const { ownerAccess } = require("./owner");

const LIMITS = { question: 500, aiReply: 1000, answer: 1000 };

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};
const iso = (v) => (v ? new Date(v).toISOString() : null);

// Called when the assistant passes a member's question on. Never throws: a failure here must not
// break the answer the member is already getting.
async function recordQuestion(pool, gymId, userId, question, aiReply) {
  try {
    if (typeof question !== "string" || !question.trim()) return;
    await pool.query(
      "INSERT INTO gym_assistant_questions (gym_id, user_id, question, ai_reply) VALUES (?, ?, ?, ?)",
      [gymId, userId, question.trim().slice(0, LIMITS.question), typeof aiReply === "string" ? aiReply.slice(0, LIMITS.aiReply) : null],
    );
  } catch (error) {
    console.error("assistant question not saved", error?.code ?? "");
  }
}

const toApi = (row) => ({
  id: row.id,
  asker: memberSummary(row),
  question: row.question,
  aiReply: row.ai_reply,
  status: row.status,
  answer: row.answer,
  answeredBy: row.answerer_name ?? null,
  answeredAt: iso(row.answered_at),
  askedAt: iso(row.created_at),
});

const SELECT = `SELECT q.id, q.user_id, q.question, q.ai_reply, q.status, q.answer, q.answered_at, q.created_at,
  u.full_name, a.full_name AS answerer_name
  FROM gym_assistant_questions q JOIN users u ON u.id = q.user_id LEFT JOIN users a ON a.id = q.answered_by`;

// The portal's list: open questions first (oldest first, so nobody waits longest), then the last
// 30 answered or dismissed
async function list(pool, staffId, gymId) {
  await ownerAccess(pool, gymId, staffId);
  const [open] = await pool.query(`${SELECT} WHERE q.gym_id = ? AND q.status = 'open' ORDER BY q.created_at, q.id LIMIT 200`, [gymId]);
  const [done] = await pool.query(`${SELECT} WHERE q.gym_id = ? AND q.status <> 'open' ORDER BY COALESCE(q.answered_at, q.created_at) DESC, q.id LIMIT 30`, [gymId]);
  return { open: open.map(toApi), closed: done.map(toApi) };
}

function validateReply(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Write a reply.");
  const extra = Object.keys(body).filter((k) => k !== "answer");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!answer) throw new ValidationError("Write a reply.");
  if (answer.length > LIMITS.answer) throw new ValidationError(`Keep the reply to ${LIMITS.answer} characters.`);
  return { answer };
}

async function questionFor(db, gymId, questionId) {
  const [[row]] = await db.query("SELECT id, status FROM gym_assistant_questions WHERE id = ? AND gym_id = ?", [questionId, gymId]);
  if (!row) throw new NotFoundError("That question doesn't exist.");
  return row;
}

// Reply to an open question (once): it shows in the asker's chat and bell
async function reply(pool, staffId, gymId, questionId, { answer }) {
  await ownerAccess(pool, gymId, staffId);
  const row = await questionFor(pool, gymId, questionId);
  if (row.status !== "open") throw conflict("That question has already been handled.");
  const [result] = await pool.query(
    "UPDATE gym_assistant_questions SET status = 'answered', answer = ?, answered_by = ?, answered_at = NOW() WHERE id = ? AND status = 'open'",
    [answer, staffId, questionId],
  );
  if (result.affectedRows === 0) throw conflict("That question has already been handled.");
  const [[saved]] = await pool.query(`${SELECT} WHERE q.id = ?`, [questionId]);
  return { question: toApi(saved) };
}

// Close a question without a reply (spam, or answered elsewhere)
async function dismiss(pool, staffId, gymId, questionId) {
  await ownerAccess(pool, gymId, staffId);
  const row = await questionFor(pool, gymId, questionId);
  if (row.status !== "open") throw conflict("That question has already been handled.");
  await pool.query("UPDATE gym_assistant_questions SET status = 'dismissed' WHERE id = ? AND status = 'open'", [questionId]);
  return { id: questionId, status: "dismissed" };
}

// The asker's own questions in one gym (the Ask chat shows them with the team's replies)
async function mine(pool, userId, gymId) {
  const [rows] = await pool.query(
    `${SELECT} WHERE q.user_id = ? AND q.gym_id = ? ORDER BY q.created_at DESC, q.id LIMIT 20`,
    [userId, gymId],
  );
  const [[gym]] = await pool.query("SELECT name FROM gyms WHERE id = ?", [gymId]);
  return {
    gymName: gym?.name ?? null,
    // The asker sees the team's reply, not who on the team wrote it
    questions: rows.map((row) => ({ id: row.id, question: row.question, status: row.status, answer: row.answer, answeredAt: iso(row.answered_at), askedAt: iso(row.created_at) })),
  };
}

module.exports = { LIMITS, recordQuestion, list, validateReply, reply, dismiss, mine };
