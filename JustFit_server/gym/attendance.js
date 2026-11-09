// QR attendance (2026-11-04): a branch's location, geofence radius and signed QR code; members
// checking in and out by scanning it from the justFit app; staff checking members in and out by
// hand; and the attendance dashboard, history and CSV export.
//
// Who is who: gym staff work on the branch requireGymStaff found (gym_staff); a member is the
// gym_members row at the scanned branch whose phone is the signed-in account's verified phone.
// Neither a gym id nor a member id is ever taken from the request. A visit is one row of
// gym_attendance: 'inside' while open (one open visit per member, enforced by a unique key),
// 'completed' once checked out, 'no_checkout' when it was still open at midnight (India time).
const { NotFoundError, ConflictError, ForbiddenError } = require("../errors");
const { getAccount } = require("../auth");
const { logSecurityEvent } = require("../logging");
const { audit } = require("../admin/overview");
const { inTransaction, gymInfo } = require("./service");
const rules = require("./rules");
const att = require("./attendanceRules");
const xlsx = require("./xlsx");
const pauses = require("./pauses");
const staffAttendance = require("./staffAttendance");
const gymStatus = require("./gymStatus");

const IST_OFFSET_MS = 330 * 60 * 1000;
// "2026-11-04 18:05" in India time, from epoch milliseconds
const istStamp = (ms) => (ms === null || ms === undefined ? null : new Date(Number(ms) + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " "));
const ms = (column) => `CAST(UNIX_TIMESTAMP(${column}) * 1000 AS UNSIGNED)`;

const NOT_VALID = "This QR code is no longer valid. Ask the front desk for the gym's current attendance QR code.";

// A visit still open at midnight (India time) was never checked out: from then on it is
// 'no_checkout' and stops counting as inside. The sweep runs at midnight (startMidnightClose) and,
// so nothing depends on the timer, before every read or write that looks at open visits.
async function closeStale(db, where, params, today = rules.todayInIndia()) {
  const [result] = await db.query(`UPDATE gym_attendance SET status = 'no_checkout' WHERE status = 'inside' AND on_date < ? AND ${where}`, [today, ...params]);
  return result.affectedRows;
}

// Every branch's visits left open on an earlier day, members' and the team's
const closeOpenVisits = async (db, today = rules.todayInIndia()) =>
  (await closeStale(db, "1 = 1", [], today)) + (await staffAttendance.closeOpenVisits(db, today));

// At startup, then at every midnight in India; never in tests, which call closeOpenVisits themselves
function startMidnightClose(pool, { log = console, env = process.env, now = Date.now } = {}) {
  if (env.NODE_ENV === "test") return () => {};
  let timer = null;
  const run = () =>
    closeOpenVisits(pool, rules.todayInIndia(now()))
      .then((closed) => { if (closed > 0) log.log(`Gym attendance: ${closed} ${closed === 1 ? "visit" : "visits"} closed as no check-out at midnight`); })
      .catch((error) => log.error(`Gym attendance midnight close failed: ${error?.code ?? error?.name ?? "unknown"}`));
  const schedule = () => {
    // A few seconds past midnight, so the day has turned by the time the query runs
    timer = setTimeout(() => { run(); schedule(); }, att.msUntilIndiaMidnight(now()) + 5000);
    timer.unref?.();
  };
  const first = setTimeout(run, 0);
  first.unref?.();
  schedule();
  return () => { clearTimeout(first); clearTimeout(timer); };
}

// ─── The admin's settings: location, radius, QR code ─────────────────────────────────────────

async function settings(pool, gym, qrKey) {
  const [[row]] = await pool.query(
    `SELECT latitude, longitude, attendance_radius_m, qr_version, ${ms("qr_made_at")} AS qr_made_at FROM gyms WHERE id = ?`,
    [gym.id],
  );
  return {
    gym: gymInfo(gym),
    location: row.latitude === null ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    radiusM: row.attendance_radius_m,
    radiusLimits: { min: att.RADIUS.min, max: att.RADIUS.max },
    qr: row.qr_version > 0 ? { payload: att.qrPayload(qrKey, gym.id, row.qr_version), version: row.qr_version, madeAt: new Date(Number(row.qr_made_at)).toISOString() } : null,
  };
}

