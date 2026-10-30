// Storing the app's events (analytics_events) and keeping each session's row
// (analytics_sessions) up to date. The member is always the verified caller: the app never
// names one. Writes are idempotent: an event id already stored is skipped (INSERT IGNORE on the
// primary key), so a batch the app retries after a lost reply never counts twice.
//
// Before migrations/2026-11-04-analytics.sql has run, the tables don't exist: the route answers
// 503 once with a clear line and the app keeps its queue (see analytics/routes.js).

const toSql = (ms) => new Date(ms).toISOString().slice(0, 23).replace("T", " ");

/**
 * Stores a cleaned batch for one member. Returns how many events were new. One transaction per
 * batch: the events and the session rows they touch land together or not at all.
 */
async function storeBatch(pool, userId, batch) {
  if (batch.events.length === 0) return { stored: 0 };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Only events not stored before count: a retried batch must not grow the session's count
    const [known] = await conn.query("SELECT id FROM analytics_events WHERE id IN (?) FOR UPDATE", [batch.events.map((e) => e.id)]);
    const seen = new Set(known.map((r) => r.id));
    const fresh = batch.events.filter((e) => !seen.has(e.id));
    if (fresh.length === 0) {
      await conn.commit();
      return { stored: 0 };
    }
    const values = fresh.map((e) => [e.id, userId, e.sessionId, e.name, e.module, e.screen, e.metadata ? JSON.stringify(e.metadata) : null, toSql(e.atMs)]);
    const [result] = await conn.query(
      "INSERT IGNORE INTO analytics_events (id, user_id, session_id, event_name, module, screen_name, metadata, occurred_at) VALUES ?",
      [values],
    );
    // One row per session: first seen, last seen (so a session's length is last − first), platform
    const sessions = new Map();
    for (const e of fresh) {
      const s = sessions.get(e.sessionId) ?? { first: e.atMs, last: e.atMs, events: 0 };
      s.first = Math.min(s.first, e.atMs);
      s.last = Math.max(s.last, e.atMs);
      s.events += 1;
      sessions.set(e.sessionId, s);
    }
    for (const [sessionId, s] of sessions) {
      await conn.query(
        `INSERT INTO analytics_sessions (id, user_id, platform, app_version, started_at, last_event_at, event_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           started_at = LEAST(started_at, VALUES(started_at)),
           last_event_at = GREATEST(last_event_at, VALUES(last_event_at)),
           event_count = event_count + VALUES(event_count),
           app_version = COALESCE(VALUES(app_version), app_version)`,
        [sessionId, userId, batch.platform, batch.appVersion, toSql(s.first), toSql(s.last), s.events],
      );
    }
    await conn.commit();
    return { stored: result.affectedRows };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { storeBatch };
