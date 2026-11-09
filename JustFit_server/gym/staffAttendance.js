// Staff and trainer attendance (2026-11-09): Attendance › Staff & Trainers. The branch's Staff
// (kind 'staff') and Trainers (kind 'trainer') check in and out by scanning the branch's own
// attendance QR code, Staff from the gym portal and trainers from their justFit app, through the
// same /api/attendance routes and GPS checks as members (gym/attendance.js decides who is
// scanning); the gym admin can also check them in and out by hand and is the only one who sees
// the tab (ownerOnly in gym/routes.js).
//
// Who is who: the scanner is the session's account with a gym_staff row of kind staff or trainer
// at the scanned branch; the person the gym admin checks in by hand must have one at the admin's
// branch. A visit is one row of gym_staff_attendance, shaped like a member's (gym_attendance);
// open_user_id is set to the person while inside and cleared on every close (one open visit each).
const { NotFoundError, ConflictError } = require("../errors");
const { inTransaction, gymInfo } = require("./service");
const rules = require("./rules");
const att = require("./attendanceRules");
const staffRules = require("./staffRules");

const ms = (column) => `CAST(UNIX_TIMESTAMP(${column}) * 1000 AS UNSIGNED)`;
const KINDS = ["staff", "trainer"];
const KIND_LABEL = { staff: "Staff", trainer: "Trainer" };
const nameOf = (fullName, kind) => (fullName && fullName.trim()) || `${KIND_LABEL[kind]} (no name yet)`;
const isDuplicate = (error) => error?.code === "ER_DUP_ENTRY";

// A visit left open on an earlier day was never checked out (midnight, India time, as for members)
async function closeStale(db, where, params, today = rules.todayInIndia()) {
  const [result] = await db.query(`UPDATE gym_staff_attendance SET status = 'no_checkout', open_user_id = NULL WHERE status = 'inside' AND on_date < ? AND ${where}`, [today, ...params]);
  return result.affectedRows;
}
// Every branch's, at midnight; before the migration there is nothing to close
async function closeOpenVisits(db, today = rules.todayInIndia()) {
  try {
    return await closeStale(db, "1 = 1", [], today);
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return 0;
    throw error;
  }
}

// The account's place on this branch's team as Staff or Trainer, or null (the gym admin isn't one)
async function staffLink(db, userId, gymId, { lock = false } = {}) {
  const [[row]] = await db.query(
    `SELECT s.kind, u.full_name FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ? AND s.gym_id = ? AND s.kind IN ('staff', 'trainer')${lock ? " FOR UPDATE" : ""}`,
    [userId, gymId],
  );
  return row ? { kind: row.kind, name: nameOf(row.full_name, row.kind) } : null;
}

