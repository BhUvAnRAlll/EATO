// Gym Hub › ask to join (phase 4, 2026-11-09): a member picks a plan on a gym's page and asks the
// gym to call them. The request is an enquiry in that branch's Enquiries (source 'app', the member's
// account in user_id, the plan picked), so the gym follows it up like any other lead: it shows on
// Enquiries › Today with a call-back date of today. There is no payment. The member's name and
// number come from their account (the verified phone), never from the request. The member sees
// their own requests' state only: never the gym's notes, contacts or follow-up dates.
const { getAccount } = require("../auth");
const { ConflictError, NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const rules = require("./joinRules");
const { activeOnly, inTransaction } = require("./service");
const { todayInIndia } = require("./rules");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;

const trialRules = require("./trialRules");

const requestOf = (r) => ({
  id: r.id,
  gym: { id: r.gym_id, name: r.brand, branch: r.branch },
  planLabel: r.plan_label ?? null,
  state: rules.requestState(r.status),
  sentOn: r.enquired_on,
  // A free trial (Book a free trial): where it stands and when it's booked; null for a join request
  trial: r.trial_status ? trialRules.trialOf(r) : null,
});
// The trial columns come from trials.js (none before migration 2027-02-02): required lazily, since
// trials.js needs this file's neighbours loaded first
const requestSelect = async (db) =>
  `SELECT e.id, e.gym_id, e.status, e.plan_label, ${DAY("e.enquired_on")} AS enquired_on, b.name AS brand, g.name AS branch${await require("./trials").trialColumns(db)}
  FROM gym_enquiries e JOIN gyms g ON g.id = e.gym_id JOIN gym_brands b ON b.id = g.brand_id`;

/** POST /api/gyms/:id/requests: one open request per gym, none while a member there already */
async function ask(pool, userId, gymId, body, today = todayInIndia()) {
  const account = await getAccount(userId, pool);
  if (!account.phone) throw new ValidationError("Add your mobile number to your account first, so the gym can call you.");
  const [[user]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [userId]);
  const name = (user?.full_name ?? "").trim().slice(0, 80) || "justFit member";

  const id = await inTransaction(pool, async (db) => {
    // The branch's row locked: two taps at once can't both pass the "already asked" check
    const [[gym]] = await db.query("SELECT g.id, g.name AS branch, b.name AS brand FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ? FOR UPDATE", [gymId]);
    if (!gym) throw new NotFoundError("That gym isn't on justFit any more.");

    let item = null;
    if (body.itemId !== null) {
      // Only a plan members can see (active, once migration 2026-12-24 has run)
      [[item]] = await db.query(`SELECT id, kind, name, duration, duration_unit, price FROM gym_catalog_items WHERE id = ? AND gym_id = ? AND kind IN ('plan', 'pt')${await activeOnly(db)}`, [body.itemId, gymId]);
      if (!item) throw new ValidationError("Pick one of this gym's plans.");
    }

    const [[member]] = await db.query("SELECT id FROM gym_members WHERE gym_id = ? AND phone = ? AND expires_on >= ? LIMIT 1", [gymId, account.phone, today]);
    if (member && item?.kind !== "pt") throw new ConflictError(`You're already a member at ${gym.brand} ${gym.branch}. It's under My Memberships.`);
    const [[open]] = await db.query("SELECT id FROM gym_enquiries WHERE user_id = ? AND gym_id = ? AND status IN ('new', 'follow_up') LIMIT 1", [userId, gymId]);
    if (open) throw new ConflictError(`You've already asked ${gym.brand} to call you. They'll be in touch.`);
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_enquiries WHERE user_id = ? AND status IN ('new', 'follow_up')", [userId]);
    if (n >= rules.OPEN_LIMIT) throw new ValidationError(`You have ${rules.OPEN_LIMIT} requests waiting. Wait for a gym to call you back first.`);

    const [inserted] = await db.query(
      `INSERT INTO gym_enquiries (gym_id, full_name, phone, note, status, follow_up_on, interest, source, user_id, catalog_item_id, plan_label, enquired_on)
       VALUES (?, ?, ?, ?, 'new', ?, ?, 'app', ?, ?, ?, ?)`,
      [gymId, name, account.phone, body.note, today, item?.kind === "pt" ? "pt" : "membership", userId, item?.id ?? null, item ? rules.planLabel(item) : null, today],
    );
    return inserted.insertId;
  });
  const [[row]] = await pool.query(`${await requestSelect(pool)} WHERE e.id = ? AND e.user_id = ?`, [id, userId]);
  return { request: requestOf(row) };
}

/** GET /api/gyms/requests: the member's own requests, newest first */
async function mine(pool, userId) {
  const [rows] = await pool.query(`${await requestSelect(pool)} WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 50`, [userId]);
  return { requests: rows.map(requestOf) };
}

/**
 * For a gym's page: the member's latest request there and whether they are a member now. Before
 * migration 2026-12-19 nobody has a request (the page still works).
 */
async function standing(pool, userId, gymId, today = todayInIndia()) {
  const account = await getAccount(userId, pool);
  const [[member]] = account.phone
    ? await pool.query("SELECT id FROM gym_members WHERE gym_id = ? AND phone = ? AND expires_on >= ? LIMIT 1", [gymId, account.phone, today])
    : [[null]];
  let request = null;
  try {
    const [[row]] = await pool.query(`${await requestSelect(pool)} WHERE e.user_id = ? AND e.gym_id = ? ORDER BY e.id DESC LIMIT 1`, [userId, gymId]);
    request = row ? requestOf(row) : null;
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
  }
  return { memberId: member?.id ?? null, request };
}

/** One of the member's own requests by id (a trial just sent), as `mine` lists it */
async function one(pool, userId, enquiryId) {
  const [[row]] = await pool.query(`${await requestSelect(pool)} WHERE e.id = ? AND e.user_id = ?`, [enquiryId, userId]);
  return row ? requestOf(row) : null;
}

module.exports = { ask, mine, standing, one };
