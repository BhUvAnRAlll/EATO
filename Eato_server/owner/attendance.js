// QR attendance at the front desk. The member shows a short-lived pass (passes.js); the gym's
// owner or an admin scans it, sees who it is and whether they may come in, and checks them in.
// Members check out by scanning the gym's check-out QR, or staff end the visit. Every scan that
// doesn't check someone in is recorded with its reason.
//
// Staff routes go through ownerAccess (the gym's active owner or admins, or an EATO admin).
// Member routes act only on the verified caller's own visits. One open visit per member per gym
// is enforced by the database (gym_visits.open_member), so a double tap can't check anyone in twice.
const { ValidationError } = require("../profile");
const { memberSummary } = require("../community/members");
const { NotFoundError } = require("../community/posts");
const { mediaUrl } = require("../community/media");
const { ownerAccess } = require("./owner");
const passes = require("./passes");
const rules = require("./rules");

let key = null;
const passKey = () => (key ??= passes.deriveKey(process.env.CLERK_SECRET_KEY));

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};

async function inTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const iso = (value) => (value ? new Date(value).toISOString() : null);
const minutesBetween = (from, to) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));

// ---- the member's pass ------------------------------------------------------------------

function myPass(userId) {
  return passes.issuePass(passKey(), userId);
}

// ---- verifying a scan -------------------------------------------------------------------

async function latestPlan(db, gymId, userId) {
  const [[plan]] = await db.query(
    `SELECT plan_name, status, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on, DATEDIFF(ends_on, CURDATE()) AS days_left
     FROM gym_member_plans WHERE gym_id = ? AND user_id = ? AND status <> 'cancelled'
     ORDER BY ends_on IS NULL DESC, ends_on DESC, created_at DESC LIMIT 1`,
    [gymId, userId],
  );
  return plan ? { name: plan.plan_name, status: plan.status, endsOn: plan.ends_on, daysLeft: plan.days_left === null ? null : Number(plan.days_left) } : null;
}

// Everything the verification screen shows about the person a pass names (only for real members
// of this gym, pending and suspended ones included, so the desk sees why they're refused)
async function lookUp(db, gym, userId) {
  const [[row]] = await db.query(
    `SELECT u.id AS user_id, u.full_name, m.role, m.status, m.joined_at FROM users u
     LEFT JOIN gym_members m ON m.user_id = u.id AND m.gym_id = ? WHERE u.id = ?`,
    [gym.id, userId],
  );
  if (!row) return { membership: null, person: null, plan: null, openVisit: false };
  const membership = row.role ? { role: row.role, status: row.status } : null;
  const plan = membership ? await latestPlan(db, gym.id, userId) : null;
  const [[open]] = await db.query("SELECT id FROM gym_visits WHERE gym_id = ? AND user_id = ? AND checked_out_at IS NULL", [gym.id, userId]);
  return { membership, person: membership ? memberSummary(row) : null, plan, openVisit: Boolean(open), joinedAt: iso(row.joined_at) };
}

async function recordFailure(db, gymId, staffId, userId, reason) {
  await db.query("INSERT INTO gym_scan_failures (gym_id, scanned_by, user_id, reason) VALUES (?, ?, ?, ?)", [gymId, staffId, userId, reason]);
}

function validateScan(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Scan a member's QR code.");
  const extra = Object.keys(body).filter((k) => k !== "code");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  if (typeof body.code !== "string" || body.code.trim() === "") throw new ValidationError("Scan a member's QR code.");
  return { code: body.code.slice(0, 300) };
}

// The verification screen: who the code names and whether they may check in. A refused scan is
// recorded (once, here); the check-in that follows an eligible scan re-checks everything.
async function verify(pool, staffId, gymId, { code }) {
  const { gym } = await ownerAccess(pool, gymId, staffId);
  const read = passes.readPass(passKey(), code);
  if (!read.ok) {
    await recordFailure(pool, gymId, staffId, null, read.reason);
    return { eligible: false, reason: read.reason, message: rules.refusalMessages[read.reason], member: null, gym: { id: gym.id, name: gym.name } };
  }
  const found = await lookUp(pool, gym, read.userId);
  const reason = rules.checkinRefusal(found);
  if (reason) await recordFailure(pool, gymId, staffId, found.person ? read.userId : null, reason);
  const plan = found.plan;
  return {
    eligible: reason === null,
    reason,
    message: reason ? rules.refusalMessages[reason] : null,
    gym: { id: gym.id, name: gym.name },
    // Someone who isn't a member here stays anonymous to this gym
    member: found.person
      ? { member: found.person, role: found.membership.role, status: found.membership.status, plan, joinedAt: found.joinedAt }
      : null,
    renewalWarning: reason === null && plan !== null && plan.daysLeft !== null && plan.daysLeft <= 7,
  };
}

