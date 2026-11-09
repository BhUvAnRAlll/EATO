// Live gym crowd and best time to visit (Gym Hub ecosystem, 2026-11-09): reads a branch's visits and
// works out the live estimate and the forecast with gym/crowdRules.js. Members reach it from their
// own membership (matched by the account's verified phone, gym/pauses.js oneMembership), the gym's
// portal for its open branch. Every query is scoped to one branch; no member is named and nothing is
// stored. The gym admin's settings (capacity, usual workout, levels) are the only writes, migration
// 2026-12-29; before it, the crowd works with the defaults and saving answers 503.
const { audit } = require("../admin/overview");
const rules = require("./crowdRules");
const profileRules = require("./profileRules");
const pauses = require("./pauses");
const { addDays } = require("./rules");

const ms = (column) => `CAST(UNIX_TIMESTAMP(${column}) * 1000 AS UNSIGNED)`;
const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;

// The branch's crowd settings and opening hours; the defaults before the migration
async function settingsRow(pool, gymId) {
  try {
    const [[row]] = await pool.query("SELECT capacity, avg_stay_min, crowd_thresholds, opening_hours FROM gyms WHERE id = ?", [gymId]);
    return row ?? {};
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
    const [[row]] = await pool.query("SELECT opening_hours FROM gyms WHERE id = ?", [gymId]);
    return { ...(row ?? {}), capacity: null, avg_stay_min: null, crowd_thresholds: null, missingMigration: true };
  }
}

/** The live estimate and the forecast for one branch */
async function crowdFor(pool, gymId, today, now = Date.now()) {
  const since = addDays(today, -rules.CROWD.historyDays);
  const [row, [open], [durations], [history], [[first]]] = await Promise.all([
    settingsRow(pool, gymId),
    pool.query(`SELECT ${ms("checked_in_at")} AS in_ms FROM gym_attendance WHERE gym_id = ? AND status = 'inside' AND on_date = ?`, [gymId, today]),
    pool.query("SELECT duration_min FROM gym_attendance WHERE gym_id = ? AND status = 'completed' AND on_date >= ? AND duration_min IS NOT NULL", [gymId, addDays(today, -30)]),
    pool.query(
      `SELECT ${DAY("on_date")} AS day, ${ms("checked_in_at")} AS in_ms, CASE WHEN status = 'completed' THEN ${ms("checked_out_at")} END AS out_ms
       FROM gym_attendance WHERE gym_id = ? AND on_date >= ? AND on_date < ?`,
      [gymId, since, today],
    ),
    pool.query(`SELECT ${DAY("MIN(on_date)")} AS first_day FROM gym_attendance WHERE gym_id = ?`, [gymId]),
  ]);
  const settings = rules.settingsOf(row);
  const stay = rules.usualStay(settings.avgStayMin, durations.map((d) => Number(d.duration_min)));
  const hours = profileRules.readHours(row.opening_hours);
  return {
    settings,
    stay,
    live: rules.live({ now, openVisits: open.map((v) => ({ inMs: Number(v.in_ms) })), settings, stay, hasAnyAttendance: Boolean(first.first_day) }),
    forecast: rules.forecast({
      now, today, stayMin: stay.minutes, firstRecordedDay: first.first_day, settings, hours,
      visits: history.map((v) => ({ day: v.day, inMs: Number(v.in_ms), outMs: v.out_ms === null ? null : Number(v.out_ms) })),
    }),
  };
}

/** GET /api/membership/:memberId/crowd: the crowd at the member's own gym */
async function forMember(pool, userId, memberId, today) {
  const { row } = await pauses.oneMembership(pool, userId, memberId, today);
  const crowd = await crowdFor(pool, row.gym_id, today);
  // Members see the levels and the numbers, not the gym's settings
  return { gym: { name: row.brand ?? null, branch: row.branch ?? null }, capacity: crowd.settings.capacity, live: crowd.live, forecast: crowd.forecast };
}

/** GET /api/gym/attendance/crowd: the open branch's crowd with its settings */
async function forGym(pool, gym, today) {
  return crowdFor(pool, gym.id, today);
}

/** PUT /api/gym/attendance/crowd-settings: saves what changed and answers with the crowd */
async function saveSettings(pool, gym, userId, fields, today) {
  const sets = [];
  const params = [];
  if (fields.capacity !== undefined) { sets.push("capacity = ?"); params.push(fields.capacity); }
  if (fields.avgStayMin !== undefined) { sets.push("avg_stay_min = ?"); params.push(fields.avgStayMin); }
  if (fields.thresholds !== undefined) { sets.push("crowd_thresholds = ?"); params.push(fields.thresholds === null ? null : JSON.stringify(fields.thresholds)); }
  await pool.query(`UPDATE gyms SET ${sets.join(", ")} WHERE id = ?`, [...params, gym.id]);
  await audit(pool, userId, "gym.edit", "gym", gym.id, `Changed the crowd settings of ${gym.brand}’s ${gym.branch} branch`);
  return crowdFor(pool, gym.id, today);
}

module.exports = { crowdFor, forMember, forGym, saveSettings };