async function saveLocation(pool, gym, userId, body, qrKey) {
  await inTransaction(pool, async (db) => {
    await db.query("UPDATE gyms SET latitude = ?, longitude = ?, attendance_radius_m = ? WHERE id = ?", [body.latitude, body.longitude, body.radiusM, gym.id]);
    await audit(db, userId, "gym.attendance_place", "gym", gym.id, `The gym admin set ${gym.brand}’s ${gym.branch} attendance location (${body.radiusM} m)`);
  });
  return settings(pool, gym, qrKey);
}

// Makes the branch's first QR code, or a new one that replaces (and voids) the old
async function regenerateQr(pool, gym, userId, qrKey) {
  await inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT qr_version FROM gyms WHERE id = ? FOR UPDATE", [gym.id]);
    await db.query("UPDATE gyms SET qr_version = qr_version + 1, qr_made_at = NOW() WHERE id = ?", [gym.id]);
    await audit(db, userId, "gym.qr_regenerate", "gym", gym.id, `The gym admin ${row.qr_version > 0 ? "replaced" : "created"} ${gym.brand}’s ${gym.branch} attendance QR code`);
  });
  return settings(pool, gym, qrKey);
}

// ─── Staff: check a member in or out by hand ─────────────────────────────────────────────────

async function lockMember(db, gymId, memberId) {
  const [[row]] = await db.query("SELECT id FROM gym_members WHERE id = ? AND gym_id = ? FOR UPDATE", [memberId, gymId]);
  if (!row) throw new NotFoundError("That member isn't at your gym.");
}

async function openVisit(db, memberId, { lock = false } = {}) {
  const [[row]] = await db.query(
    `SELECT id, gym_id, ${ms("checked_in_at")} AS in_ms FROM gym_attendance WHERE member_id = ? AND status = 'inside'${lock ? " FOR UPDATE" : ""}`,
    [memberId],
  );
  return row ?? null;
}

const isDuplicate = (error) => error?.code === "ER_DUP_ENTRY";

// A new open visit; one already open means the member is in (alreadyIn), nothing changes
async function staffCheckIn(pool, gymId, userId, memberId, today) {
  return inTransaction(pool, async (db) => {
    await lockMember(db, gymId, memberId);
    await closeStale(db, "member_id = ?", [memberId], today);
    if (await openVisit(db, memberId)) return { alreadyIn: true };
    try {
      await db.query(
        "INSERT INTO gym_attendance (gym_id, member_id, on_date, status, in_source, created_by) VALUES (?, ?, ?, 'inside', 'staff', ?)",
        [gymId, memberId, today, userId],
      );
    } catch (error) {
      if (isDuplicate(error)) return { alreadyIn: true };
      throw error;
    }
    return { alreadyIn: false };
  });
}

async function staffCheckOut(pool, gymId, userId, memberId) {
  return inTransaction(pool, async (db) => {
    await lockMember(db, gymId, memberId);
    await closeStale(db, "member_id = ?", [memberId]);
    const visit = await openVisit(db, memberId, { lock: true });
    if (!visit) throw new ConflictError("This member isn't checked in.");
    await finishVisit(db, visit.id, { source: "staff", userId });
    return { durationMin: await visitDuration(db, visit.id) };
  });
}

// The check-out itself: the time, how long it lasted (worked out here, never sent) and where
async function finishVisit(db, visitId, { source, userId = null, position = null, distance = null }) {
  await db.query(
    `UPDATE gym_attendance SET status = 'completed', checked_out_at = NOW(), duration_min = LEAST(TIMESTAMPDIFF(MINUTE, checked_in_at, NOW()), 65535),
       out_source = ?, checked_out_by = ?, check_out_lat = ?, check_out_lng = ?, check_out_accuracy_m = ?, check_out_distance_m = ?
     WHERE id = ?`,
    [source, userId, position?.latitude ?? null, position?.longitude ?? null, position ? Math.min(position.accuracy, 65535) : null, distance, visitId],
  );
}

