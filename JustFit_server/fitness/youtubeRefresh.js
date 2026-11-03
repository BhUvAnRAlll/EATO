// Keeps what the YouTube Data API answered within YouTube's storage limit (fitness/youtube.js):
// a session video's creator (the credit under the player) is read again before it's REFRESH_DAYS
// old, and wiped once older than KEEP_DAYS (YouTube couldn't be asked, or there's no key). The
// video's ID is our own data and stays. Program-level videos (dropped on 2026-11-03) are no longer
// loaded; what's left of them is deleted the same way. Runs at start and every few hours without
// keeping the process alive.
const youtube = require("./youtube");
const programs = require("./programs");

const BATCH = 20; // sessions read again per run, to keep well inside the API's daily quota

/** One pass → { refreshed, failed, purged } */
async function refreshStale(pool, env = process.env) {
  let refreshed = 0;
  let failed = 0;
  if (youtube.configured(env)) {
    const [due] = await pool.query(
      `SELECT id, youtube_id FROM fitness_program_sessions
       WHERE youtube_id IS NOT NULL AND (youtube_synced_at IS NULL OR youtube_synced_at < NOW() - INTERVAL ? DAY)
       ORDER BY youtube_synced_at IS NOT NULL, youtube_synced_at LIMIT ${BATCH}`,
      [youtube.REFRESH_DAYS],
    );
    for (const { id, youtube_id: videoId } of due) {
      const error = await programs.loadSessionChannel(pool, id, videoId, env).catch(() => "failed");
      if (error) failed += 1;
      else refreshed += 1;
    }
  }
  const [stale] = await pool.query(
    "SELECT id FROM fitness_programs WHERE videos_synced_at IS NULL OR videos_synced_at < NOW() - INTERVAL ? DAY",
    [youtube.KEEP_DAYS],
  );
  let purged = 0;
  if (stale.length) {
    const ids = stale.map((r) => r.id);
    const [result] = await pool.query("DELETE FROM fitness_program_videos WHERE program_id IN (?)", [ids]);
    purged = result.affectedRows;
    await pool.query("UPDATE fitness_programs SET youtube_channel = NULL WHERE id IN (?) AND youtube_channel IS NOT NULL", [ids]);
  }
  const [wiped] = await pool.query(
    "UPDATE fitness_program_sessions SET youtube_channel = NULL WHERE youtube_channel IS NOT NULL AND (youtube_synced_at IS NULL OR youtube_synced_at < NOW() - INTERVAL ? DAY)",
    [youtube.KEEP_DAYS],
  );
  purged += wiped.affectedRows;
  return { refreshed, failed, purged };
}

/** Runs refreshStale now and every `everyMs` (six hours). → stop() */
function startRefresh(pool, { everyMs = 6 * 60 * 60 * 1000, log = console, env = process.env } = {}) {
  let warned = false;
  const run = () =>
    refreshStale(pool, env)
      .then(({ refreshed, failed, purged }) => {
        if (refreshed + failed + purged > 0 && env.NODE_ENV !== "test") log.log(`YouTube refresh: ${refreshed} session videos refreshed, ${failed} failed, ${purged} old answers deleted`);
      })
      .catch((error) => {
        if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
          if (!warned) log.warn("YouTube refresh skipped: run migrations/2026-11-17-session-videos.sql");
          warned = true;
          return;
        }
        log.error(`YouTube refresh failed: ${error?.code ?? error?.name ?? "unknown"}`);
      });
  const first = setTimeout(run, 5000);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { refreshStale, startRefresh };
