// Admin › Exercises: every exercise a member can be given (the workout library), with whether it
// has a demo video yet and how many members' current plans use it, so the admin knows which
// videos to record first. The admin grows the list by asking the AI for new exercises; what the
// AI answers is cleaned (exerciseRules.js) and added at once, live for the workout engine. An
// exercise is never deleted (old plans point at it): it is archived, and can be restored.
//
// Every route is admin-only (admin/routes.js); every value from the request goes through
// exerciseRules.js and a parameterised query.
const rules = require("./exerciseRules");
const workoutPlans = require("../workout/plans");
const { askStructured } = require("../ai/structured");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");
const { audit } = require("./overview");
const { NotFoundError } = require("../errors");

const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const iso = (value) => (value ? new Date(value).toISOString() : null);

// How many members have the exercise in their active workout plan
const IN_USE = `(SELECT COUNT(DISTINCT e.user_id) FROM workout_day_exercises e
                 JOIN workout_plans p ON p.id = e.plan_id AND p.status = 'active'
                 WHERE e.exercise_id = l.id)`;

const COLUMNS = `l.id, l.name, l.muscle_group, l.equipment, l.pattern, l.difficulty, l.high_risk, l.low_impact, l.machine,
                 l.region, l.timed_sec, l.instructions, l.video_key, l.video_uploaded_at, l.built_in, l.ai_drafted,
                 l.archived_at, l.created_at, ${IN_USE} AS in_use`;

const toApi = (row) => ({
  id: row.id,
  name: row.name,
  muscleGroup: row.muscle_group,
  equipment: row.equipment ?? "",
  pattern: row.pattern,
  difficulty: row.difficulty,
  highRisk: Boolean(row.high_risk),
  lowImpact: Boolean(row.low_impact),
  machine: Boolean(row.machine),
  region: row.region,
  timedSec: row.timed_sec ?? null,
  instructions: json(row.instructions) ?? [],
  source: row.built_in ? "built_in" : row.ai_drafted ? "ai" : "admin",
  hasVideo: row.video_key !== null && row.video_key !== undefined,
  videoUploadedAt: iso(row.video_uploaded_at),
  archived: row.archived_at !== null && row.archived_at !== undefined,
  inUse: Number(row.in_use ?? 0),
  createdAt: iso(row.created_at),
});

// The built-in exercises are added to the database the first time a plan is made; the admin's
// list must show them even before any member has a plan
async function withLibrary(pool) {
  const conn = await pool.getConnection();
  try {
    await workoutPlans.syncLibrary(conn);
  } finally {
    conn.release();
  }
}

/**
 * The list: active (or archived) exercises, filtered by muscle group, video state and a name
 * search. Exercises without a video come first, the most used first, so the admin films those
 * first. `counts` covers every active exercise, whatever the filters.
 */
async function list(pool, q) {
  await withLibrary(pool);
  const where = [q.show === "archived" ? "l.archived_at IS NOT NULL" : "l.archived_at IS NULL"];
  const params = [];
  if (q.group) { where.push("l.muscle_group = ?"); params.push(q.group); }
  if (q.video === "missing") where.push("l.video_key IS NULL");
  if (q.video === "ready") where.push("l.video_key IS NOT NULL");
  if (q.search) {
    // LIKE wildcards in the text are matched literally
    where.push("l.name LIKE ?");
    params.push(`%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM workout_exercise_library l WHERE ${where.join(" AND ")}
     ORDER BY (l.video_key IS NULL) DESC, in_use DESC, l.name`,
    params,
  );
  const [[counts]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(video_key IS NOT NULL), 0) AS with_video, COALESCE(SUM(ai_drafted), 0) AS ai
     FROM workout_exercise_library WHERE archived_at IS NULL`,
  );
  const [[archived]] = await pool.query("SELECT COUNT(*) AS n FROM workout_exercise_library WHERE archived_at IS NOT NULL");
  return {
    exercises: rows.map(toApi),
    counts: { total: Number(counts.total), withVideo: Number(counts.with_video), ai: Number(counts.ai), archived: Number(archived.n) },
  };
}

async function detail(pool, id) {
  const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM workout_exercise_library l WHERE l.id = ?`, [id]);
  if (!row) throw new NotFoundError("That exercise doesn't exist.");
  return toApi(row);
}

/**
 * Asks the AI for up to `count` new exercises matching the admin's `request`, and adds the ones
 * that pass the checks (live at once: the engine may program them in the next plan it makes).
 * Answers what was added and what was left out, with why. One AI call, recorded as
 * exercise_library against the admin; the AI limits apply as for every other call.
 */
async function draftWithAi(pool, adminId, body, env = process.env) {
  await withLibrary(pool);
  await aiLimits.check(pool, { feature: "exercise_library", userId: adminId }, env);
  return dedupe.shared.run(dedupe.requestKey("exercise_library", adminId, body.request, body.count), async () => {
    const [names] = await pool.query("SELECT name FROM workout_exercise_library ORDER BY created_at DESC");
    const usage = aiUsage.tracker(pool, { feature: "exercise_library", userId: adminId });
    const raw = await askStructured(
      {
        feature: "exercise_library",
        instructions: rules.INSTRUCTIONS,
        brief: rules.draftBrief(body, names.map((n) => n.name)),
        schema: rules.draftSchema,
        fake: rules.FAKE_DRAFT,
        failure: "The AI couldn't put exercises together right now. Please try again.",
        busy: "The AI is busy right now. Please try again in a minute.",
      },
      env,
      usage,
    );
    const { added, skipped } = rules.normalizeDrafts(raw, { count: body.count, taken: new Set(names.map((n) => rules.exerciseKey(n.name))) });

    const ids = [];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const e of added) {
        const [[{ id }]] = await conn.query("SELECT UUID() AS id");
        // A name the database already holds (the same name added a moment ago) is left out, not an error
        const [result] = await conn.query(
          `INSERT IGNORE INTO workout_exercise_library
             (id, name, muscle_group, equipment, pattern, difficulty, high_risk, low_impact, machine, region, timed_sec, instructions, built_in, ai_drafted, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, TRUE, ?)`,
          [id, e.name, e.muscleGroup, e.equipment, e.pattern, e.difficulty, e.highRisk, e.lowImpact, e.machine, e.region, e.timedSec, JSON.stringify(e.instructions), adminId],
        );
        if (result.affectedRows === 1) ids.push(id);
        else skipped.push({ name: e.name, reason: "It's already in the library." });
      }
      if (ids.length > 0) {
        await audit(conn, adminId, "exercise.ai_add", "exercise", null, `Added ${ids.length} exercise${ids.length === 1 ? "" : "s"} with AI for “${body.request}”`);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
    const [rows] = ids.length ? await pool.query(`SELECT ${COLUMNS} FROM workout_exercise_library l WHERE l.id IN (?) ORDER BY l.name`, [ids]) : [[]];
    return { added: rows.map(toApi), skipped };
  });
}

/**
 * Archives an exercise (the engine stops programming it; plans that have it keep it) or restores
 * it. The audit log records which, by whom.
 */
async function setArchived(pool, adminId, id, archived) {
  const exercise = await detail(pool, id);
  if (exercise.archived === archived) return exercise;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE workout_exercise_library SET archived_at = ${archived ? "NOW()" : "NULL"} WHERE id = ?`, [id]);
    await audit(conn, adminId, archived ? "exercise.archive" : "exercise.restore", "exercise", id, `${archived ? "Archived" : "Restored"} exercise “${exercise.name}”`);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  return detail(pool, id);
}

module.exports = { list, detail, draftWithAi, setArchived };