async function visitDuration(db, visitId) {
  const [[row]] = await db.query("SELECT duration_min FROM gym_attendance WHERE id = ?", [visitId]);
  return row.duration_min;
}

// ─── Members: scan the QR code in the justFit app ────────────────────────────────────────────

// The branch the code names, if the code is its current one
async function scannedGym(db, userId, qrKey, qr) {
  const [[gym]] = await db.query(
    `SELECT g.id, g.name AS branch, g.area, g.city, b.name AS brand, g.latitude, g.longitude, g.attendance_radius_m, g.qr_version
     FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?`,
    [qr.gymId],
  );
  if (!gym || !att.qrMatches(qrKey, qr, gym.qr_version)) {
    logSecurityEvent("attendance.bad_qr", { userId, gymId: qr.gymId });
    throw new ForbiddenError(NOT_VALID);
  }
  await gymStatus.refuseSuspended(db, gym.id, "member");
  const place = { name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city };
  return { id: gym.id, place, latitude: gym.latitude, longitude: gym.longitude, radiusM: gym.attendance_radius_m };
}

// Who is scanning (2026-11-09): the branch's Staff and Trainers check in for work (their own
// visits, gym/staffAttendance.js); anyone else is matched to a membership there by phone
async function whoScans(db, userId, qrKey, qr, { lock = false } = {}) {
  const gym = await scannedGym(db, userId, qrKey, qr);
  const link = await staffAttendance.staffLink(db, userId, gym.id, { lock });
  return { gym, link };
}

// The caller's membership at the branch the code names
async function resolveScan(db, userId, qrKey, qr, today, { lock = false, gym: found = null } = {}) {
  const gym = found ?? (await scannedGym(db, userId, qrKey, qr));
  const place = gym.place;
  const account = await getAccount(userId, db);
  if (!account.phone) throw new ForbiddenError(`We couldn't match your account to ${place.name}. Ask the front desk to check the mobile number on your membership.`);
  const [[member]] = await db.query(
    `SELECT id, member_code, full_name, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on, DATE_FORMAT(joined_on, '%Y-%m-%d') AS joined_on
     FROM gym_members WHERE gym_id = ? AND phone = ?${lock ? " FOR UPDATE" : ""}`,
    [gym.id, account.phone],
  );
  if (!member) {
    throw new ForbiddenError(`You aren't a member at ${place.name} ${place.branch} yet, or your membership has a different mobile number. Ask the front desk to add your sign-in number.`);
  }
  // Pause Membership: an approved pause running today keeps the member out until it ends
  const paused = await pauses.currentPause(db, member.id, today);
  return {
    gym,
    member: { id: member.id, code: member.member_code, name: member.full_name, expiresOn: member.expires_on, pausedUntil: paused ? paused.until : null, active: member.expires_on >= today && member.joined_on <= today && !paused },
  };
}

const prettyDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// After scanning, before GPS: which gym, whether the member is in, and so whether this is a check-out
async function scanPreview(pool, userId, qrKey, body, today) {
  const who = await whoScans(pool, userId, qrKey, body.qr);
  if (who.link) return staffAttendance.scanPreview(pool, userId, who.gym, who.link, today);
  const { gym, member } = await resolveScan(pool, userId, qrKey, body.qr, today, { gym: who.gym });
  await closeStale(pool, "member_id = ?", [member.id], today);
  const open = await openVisit(pool, member.id);
  return {
    as: "member",
    gym: gym.place,
    member: { name: member.name, code: member.code, expiresOn: member.expiresOn, active: member.active, pausedUntil: member.pausedUntil },
    radiusM: gym.radiusM,
    hasLocation: gym.latitude !== null,
    openVisit: open ? { checkedInAt: new Date(Number(open.in_ms)).toISOString() } : null,
    nextAction: open ? "check_out" : "check_in",
  };
}

function checkPosition(gym, position, userId, checkingOut) {
  try {
    return att.judgePosition(gym, position, { checkingOut });
  } catch (error) {
    if (position.mocked) logSecurityEvent("attendance.mock_location", { userId, gymId: gym.id });
    throw error;
  }
}

