// The job worker: runs inside the server process, one job at a time, every `intervalMs`. Each
// job kind has a handler (pool, job) => Promise. A handler error retries with backoff (jobs.js);
// an error marked `retryable === false` fails the job at once. Errors are logged with the safe
// describer (logging.js): never a payload, token or message text.
const { claimNext, complete, fail, recoverStale, newWorkerId } = require("./jobs");
const { describeError } = require("../logging");

function createWorker(pool, handlers, { intervalMs = 1000, workerId = newWorkerId(), log = (entry) => console.error(JSON.stringify(entry)) } = {}) {
  let timer = null;
  let busy = false;
  let pausedUntil = 0; // after an error the worker rests for a minute, so a broken database can't flood the log

  // Runs due jobs until none are left (or `max`); returns how many ran
  async function runOnce({ max = 50 } = {}) {
    await recoverStale(pool);
    let ran = 0;
    while (ran < max) {
      const job = await claimNext(pool, workerId);
      if (!job) break;
      ran += 1;
      const handler = handlers[job.kind];
      try {
        if (!handler) throw Object.assign(new Error(`no handler for ${job.kind}`), { retryable: false });
        await handler(pool, job);
        await complete(pool, job.id);
      } catch (error) {
        const result = await fail(pool, job, error, { retry: error?.retryable !== false });
        log({ at: new Date().toISOString(), job: job.kind, attempt: job.attempts, result, error: describeError(error) });
      }
    }
    return ran;
  }

  return {
    runOnce,
    // Starts polling, but only once the jobs table exists: a database that hasn't had the
    // WhatsApp migration yet gets one log line and no worker, never a retry loop
    async start() {
      if (timer) return false;
      try {
        await pool.query("SELECT 1 FROM jobs LIMIT 1");
      } catch (error) {
        log({ at: new Date().toISOString(), worker: workerId, off: error?.code === "ER_NO_SUCH_TABLE" ? "run migrations/2026-10-24-whatsapp-agent.sql to turn the WhatsApp worker on" : "database unavailable", error: describeError(error) });
        return false;
      }
      timer = setInterval(async () => {
        if (busy || Date.now() < pausedUntil) return;
        busy = true;
        try {
          await runOnce();
        } catch (error) {
          pausedUntil = Date.now() + 60 * 1000;
          log({ at: new Date().toISOString(), worker: workerId, pausedForSeconds: 60, error: describeError(error) });
        } finally {
          busy = false;
        }
      }, intervalMs);
      timer.unref();
      return true;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createWorker };