async function openVisit(db, userId, { lock = false } = {}) {
  const [[row]] = await db.query(
    `SELECT id, gym_id, ${ms("checked_in_at")} AS in_ms FROM gym_staff_attendance WHERE user_id = ? AND status = 'inside'${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return row ?? null;
}

async function finishVisit(db, visitId, { source, by = null, position = null, distance = null }) {
  await db.query(
    `UPDATE gym_staff_attendance SET status = 'completed', open_user_id = NULL, checked_out_at = NOW(), duration_min = LEAST(TIMESTAMPDIFF(MINUTE, checked_in_at, NOW()), 65535),
       out_source = ?, checked_out_by = ?, check_out_lat = ?, check_out_lng = ?, check_out_accuracy_m = ?, check_out_distance_m = ?
     WHERE id = ?`,
    [source, by, position?.latitude ?? null, position?.longitude ?? null, position ? Math.min(position.accuracy, 65535) : null, distance, visitId],
  );
}

async function visitTimes(db, visitId) {
  const [[row]] = await db.query(`SELECT ${ms("checked_in_at")} AS in_ms, ${ms("checked_out_at")} AS out_ms, duration_min FROM gym_staff_attendance WHERE id = ?`, [visitId]);
  return {
    checkedInAt: new Date(Number(row.in_ms)).toISOString(),
    checkedOutAt: row.out_ms ? new Date(Number(row.out_ms)).toISOString() : null,
    durationMin: row.duration_min,
  };
}

// ─── A scan of the branch's QR code (gym/attendance.js found the branch and this link) ────────

// After the scan, before GPS: whether this is a check-in or a check-out
async function scanPreview(db, userId, gym, link, today) {
  await closeStale(db, "user_id = ?", [userId], today);
  const open = await openVisit(db, userId);
  // An open visit at another branch of the gym is checked out there first
  const here = open && open.gym_id === gym.id;
  return {
    as: "staff",
    gym: gym.place,
    // The member card's shape, so the scanner reads one answer: always active, no code or plan
    member: { name: link.name, code: null, expiresOn: null, active: true, pausedUntil: null },
    staff: { kind: link.kind, label: KIND_LABEL[link.kind] },
    radiusM: gym.radiusM,
    hasLocation: gym.latitude !== null,
    openVisit: here ? { checkedInAt: new Date(Number(open.in_ms)).toISOString() } : null,
    nextAction: here ? "check_out" : "check_in",
  };
}

async function scanCheckIn(db, userId, gym, link, position, distance, today) {
  await staffLink(db, userId, gym.id, { lock: true });
  await closeStale(db, "user_id = ?", [userId], today);
  const open = await openVisit(db, userId);
  const already = () => new ConflictError(open && open.gym_id !== gym.id
    ? "You're still checked in at another branch. Check out there first."
    : "You're already checked in. Scan the same QR code when you leave to check out.");
  if (open) throw already();
  try {
    await db.query(
      `INSERT INTO gym_staff_attendance (gym_id, user_id, open_user_id, on_date, status, in_source, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m)
       VALUES (?, ?, ?, ?, 'inside', 'qr', ?, ?, ?, ?)`,
      [gym.id, userId, userId, today, position.latitude, position.longitude, Math.min(position.accuracy, 65535), distance],
    );
  } catch (error) {
    if (isDuplicate(error)) throw already();
    throw error;
  }
  const visit = await openVisit(db, userId);
  return { as: "staff", action: "check_in", gym: gym.place, member: { name: link.name, code: null }, checkedInAt: new Date(Number(visit.in_ms)).toISOString(), distanceM: distance };
}

async function scanCheckOut(db, userId, gym, link, position, distance, today) {
  await staffLink(db, userId, gym.id, { lock: true });
  await closeStale(db, "user_id = ?", [userId], today);
  const visit = await openVisit(db, userId, { lock: true });
  if (!visit || visit.gym_id !== gym.id) throw new ConflictError("You haven't checked in here yet. Scan the QR code to check in first.");
  if (Date.now() - Number(visit.in_ms) < att.MIN_VISIT_MS) throw new ConflictError("You checked in less than a minute ago. Scan again when you leave.");
  await finishVisit(db, visit.id, { source: "qr", position, distance });
  return { as: "staff", action: "check_out", gym: gym.place, member: { name: link.name, code: null }, ...(await visitTimes(db, visit.id)), distanceM: distance };
}

// The account's own recent days at work, for the scanner's "recent visits" list
async function myVisits(pool, userId, today = rules.todayInIndia()) {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.status, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, a.duration_min, a.on_date < ? AS stale,
         b.name AS brand, g.name AS branch
       FROM gym_staff_attendance a JOIN gyms g ON g.id = a.gym_id JOIN gym_brands b ON b.id = g.brand_id
       WHERE a.user_id = ? ORDER BY a.checked_in_at DESC, a.id DESC LIMIT 20`,
      [today, userId],
    );
    return rows;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

// ─── The gym admin: the tab, and checking someone in or out by hand ──────────────────────────

async function teamMember(db, gymId, userId, { lock = false } = {}) {
  const [[row]] = await db.query(
    `SELECT s.kind, u.full_name FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ? AND s.gym_id = ? AND s.kind IN ('staff', 'trainer')${lock ? " FOR UPDATE" : ""}`,
    [userId, gymId],
  );
  if (!row) throw new NotFoundError("That person isn't on this branch's team as Staff or Trainer.");
  return row;
}

async function adminCheckIn(pool, gym, adminId, userId, today) {
  return inTransaction(pool, async (db) => {
    await teamMember(db, gym.id, userId, { lock: true });
    await closeStale(db, "user_id = ?", [userId], today);
    const open = await openVisit(db, userId);
    if (open && open.gym_id !== gym.id) throw new ConflictError("They're checked in at another branch. Check them out there first.");
    if (open) return { alreadyIn: true };
    try {
      await db.query("INSERT INTO gym_staff_attendance (gym_id, user_id, open_user_id, on_date, status, in_source, created_by) VALUES (?, ?, ?, ?, 'inside', 'admin', ?)", [gym.id, userId, userId, today, adminId]);
    } catch (error) {
      if (isDuplicate(error)) return { alreadyIn: true };
      throw error;
    }
    return { alreadyIn: false };
  });
}

async function adminCheckOut(pool, gym, adminId, userId, today) {
  return inTransaction(pool, async (db) => {
    await teamMember(db, gym.id, userId, { lock: true });
    await closeStale(db, "user_id = ?", [userId], today);
    const visit = await openVisit(db, userId, { lock: true });
    if (!visit || visit.gym_id !== gym.id) throw new ConflictError("They aren't checked in here.");
    await finishVisit(db, visit.id, { source: "admin", by: adminId });
    return { durationMin: (await visitTimes(db, visit.id)).durationMin };
  });
}

const escapeLike = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const visitOf = (r) => ({
  id: r.id,
  userId: r.user_id,
  name: nameOf(r.full_name, r.kind ?? "staff"),
  kind: r.kind ?? null, // null once they have left the team
  date: r.on_date,
  checkedInAt: new Date(Number(r.in_ms)).toISOString(),
  checkedOutAt: r.out_ms ? new Date(Number(r.out_ms)).toISOString() : null,
  durationMin: r.status === "inside" ? r.minutes_so_far : r.duration_min,
  status: r.status,
  inSource: r.in_source,
  outSource: r.out_source ?? null,
});

const VISIT_COLUMNS = `a.id, a.user_id, u.full_name, s.kind, DATE_FORMAT(a.on_date, '%Y-%m-%d') AS on_date, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms,
  a.duration_min, a.status, a.in_source, a.out_source, TIMESTAMPDIFF(MINUTE, a.checked_in_at, NOW()) AS minutes_so_far`;
const VISIT_FROM = "gym_staff_attendance a JOIN users u ON u.id = a.user_id LEFT JOIN gym_staff s ON s.user_id = a.user_id AND s.gym_id = a.gym_id";

// The tab: today's team (each Staff and Trainer with today's state), today's numbers, and the
// visits of the picked range (50 a page, newest first, searchable by name)
async function board(pool, gym, q, today) {
  await closeStale(pool, "gym_id = ?", [gym.id], today);
  let where = "a.gym_id = ? AND a.on_date BETWEEN ? AND ?";
  const params = [gym.id, q.from, q.to];
  if (q.search) { where += " AND u.full_name LIKE ?"; params.push(escapeLike(q.search)); }
  const [[people], [todayRows], [[{ total }]], [rows], [[place]]] = await Promise.all([
    pool.query(
      `SELECT s.user_id, s.kind, u.full_name, u.verified_phone FROM gym_staff s JOIN users u ON u.id = s.user_id
        WHERE s.gym_id = ? AND s.kind IN ('staff', 'trainer') ORDER BY FIELD(s.kind, 'staff', 'trainer'), u.full_name, s.user_id`,
      [gym.id],
    ),
    pool.query(`SELECT ${VISIT_COLUMNS} FROM ${VISIT_FROM} WHERE a.gym_id = ? AND a.on_date = ? ORDER BY a.checked_in_at, a.id`, [gym.id, today]),
    pool.query(`SELECT COUNT(*) AS total FROM ${VISIT_FROM} WHERE ${where}`, params),
    pool.query(`SELECT ${VISIT_COLUMNS} FROM ${VISIT_FROM} WHERE ${where} ORDER BY a.checked_in_at DESC, a.id DESC LIMIT ? OFFSET ?`, [...params, att.PAGE_SIZE, (q.page - 1) * att.PAGE_SIZE]),
    pool.query("SELECT latitude IS NOT NULL AS has_location, qr_version > 0 AS has_qr FROM gyms WHERE id = ?", [gym.id]),
  ]);
  const visitsToday = todayRows.map(visitOf);
  const team = people.map((p) => {
    const mine = visitsToday.filter((v) => v.userId === p.user_id);
    const open = mine.find((v) => v.status === "inside") ?? null;
    const finished = mine.filter((v) => v.status === "completed");
    return {
      userId: p.user_id,
      name: nameOf(p.full_name, p.kind),
      kind: p.kind,
      phone: staffRules.maskPhone(p.verified_phone),
      // inside now, or was in today and left, or hasn't come in today
      today: open ? "inside" : mine.length > 0 ? "left" : "absent",
      firstInAt: mine[0]?.checkedInAt ?? null,
      lastOutAt: open ? null : (mine.at(-1)?.checkedOutAt ?? null),
      minutesToday: mine.reduce((sum, v) => sum + (v.durationMin ?? 0), 0),
      visitsToday: mine.length,
      finishedToday: finished.length,
    };
  });
  const finishedMinutes = visitsToday.filter((v) => v.status === "completed").map((v) => v.durationMin ?? 0);
  return {
    gym: gymInfo(gym),
    today,
    setup: { location: Boolean(place.has_location), qr: Boolean(place.has_qr) },
    team,
    stats: {
      teamSize: team.length,
      insideNow: team.filter((t) => t.today === "inside").length,
      cameToday: team.filter((t) => t.today !== "absent").length,
      absentToday: team.filter((t) => t.today === "absent").length,
      avgMinutes: finishedMinutes.length ? Math.round(finishedMinutes.reduce((a, b) => a + b, 0) / finishedMinutes.length) : null,
    },
    range: q.range,
    from: q.from,
    to: q.to,
    visits: rows.map(visitOf),
    total,
    page: q.page,
    pageSize: att.PAGE_SIZE,
  };
}

module.exports = { KINDS, staffLink, scanPreview, scanCheckIn, scanCheckOut, myVisits, adminCheckIn, adminCheckOut, board, closeOpenVisits };
