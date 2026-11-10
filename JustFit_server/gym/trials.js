// Gym Hub › Book a free trial (2026-11-10): a member asks a gym for a trial visit, the gym books it
// for a day and time, then marks it done or no-show. Each trial is a gym_enquiries row (interest
// 'trial', source 'app', the member's account in user_id), so it shows in the gym's Enquiries and is
// followed up and converted like any lead. The member's phone is always their account's verified
// one; the name and details are what the member confirmed (the app fills them in from the profile).
// Members read only their own trials; the gym only its branch's (every query is scoped).
const { getAccount } = require("../auth");
const { ConflictError, NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const rules = require("./trialRules");
const joinRules = require("./joinRules");
const { inTransaction } = require("./service");
const { todayInIndia } = require("./rules");

const MIGRATION = "Free trials need the 2027-02-02-gym-trials migration on this server.";
// Answered by the shared handler as a 503 with the message
class NotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotReadyError";
    this.status = 503;
  }
}

// Whether gym_enquiries has the trial columns (migration 2027-02-02), read once a minute
let columns = { has: false, at: 0 };
async function hasTrials(db) {
  if (columns.has || Date.now() - columns.at < 60000) return columns.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_enquiries' AND COLUMN_NAME = 'trial_status'");
  columns = { has: Number(row.n) > 0, at: Date.now() };
  return columns.has;
}
async function ready(db) {
  if (!(await hasTrials(db))) throw new NotReadyError(MIGRATION);
}

// The columns a query adds to read a trial (none before the migration: every trial reads as null)
const TRIAL_COLUMNS = "e.trial_status, e.trial_details, DATE_FORMAT(e.trial_at, '%Y-%m-%d') AS trial_day, DATE_FORMAT(e.trial_at, '%H:%i') AS trial_time";
const trialColumns = async (db) => ((await hasTrials(db)) ? `, ${TRIAL_COLUMNS}` : "");

/** POST /api/gyms/:id/trials: one open request per gym, none for a member there already */
async function request(pool, userId, gymId, body, today = todayInIndia()) {
  await ready(pool);
  const account = await getAccount(userId, pool);
  if (!account.phone) throw new ValidationError("Add your mobile number to your account first, so the gym can call you.");
  return inTransaction(pool, async (db) => {
    // The branch's row locked: two taps at once can't both pass the "already asked" check
    const [[gym]] = await db.query("SELECT g.id, g.name AS branch, b.name AS brand FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ? FOR UPDATE", [gymId]);
    if (!gym) throw new NotFoundError("That gym isn't on justFit any more.");
    const [[member]] = await db.query("SELECT id FROM gym_members WHERE gym_id = ? AND phone = ? AND expires_on >= ? LIMIT 1", [gymId, account.phone, today]);
    if (member) throw new ConflictError(`You're already a member at ${gym.brand} ${gym.branch}. It's under My Memberships.`);
    const [[open]] = await db.query("SELECT id, interest FROM gym_enquiries WHERE user_id = ? AND gym_id = ? AND status IN ('new', 'follow_up') AND (trial_status IS NULL OR trial_status IN ('requested', 'scheduled')) LIMIT 1", [userId, gymId]);
    if (open) throw new ConflictError(open.interest === "trial" ? `You've already asked ${gym.brand} for a trial. They'll call you to fix the time.` : `You've already asked ${gym.brand} to call you. Mention the trial when they do.`);
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM gym_enquiries WHERE user_id = ? AND status IN ('new', 'follow_up')", [userId]);
    if (n >= joinRules.OPEN_LIMIT) throw new ValidationError(`You have ${joinRules.OPEN_LIMIT} requests waiting. Wait for a gym to call you back first.`);

    const [inserted] = await db.query(
      `INSERT INTO gym_enquiries (gym_id, full_name, phone, note, status, follow_up_on, interest, source, user_id, plan_label, trial_details, trial_status, enquired_on)
       VALUES (?, ?, ?, ?, 'new', ?, 'trial', 'app', ?, ?, ?, 'requested', ?)`,
      [gymId, body.name, account.phone, body.note, today, userId, rules.requestLabel(body.details), JSON.stringify(body.details), today],
    );
    return { id: inserted.insertId, gym };
  });
}

/** DELETE /api/gyms/:id/trials/:enquiryId: the member calls off their own open trial */
async function cancel(pool, userId, gymId, enquiryId) {
  await ready(pool);
  const [result] = await pool.query(
    "UPDATE gym_enquiries SET trial_status = 'cancelled', status = 'lost' WHERE id = ? AND gym_id = ? AND user_id = ? AND trial_status IN ('requested', 'scheduled')",
    [enquiryId, gymId, userId],
  );
  if (result.affectedRows === 0) throw new NotFoundError("That trial isn't open any more.");
}

// The branch's trial enquiry, locked (404 for another branch's or one that isn't a trial)
async function lockedTrial(db, gymId, enquiryId) {
  const [[row]] = await db.query("SELECT id, status, trial_status, user_id, full_name FROM gym_enquiries WHERE id = ? AND gym_id = ? AND trial_status IS NOT NULL FOR UPDATE", [enquiryId, gymId]);
  if (!row) throw new NotFoundError("That trial request wasn't found.");
  return row;
}

/** PUT /api/gym/enquiries/:id/trial { day, time }: the gym books or moves the trial → { userId, at } */
async function schedule(pool, gymId, enquiryId, { day, time }) {
  await ready(pool);
  return inTransaction(pool, async (db) => {
    const row = await lockedTrial(db, gymId, enquiryId);
    if (!rules.isOpenTrial(row.trial_status) || !["new", "follow_up"].includes(row.status)) throw new ConflictError("This trial is closed. Reopen the enquiry to book another.");
    await db.query(
      "UPDATE gym_enquiries SET trial_status = 'scheduled', trial_at = ?, plan_label = ?, follow_up_on = ?, status = 'follow_up' WHERE id = ?",
      [`${day} ${time}:00`, rules.scheduledLabel(day, time), day, enquiryId],
    );
    return { userId: row.user_id, text: `${rules.dayText(day)}, ${rules.clockText(time)}`, moved: row.trial_status === "scheduled" };
  });
}

/** POST /api/gym/enquiries/:id/trial/outcome { outcome }: after a booked trial. The enquiry stays open to convert. */
async function outcome(pool, gymId, enquiryId, { outcome: result }) {
  await ready(pool);
  return inTransaction(pool, async (db) => {
    const row = await lockedTrial(db, gymId, enquiryId);
    if (row.trial_status !== "scheduled" && row.trial_status !== result) throw new ConflictError("Book the trial's time first.");
    await db.query("UPDATE gym_enquiries SET trial_status = ? WHERE id = ?", [result, enquiryId]);
  });
}

module.exports = { MIGRATION, hasTrials, trialColumns, request, cancel, schedule, outcome };