async function memberCheckIn(pool, userId, qrKey, body, today) {
  const who = await whoScans(pool, userId, qrKey, body.qr);
  if (who.link) {
    const distance = checkPosition({ ...who.gym }, body.position, userId, false);
    return inTransaction(pool, async (db) => {
      const again = await whoScans(db, userId, qrKey, body.qr, { lock: true });
      if (!again.link) throw new ForbiddenError("You're no longer on this branch's team. Ask your gym admin.");
      return staffAttendance.scanCheckIn(db, userId, again.gym, again.link, body.position, distance, today);
    });
  }
  const scanned = await resolveScan(pool, userId, qrKey, body.qr, today, { gym: who.gym });
  const distance = checkPosition({ ...scanned.gym }, body.position, userId, false);
  if (!scanned.member.active) {
    if (scanned.member.pausedUntil) throw new ForbiddenError(`Your membership is paused until ${prettyDate(scanned.member.pausedUntil)}. Ask the front desk if you'd like to end the pause early.`);
    throw new ForbiddenError(scanned.member.expiresOn < today
      ? `Your membership ended on ${prettyDate(scanned.member.expiresOn)}. Renew it at the front desk to check in.`
      : "Your membership hasn't started yet. Please check in at the front desk.");
  }
  return inTransaction(pool, async (db) => {
    const { gym, member } = await resolveScan(db, userId, qrKey, body.qr, today, { lock: true });
    await closeStale(db, "member_id = ?", [member.id], today);
    const open = await openVisit(db, member.id);
    const already = () => new ConflictError("You're already checked in. Scan the same QR code when you leave to check out.");
    if (open) throw already();
    const p = body.position;
    try {
      await db.query(
        `INSERT INTO gym_attendance (gym_id, member_id, on_date, status, in_source, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m)
         VALUES (?, ?, ?, 'inside', 'qr', ?, ?, ?, ?)`,
        [gym.id, member.id, today, p.latitude, p.longitude, Math.min(p.accuracy, 65535), distance],
      );
    } catch (error) {
      if (isDuplicate(error)) throw already();
      throw error;
    }
    const visit = await openVisit(db, member.id);
    return { as: "member", action: "check_in", gym: gym.place, member: { name: member.name, code: member.code }, checkedInAt: new Date(Number(visit.in_ms)).toISOString(), distanceM: distance };
  });
}

async function memberCheckOut(pool, userId, qrKey, body, today) {
  const who = await whoScans(pool, userId, qrKey, body.qr);
  if (who.link) {
    const distance = checkPosition({ ...who.gym }, body.position, userId, true);
    return inTransaction(pool, async (db) => {
      const again = await whoScans(db, userId, qrKey, body.qr, { lock: true });
      if (!again.link) throw new ForbiddenError("You're no longer on this branch's team. Ask your gym admin.");
      return staffAttendance.scanCheckOut(db, userId, again.gym, again.link, body.position, distance, today);
    });
  }
  const scanned = await resolveScan(pool, userId, qrKey, body.qr, today, { gym: who.gym });
  const distance = checkPosition({ ...scanned.gym }, body.position, userId, true);
  return inTransaction(pool, async (db) => {
    const { gym, member } = await resolveScan(db, userId, qrKey, body.qr, today, { lock: true });
    await closeStale(db, "member_id = ?", [member.id], today);
    const visit = await openVisit(db, member.id, { lock: true });
    if (!visit || visit.gym_id !== gym.id) throw new ConflictError("You haven't checked in here yet. Scan the QR code to check in first.");
    if (Date.now() - Number(visit.in_ms) < att.MIN_VISIT_MS) throw new ConflictError("You checked in less than a minute ago. Scan again when you leave.");
    await finishVisit(db, visit.id, { source: "qr", position: body.position, distance });
    const [[done]] = await db.query(`SELECT ${ms("checked_in_at")} AS in_ms, ${ms("checked_out_at")} AS out_ms, duration_min FROM gym_attendance WHERE id = ?`, [visit.id]);
    return {
      as: "member",
      action: "check_out",
      gym: gym.place,
      member: { name: member.name, code: member.code },
      checkedInAt: new Date(Number(done.in_ms)).toISOString(),
      checkedOutAt: new Date(Number(done.out_ms)).toISOString(),
      durationMin: done.duration_min,
      distanceM: distance,
    };
  });
}

