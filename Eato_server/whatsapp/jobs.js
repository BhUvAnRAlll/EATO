// A small durable job queue in MySQL (the jobs table). A job is saved before anything runs, so
// a crash or restart never loses it; idempotency_key makes enqueueing the same work twice a
// no-op; a worker claims one job at a time with FOR UPDATE SKIP LOCKED, so two workers never
// take the same job. Failures retry with exponential backoff up to max_attempts.
const crypto = require("node:crypto");

const STALE_MINUTES = 5; // a "running" job older than this is assumed abandoned (crash) and requeued
const MAX_BACKOFF_SECONDS = 3600;

// Returns true when a new job was saved, false when the idempotency key already had one
async function enqueue(db, kind, payload, { gymId = null, idempotencyKey = null, delaySeconds = 0, maxAttempts = 5 } = {}) {
  const [result] = await db.query(
    `INSERT IGNORE INTO jobs (kind, gym_id, payload, idempotency_key, max_attempts, run_at)
     VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ? SECOND)`,
    [kind, gymId, JSON.stringify(payload), idempotencyKey, maxAttempts, delaySeconds],
  );
  return result.affectedRows === 1;
}

// Claims the next due job for this worker, or null
async function claimNext(pool, workerId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT id FROM jobs WHERE status = 'queued' AND run_at <= NOW() ORDER BY run_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (rows.length === 0) {
      await connection.commit();
      return null;
    }
    await connection.query("UPDATE jobs SET status = 'running', locked_at = NOW(), locked_by = ?, attempts = attempts + 1 WHERE id = ?", [workerId, rows[0].id]);
    const [[job]] = await connection.query("SELECT id, kind, gym_id, payload, attempts, max_attempts FROM jobs WHERE id = ?", [rows[0].id]);
    await connection.commit();
    return { ...job, payload: typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function complete(db, jobId) {
  await db.query("UPDATE jobs SET status = 'done', finished_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = NULL WHERE id = ?", [jobId]);
}

// A failed attempt: retry later (30 s, 60 s, 120 s ... capped) or give up after max_attempts.
// `retry: false` gives up at once (an error that won't change, such as a missing record).
async function fail(db, job, error, { retry = true } = {}) {
  const summary = String(error?.publicMessage ?? error?.code ?? error?.name ?? "error").slice(0, 300);
  if (!retry || job.attempts >= job.max_attempts) {
    await db.query("UPDATE jobs SET status = 'failed', finished_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?", [summary, job.id]);
    return "failed";
  }
  const delay = Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** (job.attempts - 1));
  await db.query(
    "UPDATE jobs SET status = 'queued', run_at = NOW() + INTERVAL ? SECOND, locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?",
    [delay, summary, job.id],
  );
  return "retry";
}

// Requeues jobs whose worker vanished mid-run
async function recoverStale(db) {
  const [result] = await db.query(
    "UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL WHERE status = 'running' AND locked_at < NOW() - INTERVAL ? MINUTE",
    [STALE_MINUTES],
  );
  return result.affectedRows;
}

const newWorkerId = () => `worker-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

module.exports = { enqueue, claimNext, complete, fail, recoverStale, newWorkerId, STALE_MINUTES };
