// Attendance corrections (Gym Hub ecosystem, 2026-11-09): staff fix a visit's times or add a visit a
// member forgot to scan, with a reason; every change is kept in gym_attendance_corrections with the
// times before and after. Every query is scoped to the caller's branch; the member and the visit are
// locked, and a change that would overlap another visit of the same member is refused. Before
// migration 2027-01-02 these routes answer 503 (gym/routes.js).
const { NotFoundError, ConflictError } = require("../errors");
const { audit } = require("../admin/overview");
const rules = require("./correctionRules");
const standing = require("./standing");
const { inTransaction } = require("./service");

const ms = (column) => `CAST(UNIX_TIMESTAMP(${column}) * 1000 AS UNSIGNED)`;
const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const toSql = (epochMs) => (epochMs === null ? null : new Date(epochMs));

// The member's other visits that day, to refuse an overlap
async function sameDayVisits(db, memberId, day, exceptId) {
  const [rows] = await db.query(
    `SELECT id, ${ms("checked_in_at")} AS in_ms, ${ms("checked_out_at")} AS out_ms FROM gym_attendance WHERE member_id = ? AND on_date = ? AND id <> ? FOR UPDATE`,
    [memberId, day, exceptId ?? 0],
  );
  return rows.map((r) => ({ id: r.id, inMs: Number(r.in_ms), outMs: r.out_ms === null ? null : Number(r.out_ms) }));
}

function refuseOverlap(others, span, nowMs) {
  if (others.some((v) => rules.overlaps(v, span, nowMs))) throw new ConflictError("That overlaps another visit of this member on the same day.");
}

/** POST /api/gym/attendance/visits: a visit the member forgot to scan */
async function addVisit(pool, gym, userId, body, nowMs = Date.now()) {
  const id = await inTransaction(pool, async (db) => {
    const [[member]] = await db.query("SELECT id, full_name, member_code, joined_on FROM gym_members WHERE id = ? AND gym_id = ? FOR UPDATE", [body.memberId, gym.id]);
    if (!member) throw new NotFoundError("That member isn't at your gym.");
    await standing.refuseInactive(db, member.id, gym.brand);
    refuseOverlap(await sameDayVisits(db, member.id, body.date, null), body, nowMs);
    const [visit] = await db.query(
      `INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, duration_min, in_source, out_source, created_by, checked_out_by)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, 'staff', 'staff', ?, ?)`,
      [gym.id, member.id, body.date, toSql(body.inMs), toSql(body.outMs), body.durationMin, userId, userId],
    );
    await db.query(
      "INSERT INTO gym_attendance_corrections (gym_id, attendance_id, member_id, kind, after_in, after_out, reason, by_user) VALUES (?, ?, ?, 'add', ?, ?, ?, ?)",
      [gym.id, visit.insertId, member.id, toSql(body.inMs), toSql(body.outMs), body.reason, userId],
    );
    await audit(db, userId, "gym.attendance_add", "gym", gym.id, `Added a missed visit of ${member.full_name} (${member.member_code}) on ${body.date} at ${gym.brand} ${gym.branch}`);
    return visit.insertId;
  });
  return visitOf(pool, gym.id, id);
}

/** PATCH /api/gym/attendance/visits/:id: new times on the visit's own day */
async function editVisit(pool, gym, userId, visitId, change, today, nowMs = Date.now()) {
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query(
      `SELECT a.id, a.member_id, a.status, ${DAY("a.on_date")} AS day, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, m.full_name, m.member_code
       FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id WHERE a.id = ? AND a.gym_id = ? FOR UPDATE`,
      [visitId, gym.id],
    );
    if (!row) throw new NotFoundError("That visit isn't at your gym.");
    const visit = { day: row.day, inMs: Number(row.in_ms), outMs: row.out_ms === null ? null : Number(row.out_ms) };
    const next = rules.editedSpan(visit, change, today, nowMs);
    refuseOverlap(await sameDayVisits(db, row.member_id, row.day, row.id), next, nowMs);
    const status = next.outMs === null ? "inside" : "completed";
    if (status === "inside" && row.status !== "inside") throw new ConflictError("A finished visit keeps a check-out time.");
    await db.query(
      "UPDATE gym_attendance SET checked_in_at = ?, checked_out_at = ?, status = ?, duration_min = ?, out_source = IF(? IS NULL, out_source, COALESCE(out_source, 'staff')), checked_out_by = IF(? IS NULL, checked_out_by, COALESCE(checked_out_by, ?)) WHERE id = ? AND gym_id = ?",
      [toSql(next.inMs), toSql(next.outMs), status, next.durationMin, next.outMs, next.outMs, userId, row.id, gym.id],
    );
    await db.query(
      "INSERT INTO gym_attendance_corrections (gym_id, attendance_id, member_id, kind, before_in, before_out, after_in, after_out, reason, by_user) VALUES (?, ?, ?, 'edit', ?, ?, ?, ?, ?, ?)",
      [gym.id, row.id, row.member_id, toSql(visit.inMs), toSql(visit.outMs), toSql(next.inMs), toSql(next.outMs), change.reason, userId],
    );
    await audit(db, userId, "gym.attendance_edit", "gym", gym.id, `Corrected a visit of ${row.full_name} (${row.member_code}) on ${row.day} at ${gym.brand} ${gym.branch}`);
  });
  return visitOf(pool, gym.id, visitId);
}

async function visitOf(pool, gymId, visitId) {
  const [[r]] = await pool.query(
    `SELECT a.id, a.member_id, ${DAY("a.on_date")} AS day, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, a.status, a.duration_min
     FROM gym_attendance a WHERE a.id = ? AND a.gym_id = ?`,
    [visitId, gymId],
  );
  return {
    visit: {
      id: r.id, memberId: r.member_id, date: r.day, status: r.status, durationMin: r.duration_min,
      checkedInAt: new Date(Number(r.in_ms)).toISOString(), checkedOutAt: r.out_ms ? new Date(Number(r.out_ms)).toISOString() : null,
    },
  };
}

const PAGE = 30;
/** GET /api/gym/attendance/corrections?page=: the branch's corrections, newest first */
async function list(pool, gym, { page }) {
  const [rows] = await pool.query(
    `SELECT c.id, c.kind, c.attendance_id, c.reason, c.created_at, ${ms("c.before_in")} AS before_in, ${ms("c.before_out")} AS before_out, ${ms("c.after_in")} AS after_in, ${ms("c.after_out")} AS after_out,
       m.id AS member_id, m.full_name, m.member_code, u.full_name AS by_name
     FROM gym_attendance_corrections c JOIN gym_members m ON m.id = c.member_id LEFT JOIN users u ON u.id = c.by_user
     WHERE c.gym_id = ? ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [gym.id, PAGE + 1, (page - 1) * PAGE],
  );
  const iso = (v) => (v === null || v === undefined || Number(v) === 0 ? null : new Date(Number(v)).toISOString());
  return {
    page,
    nextPage: rows.length > PAGE ? page + 1 : null,
    corrections: rows.slice(0, PAGE).map((r) => ({
      id: r.id,
      kind: r.kind,
      visitId: r.attendance_id,
      member: { id: r.member_id, name: r.full_name, code: r.member_code },
      before: r.kind === "edit" ? { in: iso(r.before_in), out: iso(r.before_out) } : null,
      after: { in: iso(r.after_in), out: iso(r.after_out) },
      reason: r.reason,
      by: r.by_name?.trim() || "Gym staff",
      at: new Date(r.created_at).toISOString(),
    })),
  };
}

module.exports = { addVisit, editVisit, list };
