// Super Admin › App Usage: how members use the app, counted from the rows the features already
// write (no event tracking yet; see admin/usageRules.js for which rows count). Everything is
// read-only, scoped to no one (only justFit admins reach it: requireAdmin on every request), and
// every table and column name comes from the rules file, never from a request. Dates are the
// database's own day (its clock runs in IST), and admin and demo accounts are left out of every
// count so they never pass for members.
const rules = require("./usageRules");

const num = (value) => Number(value ?? 0);

// Only real members count: not admins, not the demo accounts the seed script makes
const MEMBERS = "SELECT id FROM users WHERE role = 'user' AND (email IS NULL OR email NOT LIKE '%@demo.justfit.test')";

// The window "from .. to" (inclusive dates) on a time or date column
const inRange = (column) => `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;

// The tables this database has. A feature whose table is missing (a migration not run here yet,
// for example ai_usage before 2026-11-03-ai-usage.sql) is reported as not tracked rather than
// counted as zero, so "nobody uses it" is never confused with "nothing records it".
async function presentTables(pool) {
  const [rows] = await pool.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  return new Set(rows.map((r) => r.t));
}
const countable = (features, tables) => features.filter((f) => tables.has(f.table));

// Uses and distinct members for every feature in one window
async function featureCounts(pool, features, from, to) {
  if (features.length === 0) return [];
  const parts = features.map((f) => {
    const where = [inRange(f.at), `${f.member} IN (${MEMBERS})`, f.where].filter(Boolean).join(" AND ");
    return `SELECT '${f.id}' AS id, COUNT(*) AS uses, COUNT(DISTINCT ${f.member}) AS members FROM ${f.table} WHERE ${where}`;
  });
  const params = features.flatMap(() => [from, to]);
  const [rows] = await pool.query(parts.join(" UNION ALL "), params);
  return rows;
}

// Members active in a window: anyone whose session was used, or who did any counted thing, in it.
// (A session's last_used_at is refreshed at most hourly, so a member who only opened the app and
// read is still counted on the day they did.)
async function activeMembers(pool, features, from, to) {
  const uses = features.map((f) => {
    const where = [inRange(f.at), f.where].filter(Boolean).join(" AND ");
    return `SELECT ${f.member} AS user_id FROM ${f.table} WHERE ${where}`;
  });
  const sql = `
    SELECT COUNT(*) AS n FROM (
      SELECT DISTINCT a.user_id FROM (
        SELECT user_id FROM auth_sessions WHERE ${inRange("last_used_at")}
        UNION ALL SELECT user_id FROM auth_sessions WHERE ${inRange("created_at")}
        ${uses.map((u) => `UNION ALL ${u}`).join(" ")}
      ) a WHERE a.user_id IN (${MEMBERS})
    ) m`;
  const params = [from, to, from, to, ...features.flatMap(() => [from, to])];
  const [[row]] = await pool.query(sql, params);
  return num(row.n);
}

// Active members per day across the window, for the trend chart (days with nobody are filled in)
async function activeSeries(pool, features, from, to, days) {
  const uses = features.map((f) => {
    const where = [inRange(f.at), f.where].filter(Boolean).join(" AND ");
    return `SELECT DATE(${f.at}) AS d, ${f.member} AS user_id FROM ${f.table} WHERE ${where}`;
  });
  const sql = `
    SELECT DATE_FORMAT(d, '%Y-%m-%d') AS k, COUNT(DISTINCT user_id) AS members FROM (
      SELECT DATE(last_used_at) AS d, user_id FROM auth_sessions WHERE ${inRange("last_used_at")}
      UNION ALL SELECT DATE(created_at) AS d, user_id FROM auth_sessions WHERE ${inRange("created_at")}
      ${uses.map((u) => `UNION ALL ${u}`).join(" ")}
    ) a WHERE a.user_id IN (${MEMBERS}) GROUP BY d`;
  const params = [from, to, from, to, ...features.flatMap(() => [from, to])];
  const [rows] = await pool.query(sql, params);
  const byKey = new Map(rows.map((r) => [r.k, num(r.members)]));
  return Array.from({ length: days }, (_, i) => {
    const key = rules.addDays(from, i);
    return { key, members: byKey.get(key) ?? 0 };
  });
}

// Screen visits and sessions from the app's events (phase 2), when its tables exist here
async function engagement(pool, from, to, previousFrom, previousTo) {
  const [screens] = await pool.query(
    `SELECT screen_name AS screen, COUNT(*) AS visits, COUNT(DISTINCT user_id) AS members
     FROM analytics_events WHERE event_name = 'screen_viewed' AND ${inRange("occurred_at")} AND user_id IN (${MEMBERS})
     GROUP BY screen_name ORDER BY members DESC, visits DESC`,
    [from, to],
  );
  const sessionsSql = `
    SELECT COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS members,
           COALESCE(AVG(TIMESTAMPDIFF(SECOND, started_at, last_event_at)), 0) AS avgSeconds
    FROM analytics_sessions WHERE ${inRange("started_at")} AND user_id IN (${MEMBERS})`;
  const [[cur]] = await pool.query(sessionsSql, [from, to]);
  const [[prev]] = await pool.query(sessionsSql, [previousFrom, previousTo]);
  const sessions = num(cur.sessions);
  return {
    screens: screens.map((r) => ({ screen: r.screen, visits: num(r.visits), members: num(r.members) })),
    sessions: {
      total: sessions,
      previousTotal: num(prev.sessions),
      changePercent: rules.changePercent(sessions, num(prev.sessions)),
      perMember: num(cur.members) > 0 ? Math.round((sessions / num(cur.members)) * 10) / 10 : 0,
      avgSeconds: Math.round(num(cur.avgSeconds)),
    },
  };
}

/**
 * Everything the App Usage screen shows for one range: the members (registered, new, active, and
 * active in the period before), the features ranked by distinct members with the period before
 * to compare, the modules' totals, the active-members trend, and what isn't tracked yet.
 */
async function summary(pool, query) {
  const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  const q = rules.usageQuery(query, today);
  const tables = await presentTables(pool);
  const features = countable(rules.FEATURES, tables);
  const missing = rules.FEATURES.filter((f) => !tables.has(f.table));

  const [[members]] = await pool.query(
    `SELECT COUNT(*) AS registered,
            SUM(${inRange("created_at")}) AS newInPeriod
     FROM users WHERE id IN (${MEMBERS})`,
    [q.from, q.to],
  );
  const [active, previousActive, current, previous, series] = await Promise.all([
    activeMembers(pool, features, q.from, q.to),
    activeMembers(pool, features, q.previousFrom, q.previousTo),
    featureCounts(pool, features, q.from, q.to),
    featureCounts(pool, features, q.previousFrom, q.previousTo),
    activeSeries(pool, features, q.from, q.to, q.days),
  ]);

  const labels = new Map(rules.FEATURES.map((f) => [f.id, f]));
  const ranked = rules.rankFeatures(
    current.map((r) => ({ ...r, module: labels.get(r.id).module, label: labels.get(r.id).label })),
    previous,
    active,
  );
  const modules = rules.MODULES.map((m) => {
    const own = ranked.filter((f) => f.module === m.id);
    return {
      id: m.id,
      label: m.label,
      uses: own.reduce((sum, f) => sum + f.uses, 0),
      // Members who used any feature of the module (counted once per module)
      members: Math.max(0, ...own.map((f) => f.members)),
      features: own.map((f) => f.id),
    };
  });

  const tracked = tables.has("analytics_events") && tables.has("analytics_sessions");
  const engaged = tracked ? await engagement(pool, q.from, q.to, q.previousFrom, q.previousTo) : null;

  const totalUses = ranked.reduce((sum, f) => sum + f.uses, 0);
  return {
    range: { id: q.range, from: q.from, to: q.to, days: q.days, previousFrom: q.previousFrom, previousTo: q.previousTo },
    members: {
      registered: num(members.registered),
      newInPeriod: num(members.newInPeriod),
      active,
      previousActive,
      activeChangePercent: rules.changePercent(active, previousActive),
      activePercent: num(members.registered) > 0 ? Math.round((active / num(members.registered)) * 100) : 0,
    },
    totals: { uses: totalUses, usesPerActiveMember: active > 0 ? Math.round((totalUses / active) * 10) / 10 : 0 },
    features: ranked,
    modules,
    series,
    // Screen visits and sessions, once the app's event tables exist here (null until then)
    engagement: engaged,
    notTracked: [
      ...missing.map((f) => ({ id: f.id, label: f.label, reason: `its table (${f.table}) isn't set up on this server yet` })),
      ...rules.NOT_TRACKED.filter((n) => !(tracked && n.id === "screen_visits")),
    ],
  };
}

module.exports = { summary };
