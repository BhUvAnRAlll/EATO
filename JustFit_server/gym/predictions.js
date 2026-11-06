// Gym predictions, the data part: reads what the branch already keeps and hands it to the pure
// rules (predictionRules.js). Nothing is stored and nothing is sent: a list is worked out when
// it is asked for, from gym_members and gym_attendance, for the caller's branch only.
const service = require("./service");
const rules = require("./predictionRules");
const { addDays } = require("./rules");

// The branch's members with their visit facts: the last visit, distinct visit days in the last
// 30 days and in the 30 before. Members whose plan ended more than a week ago are left out.
async function memberFacts(pool, gymId, search, today) {
  const w = rules.renewalWindows(today);
  const found = service.memberSearch(search);
  const [rows] = await pool.query(
    `SELECT ${service.MEMBER_COLUMNS},
       (SELECT ${service.DAY("MAX(a.on_date)")} FROM gym_attendance a WHERE a.member_id = m.id) AS last_visit,
       (SELECT COUNT(DISTINCT a.on_date) FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date BETWEEN ? AND ?) AS visits_last,
       (SELECT COUNT(DISTINCT a.on_date) FROM gym_attendance a WHERE a.member_id = m.id AND a.on_date BETWEEN ? AND ?) AS visits_prior
     FROM gym_members m
     WHERE m.gym_id = ? AND m.expires_on >= ?${found.sql}
     ORDER BY m.full_name, m.id LIMIT ?`,
    [today, w.lastFrom, today, w.priorFrom, w.priorTo, gymId, w.scoredFrom, ...found.params, service.MEMBER_LIST_LIMIT],
  );
  return rows;
}

const scored = (row, today) => ({
  ...service.memberOf(row, today),
  risk: {
    ...rules.renewalRisk({ today, expiresOn: row.expires_on, joinedOn: row.joined_on, lastVisit: row.last_visit, visitsLast: row.visits_last, visitsPrior: row.visits_prior, dueAmount: row.due_amount, ptUntil: row.pt_until }),
    lastVisit: row.last_visit,
    visitsLast: Number(row.visits_last),
    visitsPrior: Number(row.visits_prior),
  },
});

// GET /api/gym/predictions/renewals: Medium and High (or one level), highest score first
async function renewalRisks(pool, gym, { level, search }, today) {
  const all = (await memberFacts(pool, gym.id, search, today)).map((row) => scored(row, today));
  const counts = { high: all.filter((m) => m.risk.level === "high").length, medium: all.filter((m) => m.risk.level === "medium").length };
  const members = all.filter((m) => rules.showsLevel(level, m.risk.level)).sort((a, b) => b.risk.score - a.risk.score || a.name.localeCompare(b.name));
  return { gym: service.gymInfo(gym), today, calculatedAt: new Date().toISOString(), counts, members };
}

// Home's "Likely to leave" count: the branch's High-risk members
async function highRiskCount(pool, gymId, today) {
  const rows = await memberFacts(pool, gymId, "", today);
  return rows.filter((row) => scored(row, today).risk.level === "high").length;
}

// GET /api/gym/predictions/busy-hours: tomorrow's expected check-ins per hour (rules.busyHours)
async function busyHours(pool, gym, today) {
  const { dates } = rules.busyDates(today);
  const [[first]] = await pool.query(`SELECT ${service.DAY("MIN(on_date)")} AS first_day FROM gym_attendance WHERE gym_id = ?`, [gym.id]);
  const [rows] = await pool.query(
    `SELECT ${service.DAY("on_date")} AS day, member_id, CAST(UNIX_TIMESTAMP(checked_in_at) * 1000 AS UNSIGNED) AS in_ms
     FROM gym_attendance WHERE gym_id = ? AND on_date IN (?)`,
    [gym.id, dates],
  );
  const forecast = rules.busyHours({ today, rows: rows.map((r) => ({ day: r.day, memberId: r.member_id, inMs: Number(r.in_ms) })), firstRecordedDay: first.first_day });
  return { gym: service.gymInfo(gym), today, calculatedAt: new Date().toISOString(), ...forecast };
}

// GET /api/gym/predictions/revenue: expected takings by month end (rules.revenueForecast)
async function revenue(pool, gym, today) {
  const { from, to } = rules.monthRange(today);
  const lastMonthFrom = rules.monthRange(addDays(from, -1)).from;
  const since = addDays(today, -rules.REVENUE.historyDays);
  const sum = async (sql, params) => Number((await pool.query(sql, params))[0][0].total);
  const collected = await sum("SELECT COALESCE(SUM(amount), 0) AS total FROM gym_payments WHERE gym_id = ? AND paid_on BETWEEN ? AND ?", [gym.id, from, today]);
  const lastMonthTotal = await sum("SELECT COALESCE(SUM(amount), 0) AS total FROM gym_payments WHERE gym_id = ? AND paid_on BETWEEN ? AND ?", [gym.id, lastMonthFrom, addDays(from, -1)]);
  // Plans ending between today and month end, each with the member's last plan payment
  const [expiring] = await pool.query(
    `SELECT m.id, (SELECT p.amount FROM gym_payments p WHERE p.member_id = m.id AND p.kind IN ('admission', 'renewal') ORDER BY p.paid_on DESC, p.id DESC LIMIT 1) AS price
     FROM gym_members m WHERE m.gym_id = ? AND m.expires_on BETWEEN ? AND ?`,
    [gym.id, today, to],
  );
  const renewed = await sum("SELECT COUNT(DISTINCT member_id) AS total FROM gym_payments WHERE gym_id = ? AND kind = 'renewal' AND paid_on BETWEEN ? AND ?", [gym.id, since, today]);
  const lapsed = await sum("SELECT COUNT(*) AS total FROM gym_members WHERE gym_id = ? AND expires_on BETWEEN ? AND ?", [gym.id, since, addDays(today, -1)]);
  const duesOutstanding = await sum("SELECT COALESCE(SUM(due_amount), 0) AS total FROM gym_members WHERE gym_id = ? AND due_amount > 0 AND (due_by IS NULL OR due_by <= ?)", [gym.id, to]);
  const duePaid = await sum("SELECT COALESCE(SUM(amount), 0) AS total FROM gym_payments WHERE gym_id = ? AND kind = 'due' AND paid_on BETWEEN ? AND ?", [gym.id, since, today]);
  const dueOverdue = await sum("SELECT COALESCE(SUM(due_amount), 0) AS total FROM gym_members WHERE gym_id = ? AND due_amount > 0 AND due_by < ?", [gym.id, today]);
  const forecast = rules.revenueForecast({ today, collected, expiring: expiring.map((m) => ({ price: m.price === null ? null : Number(m.price) })), renewed, lapsed, duesOutstanding, duePaid, dueOverdue, lastMonthTotal });
  return { gym: service.gymInfo(gym), today, calculatedAt: new Date().toISOString(), ...forecast };
}

module.exports = { renewalRisks, highRiskCount, busyHours, revenue };