// Checks the member in. Re-reads the pass and re-checks eligibility inside one transaction; the
// unique open-visit key turns a racing second check-in into "Already checked in".
async function checkIn(pool, staffId, gymId, { code }) {
  const outcome = await inTransaction(pool, async (connection) => {
    const { gym } = await ownerAccess(connection, gymId, staffId);
    const read = passes.readPass(passKey(), code);
    if (!read.ok) return { refused: read.reason, userId: null };
    await connection.query("SELECT user_id FROM gym_members WHERE gym_id = ? AND user_id = ? FOR UPDATE", [gymId, read.userId]);
    const found = await lookUp(connection, gym, read.userId);
    const reason = rules.checkinRefusal(found);
    if (reason) return { refused: reason, userId: found.person ? read.userId : null };
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    try {
      await connection.query("INSERT INTO gym_visits (id, gym_id, user_id, checked_in_by) VALUES (?, ?, ?, ?)", [id, gymId, read.userId, staffId]);
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") return { refused: "already_in", userId: read.userId };
      throw error;
    }
    return { visitId: id };
  });
  if (outcome.refused) {
    await recordFailure(pool, gymId, staffId, outcome.userId, outcome.refused);
    throw conflict(rules.refusalMessages[outcome.refused]);
  }
  return { visit: await visitById(pool, gymId, outcome.visitId) };
}

// ---- visits -----------------------------------------------------------------------------

const VISIT_SELECT = `SELECT v.id, v.user_id, v.checked_in_at, v.checked_out_at, v.checkout_method, u.full_name,
  si.full_name AS in_by_name, so.full_name AS out_by_name
  FROM gym_visits v JOIN users u ON u.id = v.user_id
  LEFT JOIN users si ON si.id = v.checked_in_by LEFT JOIN users so ON so.id = v.checked_out_by`;

function visitToApi(row, now = new Date()) {
  return {
    id: row.id,
    member: memberSummary(row),
    checkedInAt: iso(row.checked_in_at),
    checkedOutAt: iso(row.checked_out_at),
    minutes: minutesBetween(row.checked_in_at, row.checked_out_at ?? now),
    checkoutMethod: row.checkout_method,
    checkedInBy: row.in_by_name ?? null,
    checkedOutBy: row.out_by_name ?? null,
  };
}

async function visitById(db, gymId, visitId) {
  const [[row]] = await db.query(`${VISIT_SELECT} WHERE v.gym_id = ? AND v.id = ?`, [gymId, visitId]);
  if (!row) throw new NotFoundError("That visit doesn't exist.");
  return visitToApi(row);
}

const failureToApi = (row) => ({ reason: row.reason, member: row.user_id ? memberSummary(row) : null, at: iso(row.created_at) });