// The member's own recent visits, at every branch that has their number
async function myVisits(pool, userId) {
  const account = await getAccount(userId, pool);
  // A Staff or Trainer's own days at work come first in time order with their gym visits
  const work = await staffAttendance.myVisits(pool, userId);
  const [rows] = !account.phone ? [[]] : await pool.query(
    `SELECT a.id, a.status, ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, a.duration_min, a.on_date < ? AS stale,
       b.name AS brand, g.name AS branch
     FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id JOIN gyms g ON g.id = a.gym_id JOIN gym_brands b ON b.id = g.brand_id
     WHERE m.phone = ? ORDER BY a.checked_in_at DESC, a.id DESC LIMIT 20`,
    [rules.todayInIndia(), account.phone],
  );
  const visits = [...rows.map((r) => ({ ...r, as: "member" })), ...work.map((r) => ({ ...r, as: "staff" }))]
    .sort((a, b) => Number(b.in_ms) - Number(a.in_ms))
    .slice(0, 20);
  return {
    visits: visits.map((r) => ({
      // Two tables, so the id carries which one ("s12" for a day at work)
      id: r.as === "staff" ? `s${r.id}` : String(r.id),
      as: r.as,
      gym: `${r.brand} ${r.branch}`,
      status: r.status === "inside" && r.stale ? "no_checkout" : r.status,
      checkedInAt: new Date(Number(r.in_ms)).toISOString(),
      checkedOutAt: r.out_ms ? new Date(Number(r.out_ms)).toISOString() : null,
      durationMin: r.duration_min,
    })),
  };
}

// ─── The dashboard, history and export ───────────────────────────────────────────────────────

const VISIT_COLUMNS = `a.id, a.member_id, m.member_code, m.full_name, m.photo_key, DATE_FORMAT(a.on_date, '%Y-%m-%d') AS on_date,
  ${ms("a.checked_in_at")} AS in_ms, ${ms("a.checked_out_at")} AS out_ms, a.duration_min, a.status, a.in_source, a.out_source, a.check_in_distance_m,
  TIMESTAMPDIFF(MINUTE, a.checked_in_at, NOW()) AS minutes_so_far`;

const visitOf = (r) => ({
  id: r.id,
  memberId: r.member_id,
  memberCode: r.member_code,
  memberName: r.full_name,
  photoUrl: r.photo_key ? `/api/gym/members/${r.member_id}/photo?v=${r.photo_key.slice(0, 8)}` : null,
  date: r.on_date,
  checkedInAt: new Date(Number(r.in_ms)).toISOString(),
  checkedOutAt: r.out_ms ? new Date(Number(r.out_ms)).toISOString() : null,
  durationMin: r.status === "inside" ? r.minutes_so_far : r.duration_min,
  status: r.status,
  inSource: r.in_source,
  outSource: r.out_source ?? null,
  checkInDistanceM: r.check_in_distance_m ?? null,
});

const escapeLike = (text) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function historyWhere(gymId, q) {
  let where = "a.gym_id = ? AND a.on_date BETWEEN ? AND ?";
  const params = [gymId, q.from, q.to];
  if (q.status !== "all") { where += " AND a.status = ?"; params.push(q.status); }
  if (q.memberId) { where += " AND a.member_id = ?"; params.push(q.memberId); }
  if (q.search) { where += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)"; params.push(escapeLike(q.search), escapeLike(q.search)); }
  return { where, params };
}

async function history(pool, gymId, q) {
  await closeStale(pool, "gym_id = ?", [gymId]);
  const { where, params } = historyWhere(gymId, q);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT ${VISIT_COLUMNS} FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id WHERE ${where} ORDER BY a.checked_in_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, att.PAGE_SIZE, (q.page - 1) * att.PAGE_SIZE],
  );
  return { visits: rows.map(visitOf), total, page: q.page, pageSize: att.PAGE_SIZE, from: q.from, to: q.to };
}

