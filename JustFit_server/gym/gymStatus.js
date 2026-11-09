// A branch's approval state (gym registration, migration 2026-12-27), read where it decides who may
// do what: Discover shows approved branches only, and a suspended branch is closed to its portal and
// to QR check-ins. Before the migration there is no status column: every branch counts as approved,
// so nothing changes until it has run.
const { ForbiddenError } = require("../errors");

// Whether migration 2026-12-27 has run: asked once, and again a minute later while it's missing
let registration = { has: false, at: 0 };
async function hasRegistration(db) {
  if (registration.has || Date.now() - registration.at < 60000) return registration.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'status'");
  registration = { has: Number(row.n) > 0, at: Date.now() };
  return registration.has;
}

/** { status, note } of a branch; approved (no note) before the migration or for a missing branch */
async function statusOf(db, gymId) {
  if (!(await hasRegistration(db))) return { status: "approved", note: null };
  const [[row]] = await db.query("SELECT status, status_note FROM gyms WHERE id = ?", [gymId]);
  return row ? { status: row.status, note: row.status_note } : { status: "approved", note: null };
}

const SUSPENDED = "justFit has suspended this gym for now.";

/** Throws a 403 when the branch is suspended; `who` words the message for staff or members */
async function refuseSuspended(db, gymId, who = "staff") {
  const { status, note } = await statusOf(db, gymId);
  if (status !== "suspended") return;
  if (who === "member") throw new ForbiddenError("This gym is closed on justFit for now, so check-ins are paused. Please ask the front desk.");
  throw new ForbiddenError(`${SUSPENDED}${note ? ` Reason: ${note}` : ""} Contact the justFit team to reopen it.`);
}

/** The SQL condition members' lists use: approved branches only (nothing before the migration) */
async function visibleClause(db, alias = "g") {
  return (await hasRegistration(db)) ? ` AND ${alias}.status = 'approved'` : "";
}

module.exports = { hasRegistration, statusOf, refuseSuspended, visibleClause };