// The Check-in tab: counts, who is in now, who finished today, and today's activity
async function today(pool, staffId, gymId) {
  const { gym } = await ownerAccess(pool, gymId, staffId);
  const [inNow] = await pool.query(`${VISIT_SELECT} WHERE v.gym_id = ? AND v.checked_out_at IS NULL ORDER BY v.checked_in_at DESC LIMIT 200`, [gymId]);
  const [done] = await pool.query(
    `${VISIT_SELECT} WHERE v.gym_id = ? AND v.checked_out_at >= CURDATE() ORDER BY v.checked_out_at DESC LIMIT 200`,
    [gymId],
  );
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM gym_visits WHERE gym_id = ? AND checked_in_at >= CURDATE()) AS checkins,
            (SELECT COUNT(*) FROM gym_scan_failures WHERE gym_id = ? AND created_at >= CURDATE()) AS failures`,
    [gymId, gymId],
  );
  const [failures] = await pool.query(
    `SELECT f.reason, f.user_id, f.created_at, u.full_name FROM gym_scan_failures f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.gym_id = ? AND f.created_at >= CURDATE() ORDER BY f.created_at DESC LIMIT 30`,
    [gymId],
  );
  const [todaysVisits] = await pool.query(
    `${VISIT_SELECT} WHERE v.gym_id = ? AND (v.checked_in_at >= CURDATE() OR v.checked_out_at >= CURDATE()) ORDER BY v.checked_in_at DESC LIMIT 100`,
    [gymId],
  );
  const now = new Date();
  // Recent activity: check-ins, check-outs and failed scans, newest first
  const activity = [];
  for (const row of todaysVisits) {
    const visit = visitToApi(row, now);
    if (new Date(row.checked_in_at) >= startOfToday(now)) activity.push({ kind: "in", member: visit.member, at: visit.checkedInAt, visitId: visit.id });
    if (row.checked_out_at) activity.push({ kind: "out", member: visit.member, at: visit.checkedOutAt, minutes: visit.minutes, visitId: visit.id });
  }
  for (const row of failures) activity.push({ kind: "failed", ...failureToApi(row) });
  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    gym: { id: gym.id, name: gym.name },
    counts: { inNow: inNow.length, checkinsToday: Number(counts.checkins), completedToday: done.length, failedToday: Number(counts.failures) },
    inNow: inNow.map((row) => visitToApi(row, now)),
    completedToday: done.map((row) => visitToApi(row, now)),
    activity: activity.slice(0, 30),
  };
}

// The server's "today" in its own clock (CURDATE() above uses the same one)
function startOfToday(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const VISIT_FILTERS = ["all", "in", "out"];

// Today's list: every visit that started or ended today (plus anyone still in), by name
async function listVisits(pool, staffId, gymId, { filter = "all", search = null }) {
  await ownerAccess(pool, gymId, staffId);
  if (!VISIT_FILTERS.includes(filter)) throw new ValidationError("Filter by all, in or out.");
  const where = ["v.gym_id = ?", "(v.checked_in_at >= CURDATE() OR v.checked_out_at >= CURDATE() OR v.checked_out_at IS NULL)"];
  const params = [gymId];
  if (filter === "in") where.push("v.checked_out_at IS NULL");
  if (filter === "out") where.push("v.checked_out_at IS NOT NULL");
  if (search) {
    where.push("u.full_name LIKE ?");
    params.push(`%${search}%`);
  }
  const [rows] = await pool.query(`${VISIT_SELECT} WHERE ${where.join(" AND ")} ORDER BY v.checked_in_at DESC LIMIT 300`, params);
  return { visits: rows.map((row) => visitToApi(row)) };
}

async function getVisit(pool, staffId, gymId, visitId) {
  await ownerAccess(pool, gymId, staffId);
  return { visit: await visitById(pool, gymId, visitId) };
}

// Staff end a visit (the member left without scanning out)
async function staffCheckout(pool, staffId, gymId, visitId) {
  await ownerAccess(pool, gymId, staffId);
  const [result] = await pool.query(
    "UPDATE gym_visits SET checked_out_at = NOW(), checkout_method = 'staff', checked_out_by = ? WHERE gym_id = ? AND id = ? AND checked_out_at IS NULL",
    [staffId, gymId, visitId],
  );
  if (result.affectedRows === 0) {
    await visitById(pool, gymId, visitId); // 404 when it doesn't exist
    throw conflict("This visit has already ended.");
  }
  return { visit: await visitById(pool, gymId, visitId) };
}

// ---- the gym's check-out QR -------------------------------------------------------------

async function checkoutQr(pool, staffId, gymId) {
  const { gym } = await ownerAccess(pool, gymId, staffId);
  let [[row]] = await pool.query("SELECT checkout_qr_enabled, checkout_code, logo_media_id FROM gyms WHERE id = ?", [gymId]);
  if (!row.checkout_code) {
    await pool.query("UPDATE gyms SET checkout_code = ? WHERE id = ? AND checkout_code IS NULL", [passes.newCheckoutCode(), gymId]);
    [[row]] = await pool.query("SELECT checkout_qr_enabled, checkout_code, logo_media_id FROM gyms WHERE id = ?", [gymId]);
  }
  const [[{ checkouts }]] = await pool.query(
    "SELECT COUNT(*) AS checkouts FROM gym_visits WHERE gym_id = ? AND checkout_method = 'qr' AND checked_out_at >= CURDATE()",
    [gymId],
  );
  return {
    gym: { id: gym.id, name: gym.name, logoUrl: mediaUrl(row.logo_media_id) },
    enabled: Boolean(row.checkout_qr_enabled),
    code: row.checkout_code,
    qrText: passes.checkoutQrText(row.checkout_code),
    checkoutsToday: Number(checkouts),
  };
}

function validateCheckoutQr(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Say whether the check-out QR is on.");
  const extra = Object.keys(body).filter((k) => k !== "enabled");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  if (typeof body.enabled !== "boolean") throw new ValidationError("Say whether the check-out QR is on.");
  return { enabled: body.enabled };
}

async function setCheckoutQr(pool, staffId, gymId, { enabled }) {
  await ownerAccess(pool, gymId, staffId);
  await pool.query("UPDATE gyms SET checkout_qr_enabled = ? WHERE id = ?", [enabled, gymId]);
  return checkoutQr(pool, staffId, gymId);
}

// A new code: the old printed QR stops working
async function rotateCheckoutQr(pool, staffId, gymId) {
  await ownerAccess(pool, gymId, staffId);
  await pool.query("UPDATE gyms SET checkout_code = ? WHERE id = ?", [passes.newCheckoutCode(), gymId]);
  return checkoutQr(pool, staffId, gymId);
}

// ---- the member's side ------------------------------------------------------------------

// The caller's open visit, if any (the active session card on Home)
async function myVisit(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT v.id, v.checked_in_at, g.id AS gym_id, g.name AS gym_name FROM gym_visits v JOIN gyms g ON g.id = v.gym_id
     WHERE v.user_id = ? AND v.checked_out_at IS NULL ORDER BY v.checked_in_at DESC LIMIT 1`,
    [userId],
  );
  if (!row) return { visit: null };
  return { visit: { id: row.id, gym: { id: row.gym_id, name: row.gym_name }, checkedInAt: iso(row.checked_in_at), minutes: minutesBetween(row.checked_in_at, new Date()) } };
}

