// Gym reviews (Gym Profile Management phase 4, 2026-11-09; the user's choices): a member rates a
// branch they are or were a member of (a gym_members row there with the account's verified phone,
// never anything the app sends), one review per account per branch, and can change or delete it.
// Members read every review's stars and the words of those the gym hasn't hidden, with the
// reviewer as "Arjun M.". The gym (Gym Profile › Reviews) replies, or hides the words with a
// reason, and shows them again; it can never change, remove or leave out a rating: hidden reviews
// still count in the average. Every query is scoped to the branch: another branch's review is a 404.
const { getAccount } = require("../auth");
const { audit } = require("../admin/overview");
const { ForbiddenError, NotFoundError } = require("../errors");
const rules = require("./reviewRules");
const { inTransaction } = require("./service");

const iso = (value) => (value ? new Date(value).toISOString() : null);
const SELECT = `SELECT r.id, r.gym_id, r.user_id, r.rating, r.comment, r.hidden_reason, r.reply, r.replied_at, r.created_at, r.updated_at, u.full_name
  FROM gym_reviews r JOIN users u ON u.id = r.user_id`;

// A review as members read it: hidden words left out (the stars stay)
const publicReview = (r, userId) => ({
  id: r.id,
  name: rules.reviewerName(r.full_name),
  rating: r.rating,
  comment: r.hidden_reason ? null : r.comment,
  date: iso(r.updated_at),
  edited: r.updated_at && r.created_at ? new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60000 : false,
  reply: r.reply ? { text: r.reply, date: iso(r.replied_at) } : null,
  isYou: r.user_id === userId,
});
// The member's own review: all of it, with whether (and why) the gym hid the words
const ownReview = (r) => ({
  id: r.id, rating: r.rating, comment: r.comment, hiddenReason: r.hidden_reason ?? null,
  reply: r.reply ? { text: r.reply, date: iso(r.replied_at) } : null, date: iso(r.updated_at),
});
// For the gym's portal: the words even when hidden, the reason, the reply
const portalReview = (r) => ({
  id: r.id, name: rules.reviewerName(r.full_name), rating: r.rating, comment: r.comment, hiddenReason: r.hidden_reason ?? null,
  date: iso(r.updated_at), reply: r.reply ? { text: r.reply, date: iso(r.replied_at) } : null,
});

async function summaryOf(db, gymId) {
  const [rows] = await db.query("SELECT rating, COUNT(*) AS n FROM gym_reviews WHERE gym_id = ? GROUP BY rating", [gymId]);
  return rules.summary(rows);
}

// Whether this account is or was a member of the branch: by its verified phone only
async function wasMember(db, userId, gymId) {
  const account = await getAccount(userId, db);
  if (!account.phone) return false;
  const [[row]] = await db.query("SELECT id FROM gym_members WHERE gym_id = ? AND phone = ? LIMIT 1", [gymId, account.phone]);
  return Boolean(row);
}

async function branchExists(db, gymId) {
  const [[gym]] = await db.query("SELECT id FROM gyms WHERE id = ?", [gymId]);
  if (!gym) throw new NotFoundError("That gym isn't on justFit any more.");
}

/**
 * For members: the branch's summary, a page of reviews (newest change first, hidden words left
 * out), the member's own review and whether they may write one (userId null: the gym's own
 * preview, neither). size: RECENT on the gym's page.
 */
async function forMember(pool, gymId, userId, { page = 1, size = rules.PAGE_SIZE } = {}) {
  await branchExists(pool, gymId);
  const [summary, [rows], [[mine]], canReview] = await Promise.all([
    summaryOf(pool, gymId),
    pool.query(`${SELECT} WHERE r.gym_id = ? ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`, [gymId, size + 1, (page - 1) * size]),
    userId ? pool.query(`${SELECT} WHERE r.gym_id = ? AND r.user_id = ?`, [gymId, userId]) : [[null]],
    userId ? wasMember(pool, userId, gymId) : false,
  ]);
  return {
    summary,
    reviews: rows.slice(0, size).map((r) => publicReview(r, userId)),
    nextPage: rows.length > size ? page + 1 : null,
    mine: mine ? ownReview(mine) : null,
    canReview,
  };
}

