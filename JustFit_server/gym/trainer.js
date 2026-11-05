// Gym trainers and their PT clients (phase 2 of Staff / Admin Login, 2026-11-05).
// Trainer side (/api/trainer, gym/trainerRoutes.js): My Clients, a client's page and photo. Every
// query is scoped twice: the member's PT is with the caller (pt_trainer_id) and the caller is a
// trainer at that member's branch (gym_staff kind 'trainer'), so a trainer who left a branch sees
// none of its members. Nothing about money is read.
// Gym side (gym/routes.js): the branch's trainers for the PT picker, and setting a member's trainer.
const { NotFoundError } = require("../errors");
const { ValidationError } = require("../profile");
const { toE164 } = require("../auth/phone");
const rules = require("./trainerRules");
const { DAY } = require("./service");

const CLIENT_COLUMNS = `m.id, m.member_code, m.full_name, m.phone, m.photo_key, m.gym_id, g.name AS branch, m.pt_label,
  ${DAY("m.pt_from")} AS pt_from, ${DAY("m.pt_until")} AS pt_until,
  EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date = ?) AS in_today`;
// The caller's clients: their PT, at a branch where they are a trainer
const CLIENT_SCOPE = `FROM gym_members m
  JOIN gym_staff s ON s.gym_id = m.gym_id AND s.user_id = ? AND s.kind = 'trainer'
  JOIN gyms g ON g.id = m.gym_id
  WHERE m.pt_trainer_id = ? AND m.pt_until >= ?`;

// My Clients: the gym and branches they train at, and their clients (active PT, then ended)
async function clients(pool, userId, today) {
  const [branches] = await pool.query(
    "SELECT g.id, g.name AS branch, b.name AS gym FROM gym_staff s JOIN gyms g ON g.id = s.gym_id JOIN gym_brands b ON b.id = g.brand_id WHERE s.user_id = ? AND s.kind = 'trainer' ORDER BY g.name, g.id",
    [userId],
  );
  const [rows] = await pool.query(`SELECT ${CLIENT_COLUMNS} ${CLIENT_SCOPE}`, [today, userId, userId, rules.oldestShown(today)]);
  return {
    gym: branches[0]?.gym ?? null,
    branches: branches.map((b) => b.branch),
    clients: rules.sortClients(rows.map((r) => rules.clientOf(r, today, toE164))),
  };
}

// One client, or 404 when they aren't the caller's (another trainer's, another gym's, or ended
// more than 30 days ago)
async function clientRow(pool, userId, memberId, today) {
  const [[row]] = await pool.query(`SELECT ${CLIENT_COLUMNS} ${CLIENT_SCOPE} AND m.id = ?`, [today, userId, userId, rules.oldestShown(today), memberId]);
  if (!row) throw new NotFoundError("That client isn't on your list.");
  return row;
}

// A client's page: their PT and their last 10 visits
async function client(pool, userId, memberId, today) {
  const row = await clientRow(pool, userId, memberId, today);
  const [visits] = await pool.query(
    `SELECT ${DAY("on_date")} AS on_date, checked_in_at, checked_out_at, status, duration_min
       FROM gym_attendance WHERE member_id = ? AND gym_id = ? ORDER BY checked_in_at DESC, id DESC LIMIT 10`,
    [memberId, row.gym_id],
  );
  return {
    client: rules.clientOf(row, today, toE164),
    visits: visits.map((v) => ({
      onDate: v.on_date,
      inAt: new Date(v.checked_in_at).toISOString(),
      outAt: v.checked_out_at ? new Date(v.checked_out_at).toISOString() : null,
      status: v.status,
      durationMin: v.duration_min ?? null,
    })),
  };
}

// The client's gym (for their photo), after the same check
async function clientGymId(pool, userId, memberId, today) {
  return (await clientRow(pool, userId, memberId, today)).gym_id;
}

// Gym side: the branch's trainers, for the PT picker
async function branchTrainers(pool, gymId) {
  const [rows] = await pool.query(
    "SELECT u.id, u.full_name, u.verified_phone FROM gym_staff s JOIN users u ON u.id = s.user_id WHERE s.gym_id = ? AND s.kind = 'trainer' ORDER BY u.full_name IS NULL, u.full_name, s.added_at",
    [gymId],
  );
  return { trainers: rows.map((r) => ({ id: r.id, name: (r.full_name && r.full_name.trim()) || `Trainer ${r.verified_phone ? `••${r.verified_phone.slice(7)}` : ""}`.trim() })) };
}

// A trainer id from a request: null clears it; anything else must be one of this branch's
// trainers (checked in the caller's transaction)
async function checkTrainer(db, gymId, trainerId) {
  if (trainerId === null) return null;
  const [[row]] = await db.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND user_id = ? AND kind = 'trainer'", [gymId, trainerId]);
  if (!row) throw new ValidationError("Pick one of this branch's trainers.");
  return trainerId;
}

// Member › ⋯ › Change trainer
async function setTrainer(pool, gymId, memberId, trainerId) {
  const checked = await checkTrainer(pool, gymId, trainerId);
  const [result] = await pool.query("UPDATE gym_members SET pt_trainer_id = ? WHERE id = ? AND gym_id = ?", [checked, memberId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That member doesn't exist.");
}

module.exports = { clients, client, clientGymId, branchTrainers, checkTrainer, setTrainer };
