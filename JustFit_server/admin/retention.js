// Super Admin › App Usage, phase 3: retention cohorts, the member-level list and one feature's
// detail. Read-only, admins only (requireAdmin on every request), every table and column name
// from the rules files, every value a parameter. Members here are real members only (not admins,
// not demo accounts), the same rule as admin/usage.js.
//
// "Active" means any counted thing a member did (a feature row or a session), the same list the
// summary uses, so the two screens never disagree. Everything is computed from the rows directly:
// at the current size that takes milliseconds; a daily summary table is the step to take when a
// query here crosses a second (see the note at the end).
const usageRules = require("./usageRules");
const rules = require("./retentionRules");

const num = (value) => Number(value ?? 0);
const MEMBERS = "SELECT id FROM users WHERE role = 'user' AND (email IS NULL OR email NOT LIKE '%@demo.justfit.test')";
const inRange = (column) => `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;

async function presentTables(pool) {
  const [rows] = await pool.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  return new Set(rows.map((r) => r.t));
}

// Every (user_id, day) a member did something, as one UNION the other queries build on: the
// feature rows, a sign-in session created or used that day (the summary counts those too, so
// "active" means the same on both screens), and the app's own sessions when that table exists.
function activityDays(features, tables) {
  const parts = features.map((f) => {
    const where = f.where ? ` WHERE ${f.where}` : "";
    return `SELECT ${f.member} AS user_id, DATE(${f.at}) AS d FROM ${f.table}${where}`;
  });
  parts.push("SELECT user_id, DATE(created_at) AS d FROM auth_sessions");
  parts.push("SELECT user_id, DATE(last_used_at) AS d FROM auth_sessions WHERE last_used_at IS NOT NULL");
  if (tables.has("analytics_sessions")) parts.push("SELECT user_id, DATE(started_at) AS d FROM analytics_sessions");
  return parts.join(" UNION ");
}

/**
 * Retention by join cohort: for each of the last N weeks (or months), how many members joined,
 * and what share of them were active on or after day 1, 7 and 30 (null while a cohort is too
 * young for that day). Also the share active in each later week/month, for a retention curve.
 */
async function retention(pool, query) {
  const q = rules.cohortQuery(query);
  const tables = await presentTables(pool);
  const features = usageRules.FEATURES.filter((f) => tables.has(f.table));
  const activity = activityDays(features, tables);
  // The cohort a member belongs to: the Monday of the week they joined, or the first of the month
  const joinBucket = q.unit === "week"
    ? "DATE_FORMAT(DATE_SUB(u.created_at, INTERVAL WEEKDAY(u.created_at) DAY), '%Y-%m-%d')"
    : "DATE_FORMAT(u.created_at, '%Y-%m-01')";
  const sinceSql = q.unit === "week" ? "DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) + 7 * ? DAY)" : "DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)";

  const [members] = await pool.query(
    `SELECT u.id, ${joinBucket} AS cohort, DATE(u.created_at) AS joined, DATEDIFF(CURDATE(), DATE(u.created_at)) AS ageDays
     FROM users u WHERE u.id IN (${MEMBERS}) AND u.created_at >= ${sinceSql}`,
    [q.cohorts - 1],
  );
  if (members.length === 0) return { unit: q.unit, cohorts: [], days: rules.RETENTION_DAYS };
  const ids = members.map((m) => m.id);
  const [active] = await pool.query(
    `SELECT a.user_id AS userId, DATEDIFF(a.d, DATE(u.created_at)) AS daysAfterJoin
     FROM (${activity}) a JOIN users u ON u.id = a.user_id
     WHERE a.user_id IN (?) AND a.d >= DATE(u.created_at)`,
    [ids],
  );
  const byCohort = new Map();
  for (const m of members) {
    const c = byCohort.get(m.cohort) ?? { cohort: m.cohort, members: [], ageDays: 0 };
    c.members.push(m.id);
    c.ageDays = Math.max(c.ageDays, num(m.ageDays));
    byCohort.set(m.cohort, c);
  }
  const period = q.unit === "week" ? 7 : 30;
  const cohorts = [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => {
    const set = new Set(c.members);
    const rows = active.filter((r) => set.has(r.userId));
    const youngest = Math.min(...members.filter((m) => m.cohort === c.cohort).map((m) => num(m.ageDays)));
    // The curve: share active in each later period (period 0 = the one they joined in)
    const periods = [];
    for (let p = 0; p * period <= youngest || p === 0; p++) {
      const kept = new Set(rows.filter((r) => num(r.daysAfterJoin) >= p * period && num(r.daysAfterJoin) < (p + 1) * period).map((r) => r.userId)).size;
      periods.push(Math.round((kept / c.members.length) * 100));
      if (p >= 12) break;
    }
    return {
      cohort: c.cohort,
      joined: c.members.length,
      retention: Object.fromEntries(rules.RETENTION_DAYS.map((d) => [`day${d}`, rules.retentionFor(c.members.length, rows, d, youngest)])),
      periods,
    };
  });
  return { unit: q.unit, days: rules.RETENTION_DAYS, cohorts };
}

/**
 * The member-level list: who was last active when, their sessions (when tracked), their feature
 * uses, active days and most-used feature, searchable by name or id, sorted, one page at a time.
 * Names are shown to admins only (this route is behind requireAdmin); no contact details.
 */
async function members(pool, query) {
  const q = rules.membersQuery(query);
  const tables = await presentTables(pool);
  const features = usageRules.FEATURES.filter((f) => tables.has(f.table));
  const activity = activityDays(features, tables);
  const sessionsSql = tables.has("analytics_sessions") ? "(SELECT COUNT(*) FROM analytics_sessions s WHERE s.user_id = u.id)" : "NULL";
  const perFeature = features.map((f) => {
    const where = f.where ? ` AND ${f.where}` : "";
    return `(SELECT COUNT(*) FROM ${f.table} WHERE ${f.member} = u.id${where}) AS \`f_${f.id}\``;
  });
  const params = [];
  let where = `u.id IN (${MEMBERS})`;
  if (q.search) {
    const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where += " AND (u.full_name LIKE ? OR u.id = ?)";
    params.push(like, q.search);
  }
  const interactionsSql = perFeature.length > 0 ? features.map((f) => `\`f_${f.id}\``).join(" + ") : "0";
  const ORDER = {
    last_active: "lastActive DESC, u.id",
    sessions: "sessions DESC, lastActive DESC, u.id",
    interactions: "interactions DESC, lastActive DESC, u.id",
    active_days: "activeDays DESC, lastActive DESC, u.id",
    name: "u.full_name IS NULL, u.full_name, u.id",
  };
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, DATE_FORMAT(u.created_at, '%Y-%m-%d') AS joined,
            (SELECT DATE_FORMAT(MAX(a.d), '%Y-%m-%d') FROM (${activity}) a WHERE a.user_id = u.id) AS lastActive,
            (SELECT COUNT(DISTINCT a.d) FROM (${activity}) a WHERE a.user_id = u.id) AS activeDays,
            ${sessionsSql} AS sessions,
            ${perFeature.length > 0 ? perFeature.join(", ") : "0 AS f_none"}
     FROM users u WHERE ${where}
     ORDER BY ${ORDER[q.sort]} LIMIT ? OFFSET ?`.replace("interactions DESC", `(${interactionsSql}) DESC`),
    [...params, q.limit, q.offset],
  );
  const list = rows.map((r) => {
    const counts = Object.fromEntries(features.map((f) => [f.id, num(r[`f_${f.id}`])]));
    const interactions = Object.values(counts).reduce((s, n) => s + n, 0);
    return {
      id: r.id,
      name: (r.full_name && r.full_name.trim()) || "No name yet",
      joined: r.joined ?? null,
      lastActive: r.lastActive ?? null,
      sessions: r.sessions === null ? null : num(r.sessions),
      interactions,
      activeDays: num(r.activeDays),
      mostUsed: rules.mostUsed(counts),
    };
  });
  return { total: num(total), page: q.page, pageSize: q.limit, sort: q.sort, search: q.search, members: list, sessionsTracked: tables.has("analytics_sessions") };
}

/**
 * One feature's detail for a range: uses and members, the previous range, a per-day series, and
 * the members who used it most (admins only). Reuses the summary's range rules.
 */
async function featureDetail(pool, id, query) {
  const feature = rules.featureId(id);
  const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  const q = usageRules.usageQuery(query, today);
  const tables = await presentTables(pool);
  if (!tables.has(feature.table)) return { feature: { id: feature.id, label: feature.label, module: feature.module }, range: q, tracked: false };
  const where = (extra) => [inRange(feature.at), `${feature.member} IN (${MEMBERS})`, feature.where, extra].filter(Boolean).join(" AND ");
  const totals = `COUNT(*) AS uses, COUNT(DISTINCT ${feature.member}) AS members`;
  const [[cur]] = await pool.query(`SELECT ${totals} FROM ${feature.table} WHERE ${where()}`, [q.from, q.to]);
  const [[prev]] = await pool.query(`SELECT ${totals} FROM ${feature.table} WHERE ${where()}`, [q.previousFrom, q.previousTo]);
  const [series] = await pool.query(
    `SELECT DATE_FORMAT(${feature.at}, '%Y-%m-%d') AS k, ${totals} FROM ${feature.table} WHERE ${where()} GROUP BY k`,
    [q.from, q.to],
  );
  const [top] = await pool.query(
    `SELECT t.${feature.member} AS id, u.full_name, COUNT(*) AS uses, MAX(t.${feature.at}) AS lastAt
     FROM ${feature.table} t JOIN users u ON u.id = t.${feature.member} WHERE ${where().replace(new RegExp(`\\b${feature.member}\\b`, "g"), `t.${feature.member}`).replace(new RegExp(`\\b${feature.at}\\b`, "g"), `t.${feature.at}`)}
     GROUP BY t.${feature.member}, u.full_name ORDER BY uses DESC, lastAt DESC LIMIT 10`,
    [q.from, q.to],
  );
  const byKey = new Map(series.map((r) => [r.k, r]));
  return {
    feature: { id: feature.id, label: feature.label, module: feature.module },
    range: { id: q.range, from: q.from, to: q.to, days: q.days, previousFrom: q.previousFrom, previousTo: q.previousTo },
    tracked: true,
    current: { uses: num(cur.uses), members: num(cur.members) },
    previous: { uses: num(prev.uses), members: num(prev.members) },
    changePercent: usageRules.changePercent(num(cur.members), num(prev.members)),
    series: Array.from({ length: q.days }, (_, i) => {
      const key = usageRules.addDays(q.from, i);
      const r = byKey.get(key);
      return { key, uses: num(r?.uses), members: num(r?.members) };
    }),
    topMembers: top.map((r) => ({ id: r.id, name: (r.full_name && r.full_name.trim()) || "No name yet", uses: num(r.uses), lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null })),
  };
}

// Note on scale: every query above reads the feature tables directly. Up to a few hundred
// thousand rows that is well under a second on MySQL with the existing indexes. The brief's daily
// summary table becomes worth building when a query here is measured over a second; adding it
// then is a change to this file only (the routes and screens keep their shapes).

module.exports = { retention, members, featureDetail };