/** PUT /api/gyms/:id/review: writes or changes the member's own review */
async function save(pool, userId, gymId, body) {
  await inTransaction(pool, async (db) => {
    await branchExists(db, gymId);
    if (!(await wasMember(db, userId, gymId))) throw new ForbiddenError("Only members of this gym can review it.");
    const [[existing]] = await db.query("SELECT id, comment FROM gym_reviews WHERE gym_id = ? AND user_id = ? FOR UPDATE", [gymId, userId]);
    if (!existing) {
      await db.query("INSERT INTO gym_reviews (gym_id, user_id, rating, comment) VALUES (?, ?, ?, ?)", [gymId, userId, body.rating, body.comment]);
      return;
    }
    // New words are new words: a hidden review shows again until the gym looks at it again
    const reword = (existing.comment ?? null) !== body.comment;
    await db.query(
      `UPDATE gym_reviews SET rating = ?, comment = ?, updated_at = NOW()${reword ? ", hidden_reason = NULL, hidden_at = NULL, hidden_by = NULL" : ""} WHERE id = ?`,
      [body.rating, body.comment, existing.id],
    );
  });
  return forMember(pool, gymId, userId, { size: rules.RECENT });
}

/** DELETE /api/gyms/:id/review: the member's own, with the gym's reply */
async function remove(pool, userId, gymId) {
  const [result] = await pool.query("DELETE FROM gym_reviews WHERE gym_id = ? AND user_id = ?", [gymId, userId]);
  if (result.affectedRows === 0) throw new NotFoundError("You haven't reviewed this gym.");
  return forMember(pool, gymId, userId, { size: rules.RECENT });
}

/** For Discover's cards: each branch's average and count (none before the migration) */
async function ratingsOf(pool, gymIds) {
  const out = new Map();
  if (gymIds.length === 0) return out;
  try {
    const [rows] = await pool.query("SELECT gym_id, COUNT(*) AS n, AVG(rating) AS average FROM gym_reviews WHERE gym_id IN (?) GROUP BY gym_id", [gymIds]);
    for (const r of rows) out.set(r.gym_id, { average: Math.round(Number(r.average) * 10) / 10, count: Number(r.n) });
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  return out;
}

// ---- The gym's portal ------------------------------------------------------------------------

const VIEW_WHERE = { all: "", unreplied: " AND r.reply IS NULL", hidden: " AND r.hidden_reason IS NOT NULL" };

/** GET /api/gym/reviews: the branch's reviews for the gym, 20 a page, with each view's count */
async function list(pool, gym, { view, page }) {
  const size = rules.PAGE_SIZE;
  const [summary, [[counts]], [rows]] = await Promise.all([
    summaryOf(pool, gym.id),
    pool.query("SELECT COUNT(*) AS total, SUM(reply IS NULL) AS unreplied, SUM(hidden_reason IS NOT NULL) AS hidden FROM gym_reviews WHERE gym_id = ?", [gym.id]),
    pool.query(`${SELECT} WHERE r.gym_id = ?${VIEW_WHERE[view]} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`, [gym.id, size + 1, (page - 1) * size]),
  ]);
  return {
    summary,
    counts: { all: Number(counts.total), unreplied: Number(counts.unreplied ?? 0), hidden: Number(counts.hidden ?? 0) },
    reviews: rows.slice(0, size).map(portalReview),
    page,
    nextPage: rows.length > size ? page + 1 : null,
  };
}

// One change to one of this branch's reviews, audited; answers the review as it is now
async function change(pool, gym, editorId, reviewId, sql, params, what) {
  return inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT id FROM gym_reviews WHERE id = ? AND gym_id = ? FOR UPDATE", [reviewId, gym.id]);
    if (!row) throw new NotFoundError("That review isn't at this branch.");
    await db.query(`UPDATE gym_reviews SET ${sql} WHERE id = ?`, [...params, reviewId]);
    await audit(db, editorId, "gym.edit", "gym", gym.id, `${what} at ${gym.brand}’s ${gym.branch} branch`);
    const [[review]] = await db.query(`${SELECT} WHERE r.id = ?`, [reviewId]);
    return { review: portalReview(review) };
  });
}

// The column lists are fixed here; only values come from the request
const reply = (pool, gym, editorId, id, body) => change(pool, gym, editorId, id, "reply = ?, replied_at = NOW(), replied_by = ?", [body.reply, editorId], "Replied to a review");
const removeReply = (pool, gym, editorId, id) => change(pool, gym, editorId, id, "reply = NULL, replied_at = NULL, replied_by = NULL", [], "Removed a reply to a review");
const hide = (pool, gym, editorId, id, body) => change(pool, gym, editorId, id, "hidden_reason = ?, hidden_at = NOW(), hidden_by = ?", [body.reason, editorId], "Hid a review's words");
const show = (pool, gym, editorId, id) => change(pool, gym, editorId, id, "hidden_reason = NULL, hidden_at = NULL, hidden_by = NULL", [], "Showed a review's words again");

module.exports = { forMember, save, remove, ratingsOf, summaryOf, list, reply, removeReply, hide, show };