function validateCheckoutScan(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Scan the gym's check-out QR.");
  const extra = Object.keys(body).filter((k) => k !== "code");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  const code = passes.readCheckoutQr(body.code);
  if (!code) throw new ValidationError("That isn't a gym check-out code.");
  return { code };
}

// The member scanned a gym's check-out QR: ends their own open visit at that gym
async function memberCheckout(pool, userId, { code }) {
  const [[gym]] = await pool.query("SELECT id, name, checkout_qr_enabled FROM gyms WHERE checkout_code = ?", [code]);
  if (!gym) throw new ValidationError("That isn't a gym check-out code.");
  if (!gym.checkout_qr_enabled) throw conflict(`Check-out by QR is switched off at ${gym.name}. Ask the front desk.`);
  const [result] = await pool.query(
    "UPDATE gym_visits SET checked_out_at = NOW(), checkout_method = 'qr' WHERE gym_id = ? AND user_id = ? AND checked_out_at IS NULL",
    [gym.id, userId],
  );
  if (result.affectedRows === 0) throw conflict(`You're not checked in at ${gym.name}.`);
  const [[row]] = await pool.query(
    "SELECT checked_in_at, checked_out_at FROM gym_visits WHERE gym_id = ? AND user_id = ? ORDER BY checked_out_at DESC LIMIT 1",
    [gym.id, userId],
  );
  return { gym: { id: gym.id, name: gym.name }, checkedOutAt: iso(row.checked_out_at), minutes: minutesBetween(row.checked_in_at, row.checked_out_at) };
}

module.exports = {
  myPass, validateScan, verify, checkIn, today, listVisits, getVisit, staffCheckout, VISIT_FILTERS,
  checkoutQr, validateCheckoutQr, setCheckoutQr, rotateCheckoutQr, myVisit, validateCheckoutScan, memberCheckout,
};