// Visits, distinct members and the average finished visit, for one date range
async function periodStats(pool, gymId, from, to) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS visits, COUNT(DISTINCT member_id) AS members, SUM(status = 'completed') AS completed,
       ROUND(AVG(CASE WHEN status = 'completed' THEN duration_min END)) AS avg_min
     FROM gym_attendance WHERE gym_id = ? AND on_date BETWEEN ? AND ?`,
    [gymId, from, to],
  );
  return { visits: row.visits, members: row.members, completed: Number(row.completed ?? 0), avgMinutes: row.avg_min === null ? null : Number(row.avg_min) };
}

async function summary(pool, gym, today) {
  await closeStale(pool, "gym_id = ?", [gym.id], today);
  // Every read of the dashboard at once (2026-11-07): who is inside, the charts' rows, the setup
  // flags, and the stats for today, the last 7 days and the last 30 days
  const [[inside], [days], [todayRows], [[place]], statsToday, statsWeek, statsMonth] = await Promise.all([
    pool.query(
      `SELECT ${VISIT_COLUMNS} FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id WHERE a.gym_id = ? AND a.status = 'inside' ORDER BY a.checked_in_at DESC LIMIT 200`,
      [gym.id],
    ),
    // The charts: today's check-ins by hour, and visits per day over the last 30 days
    pool.query(
      "SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS day, COUNT(*) AS visits FROM gym_attendance WHERE gym_id = ? AND on_date BETWEEN ? AND ? GROUP BY on_date",
      [gym.id, rules.addDays(today, -29), today],
    ),
    pool.query(`SELECT ${ms("checked_in_at")} AS in_ms FROM gym_attendance WHERE gym_id = ? AND on_date = ?`, [gym.id, today]),
    pool.query("SELECT latitude IS NOT NULL AS has_location, qr_version > 0 AS has_qr FROM gyms WHERE id = ?", [gym.id]),
    periodStats(pool, gym.id, today, today),
    periodStats(pool, gym.id, rules.addDays(today, -6), today),
    periodStats(pool, gym.id, rules.addDays(today, -29), today),
  ]);
  const byDay = new Map(days.map((d) => [d.day, d.visits]));
  const charts = {
    today: att.chartHours(todayRows.map((r) => r.in_ms)),
    week: att.chartDays(byDay, today, 7, rules.addDays),
    month: att.chartDays(byDay, today, 30, rules.addDays),
  };
  return {
    gym: gymInfo(gym),
    today,
    setup: { location: Boolean(place.has_location), qr: Boolean(place.has_qr) },
    insideNow: inside.length,
    inside: inside.map(visitOf),
    // Today, the last 7 days and the last 30 days (the month was the calendar month until 2026-11-07)
    stats: { today: statsToday, week: statsWeek, month: statsMonth },
    charts,
    lastSevenDays: charts.week,
  };
}

// The report: the filtered visits as a CSV or (format "xlsx") an Excel file
async function exportReport(pool, gymId, q, format = "csv") {
  const visits = await exportVisits(pool, gymId, q);
  return format === "xlsx" ? xlsx.workbook(att.toSheet(visits)) : att.toCsv(visits);
}

async function exportVisits(pool, gymId, q) {
  await closeStale(pool, "gym_id = ?", [gymId]);
  const { where, params } = historyWhere(gymId, q);
  const [rows] = await pool.query(
    `SELECT ${VISIT_COLUMNS} FROM gym_attendance a JOIN gym_members m ON m.id = a.member_id WHERE ${where} ORDER BY a.checked_in_at, a.id LIMIT ?`,
    [...params, att.EXPORT_MAX_ROWS],
  );
  return rows.map((r) => {
    const v = visitOf(r);
    return { ...v, checkInTime: istStamp(r.in_ms), checkOutTime: istStamp(r.out_ms), durationMin: v.status === "inside" ? null : v.durationMin };
  });
}

module.exports = {
  settings,
  saveLocation,
  regenerateQr,
  staffCheckIn,
  staffCheckOut,
  scanPreview,
  memberCheckIn,
  memberCheckOut,
  myVisits,
  history,
  summary,
  exportReport,
  closeOpenVisits,
  startMidnightClose,
  istStamp,
};
