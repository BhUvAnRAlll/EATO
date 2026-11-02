// The Fitness tab's programs (asked for by the user on 2026-11-02): free programs in six sections,
// for home, the center or both, each a few sessions of library exercises. Members browse and
// search them and do any session today: it runs as a day of their plan (workout_days with
// program_session_id, pointed at by today's override), so the existing day screen and session
// player work unchanged. Admins edit them and have the AI rewrite their sessions.
//
// The starter programs come from JustFit_client/src/lib/fitness/catalog.ts, added the first time
// the list is read, with sessions built from the library (rules.buildSessions). Nothing cascades:
// a program's sessions and exercises are deleted here, in a transaction.
const rules = require("./rules");
const plans = require("../workout/plans");
const aiPlan = require("../workout/aiPlan");
const { askStructured } = require("../ai/structured");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");
const { audit } = require("../admin/overview");
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const covers = require("./covers");
const sections = require("./sections");

const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

async function inTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// ---- sessions in the database --------------------------------------------------------------

// Writes a program's sessions (the caller holds the transaction and removed the old ones)
async function writeSessions(conn, programId, sessions) {
  const { idByName } = await plans.programmableLibrary(conn);
  for (const [position, s] of sessions.entries()) {
    const [[{ id: sessionId }]] = await conn.query("SELECT UUID() AS id");
    await conn.query("INSERT INTO fitness_program_sessions (id, program_id, position, title, minutes) VALUES (?, ?, ?, ?, ?)", [sessionId, programId, position, s.title.slice(0, 60), s.minutes]);
    for (const e of s.exercises) {
      const exerciseId = idByName(e.name);
      if (!exerciseId) continue;
      await conn.query(
        `INSERT INTO fitness_program_exercises (session_id, program_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, programId, exerciseId, e.section, e.order, JSON.stringify(e.sets), e.restSec, e.role, e.repsMin ?? null, e.repsMax ?? null, e.note ?? null],
      );
    }
  }
}

async function removeSessions(conn, programId) {
  await conn.query("DELETE FROM fitness_program_exercises WHERE program_id = ?", [programId]);
  await conn.query("DELETE FROM fitness_program_sessions WHERE program_id = ?", [programId]);
}

// ---- the starter catalog --------------------------------------------------------------------

let catalogChecked = false;

/**
 * Adds the catalog's programs the table doesn't have yet (by slug; an admin's edits are kept)
 * and builds sessions for any program left without them. Checked once per server start.
 */
async function ensureCatalog(pool) {
  if (catalogChecked) return;
  await sections.ensureBuiltIn(pool);
  await plans.syncLibrary(pool);
  const { library } = await plans.programmableLibrary(pool);
  const [existing] = await pool.query("SELECT slug FROM fitness_programs");
  const have = new Set(existing.map((r) => r.slug));
  for (const [i, seed] of rules.catalog.PROGRAMS.entries()) {
    if (have.has(seed.slug)) continue;
    await inTransaction(pool, async (conn) => {
      const [[{ id }]] = await conn.query("SELECT UUID() AS id");
      const [result] = await conn.query(
        `INSERT IGNORE INTO fitness_programs (id, slug, title, subtitle, description, section, place, level, kit, icon, palette, position, built_in)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [id, seed.slug, seed.title, seed.subtitle, seed.description, seed.section, seed.place, seed.level, seed.kit, seed.icon, seed.palette, i],
      );
      if (result.affectedRows === 1) await writeSessions(conn, id, rules.buildSessions(seed, library));
    });
  }
  catalogChecked = true;
}

// ---- reading -----------------------------------------------------------------------------

const PROGRAM_COLUMNS = `p.id, p.slug, p.title, p.subtitle, p.description, p.section, p.place, p.level, p.kit, p.icon, p.palette, p.cover_key, p.cover_updated_at, p.position, p.published, p.built_in, p.ai_drafted,
  (SELECT fs.title FROM fitness_sections fs WHERE fs.slug = p.section) AS section_title,
  (SELECT COUNT(*) FROM fitness_program_sessions s WHERE s.program_id = p.id) AS session_count,
  (SELECT MIN(s.minutes) FROM fitness_program_sessions s WHERE s.program_id = p.id) AS min_minutes,
  (SELECT MAX(s.minutes) FROM fitness_program_sessions s WHERE s.program_id = p.id) AS max_minutes`;

// Where the app reads a program's cover (null: no cover, the palette's gradient). Members read
// published programs' covers; the admin's route also serves hidden ones. `v` changes with each
// new cover, so the long cache on the answer never shows an old one.
const coverUrlOf = (row, admin) =>
  row.cover_key
    ? `${admin ? "/api/admin/portal/programs" : "/api/fitness/programs"}/${encodeURIComponent(row.id)}/cover?v=${new Date(row.cover_updated_at ?? 0).getTime()}`
    : null;

const cardOf = (row, admin = false) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  section: row.section,
  sectionTitle: row.section_title ?? rules.catalog.SECTION_TITLE[row.section] ?? "",
  place: row.place,
  level: row.level,
  icon: row.icon,
  palette: row.palette,
  coverUrl: coverUrlOf(row, admin),
  sessionCount: Number(row.session_count ?? 0),
  minutes: { min: Number(row.min_minutes ?? 0), max: Number(row.max_minutes ?? 0) },
  published: Boolean(row.published),
});

const matches = (row, search) => {
  if (!search) return true;
  const q = search.toLowerCase();
  return [row.title, row.subtitle, row.description, row.section_title].some((t) => String(t ?? "").toLowerCase().includes(q));
};

/**
 * The Fitness tab: published programs with sessions for the place (a "both" program is in both),
 * matching the search, grouped in the shown categories in the admin's order, each with its card
 * layout (an empty category is left out; a hidden category's programs aren't shown).
 */
async function list(pool, { place, search }) {
  await ensureCatalog(pool);
  const [rows] = await pool.query(`SELECT ${PROGRAM_COLUMNS} FROM fitness_programs p WHERE p.published = TRUE AND p.place IN (?, 'both') ORDER BY p.position, p.title`, [place]);
  const usable = rows.filter((r) => Number(r.session_count) > 0 && matches(r, search));
  return {
    place,
    search,
    sections: (await sections.all(pool, { published: true }))
      .map((section) => ({ id: section.id, title: section.title, note: section.note, layout: section.layout, programs: usable.filter((r) => r.section === section.id).map((r) => cardOf(r)) }))
      .filter((section) => section.programs.length > 0),
  };
}

// A session's exercises with what the library knows (and whether the admin added a video)
async function sessionExercises(db, sessionIds) {
  if (sessionIds.length === 0) return [];
  const [rows] = await db.query(
    `SELECT e.session_id, e.section, e.position, e.sets, e.rest_sec, e.role, e.reps_min, e.reps_max, e.note,
            l.id AS exercise_id, l.name, l.muscle_group, l.equipment, l.video_key
     FROM fitness_program_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id
     WHERE e.session_id IN (?) ORDER BY e.session_id, FIELD(e.section, 'warmup', 'workout', 'cooldown'), e.position`,
    [sessionIds],
  );
  return rows;
}

const exerciseOf = (r) => ({
  name: r.name,
  muscleGroup: r.muscle_group,
  equipment: r.equipment ?? "Bodyweight",
  section: r.section,
  sets: json(r.sets) ?? [],
  restSec: r.rest_sec,
  repsMin: r.reps_min,
  repsMax: r.reps_max,
  note: r.note,
  hasVideo: r.video_key !== null && r.video_key !== undefined,
});

/** One program in full: its card, description and every session with its exercises */
async function detail(pool, programId, { admin = false } = {}) {
  await ensureCatalog(pool);
  const [[row]] = await pool.query(`SELECT ${PROGRAM_COLUMNS} FROM fitness_programs p WHERE p.id = ?${admin ? "" : " AND p.published = TRUE"}`, [programId]);
  if (!row) throw new NotFoundError("That program doesn't exist.");
  const [sessions] = await pool.query("SELECT id, position, title, minutes FROM fitness_program_sessions WHERE program_id = ? ORDER BY position", [programId]);
  const exercises = await sessionExercises(pool, sessions.map((s) => s.id));
  return {
    ...cardOf(row, admin),
    description: row.description,
    kit: row.kit,
    source: row.built_in ? "built_in" : "admin",
    aiDrafted: Boolean(row.ai_drafted),
    sessions: sessions.map((s) => {
      const mine = exercises.filter((e) => e.session_id === s.id).map(exerciseOf);
      return { id: s.id, title: s.title, minutes: s.minutes, exerciseCount: mine.filter((e) => e.section === "workout").length, exercises: mine };
    }),
  };
}

// ---- doing a session today -------------------------------------------------------------------

/**
 * Makes a program session today's workout: a day of the member's active plan for that session
 * (made the first time, then reused), with today pointed at it. The day screen and the session
 * player then run it like any other day. Refused once today's session has started.
 */
async function startToday(pool, userId, { programId, sessionId, today }) {
  const program = await detail(pool, programId);
  const session = program.sessions.find((s) => s.id === sessionId);
  if (!session) throw new NotFoundError("That session isn't in the program.");
  const plan = await plans.activePlanRow(pool, userId);
  if (!plan) throw new ValidationError("Open the Fitness tab once so your plan is ready, then try again.");

  return plans.withMemberLock(pool, userId, async (conn) => {
    const [now] = await plans.resolveDates(conn, userId, plan.id, [today], today, plan.start_date);
    if (now.status === "completed") throw new ValidationError("You've already finished a workout today. Try this one tomorrow.");
    if (now.status === "in_progress") throw new ValidationError("Finish today's session before starting another one.");
    const [[kept]] = await conn.query("SELECT id FROM workout_days WHERE plan_id = ? AND user_id = ? AND program_session_id = ?", [plan.id, userId, sessionId]);
    let dayId = kept?.id;
    if (!dayId) {
      const [[{ id }]] = await conn.query("SELECT UUID() AS id");
      dayId = id;
      const title = `${program.title} · ${session.title}`.slice(0, 60);
      await conn.query(
        "INSERT INTO workout_days (id, plan_id, user_id, weekday, title, session_type, program_session_id) VALUES (?, ?, ?, ?, ?, 'full_body', ?)",
        [dayId, plan.id, userId, weekdayOf(today), title, sessionId],
      );
      const [rows] = await conn.query("SELECT exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note FROM fitness_program_exercises WHERE session_id = ? ORDER BY position", [sessionId]);
      for (const r of rows) {
        await conn.query(
          `INSERT INTO workout_day_exercises (day_id, plan_id, user_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dayId, plan.id, userId, r.exercise_id, r.section, r.position, typeof r.sets === "string" ? r.sets : JSON.stringify(r.sets), r.rest_sec, r.role, r.reps_min, r.reps_max, r.note],
        );
      }
    }
    await plans.pointDate(conn, userId, today, dayId);
    return { date: today, dayId };
  });
}

// ---- the admin ---------------------------------------------------------------------------

/** Admin › Programs: every program, published or not, in section order */
async function adminList(pool) {
  await ensureCatalog(pool);
  const [rows] = await pool.query(`SELECT ${PROGRAM_COLUMNS} FROM fitness_programs p ORDER BY (SELECT fs.position FROM fitness_sections fs WHERE fs.slug = p.section), p.position, p.title`);
  return { programs: rows.map((row) => cardOf(row, true)) };
}

const COLUMN = { title: "title", subtitle: "subtitle", description: "description", section: "section", place: "place", level: "level", kit: "kit", icon: "icon", palette: "palette", published: "published" };

/** Saves an admin's edits (the column names come from COLUMN, never the request) */
async function update(pool, adminId, programId, fields) {
  const before = await detail(pool, programId, { admin: true });
  const keys = Object.keys(fields).filter((k) => COLUMN[k]);
  if (keys.length === 0) return before;
  if (fields.section !== undefined) await sections.mustExist(pool, fields.section);
  await inTransaction(pool, async (conn) => {
    await conn.query(`UPDATE fitness_programs SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => fields[k]), programId]);
    const what = keys.includes("published") && keys.length === 1 ? (fields.published ? "Published" : "Hid") : "Edited";
    await audit(conn, adminId, `program.${what === "Edited" ? "edit" : what === "Published" ? "publish" : "hide"}`, "program", programId, `${what} program “${fields.title ?? before.title}”`);
  });
  return detail(pool, programId, { admin: true });
}

// ---- the cover photo ---------------------------------------------------------------------------

/**
 * Puts a checked photo (fitness/covers.js checkCover) on the program as its cover, replacing any
 * cover it had: the new file is written first, the program then points at it, and only then is the
 * old file deleted, so members never get a missing cover. Two uploads at once each delete the
 * file they replaced (the row is locked while it changes). Answers the program as the admin sees it.
 */
async function setCover(pool, adminId, programId, { bytes, mediaType }, env = process.env) {
  await detail(pool, programId, { admin: true }); // a 404 before anything is written
  const key = await covers.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query("SELECT title, cover_key FROM fitness_programs WHERE id = ? FOR UPDATE", [programId]);
      if (!row) throw new NotFoundError("That program doesn't exist.");
      await conn.query("UPDATE fitness_programs SET cover_key = ?, cover_updated_at = NOW(3) WHERE id = ?", [key, programId]);
      await audit(conn, adminId, row.cover_key ? "program.cover_replace" : "program.cover_add", "program", programId, `${row.cover_key ? "Replaced" : "Added"} the cover of “${row.title}”`);
      return row.cover_key;
    });
  } catch (error) {
    await covers.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await covers.remove(replaced, env).catch((error) => console.error(`Program cover cleanup failed: ${error?.code ?? "unknown"}`));
  return detail(pool, programId, { admin: true });
}

/** Takes the cover off (the card shows the palette's gradient again) and deletes its file */
async function removeCover(pool, adminId, programId, env = process.env) {
  await detail(pool, programId, { admin: true });
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT title, cover_key FROM fitness_programs WHERE id = ? FOR UPDATE", [programId]);
    if (!row) throw new NotFoundError("That program doesn't exist.");
    if (!row.cover_key) return null;
    await conn.query("UPDATE fitness_programs SET cover_key = NULL, cover_updated_at = NOW(3) WHERE id = ?", [programId]);
    await audit(conn, adminId, "program.cover_remove", "program", programId, `Removed the cover of “${row.title}”`);
    return row.cover_key;
  });
  if (removed) await covers.remove(removed, env).catch((error) => console.error(`Program cover cleanup failed: ${error?.code ?? "unknown"}`));
  return detail(pool, programId, { admin: true });
}

/** The cover file of a program (members: published ones only) → { bytes, mediaType }; 404 when there is none */
async function coverFile(pool, programId, { admin = false } = {}, env = process.env) {
  const [[row]] = await pool.query(`SELECT cover_key FROM fitness_programs WHERE id = ?${admin ? "" : " AND published = TRUE"}`, [programId]);
  const file = row?.cover_key ? await covers.read(row.cover_key, env) : null;
  if (!file) throw new NotFoundError("That program has no cover.");
  return file;
}

// Full-body sessions in turn, for a program with no catalog movements when the AI can't write it
const FALLBACK_ROTATION = [
  ["squat", "horizontal_push", "horizontal_pull", "core"],
  ["hinge", "vertical_push", "lunge", "conditioning"],
  ["squat", "horizontal_pull", "hinge", "core"],
];

// The AI's sessions for a program, or the library-built ones when the AI can't
async function draftSessions(pool, adminId, program, { count, minutes, request }, env) {
  const { library } = await plans.programmableLibrary(pool);
  const allowed = rules.kitLibrary(library, program);
  const seed = { ...program, sessions: Array.from({ length: count }, (_, i) => ({ title: `Session ${i + 1}`, minutes, patterns: FALLBACK_ROTATION[i % FALLBACK_ROTATION.length] })) };
  const fallback = rules.buildSessions(seed, library);
  if (!aiPlan.configured(env)) return { sessions: fallback, ai: false };
  await aiLimits.check(pool, { feature: "fitness_program", userId: adminId }, env);
  const raw = await dedupe.shared.run(dedupe.requestKey("fitness_program", adminId, program.id, count, minutes, request), () =>
    askStructured(
      {
        feature: "fitness_program",
        instructions: rules.INSTRUCTIONS,
        brief: rules.brief(program, { count, minutes, request, library: allowed }),
        schema: rules.schema,
        fake: rules.fakeAnswer(fallback.length ? fallback : rules.buildSessions({ ...seed, kit: "none" }, library)),
        failure: "The AI couldn't write the sessions right now. Please try again.",
        busy: "The AI is busy right now. Please try again in a minute.",
      },
      env,
      aiUsage.tracker(pool, { feature: "fitness_program", userId: adminId }),
    ),
  );
  const sessions = rules.normalizeSessions(raw, { library: allowed, count });
  if (!sessions) throw new ValidationError("The AI's sessions didn't fit the library. Add matching exercises in Admin › Exercises, then try again.");
  return { sessions, ai: true };
}

/**
 * "Rewrite with AI": the program's sessions replaced by the AI's (as many as it has now, at their
 * usual length). Members who already did a session keep their copy of it.
 */
async function redraft(pool, adminId, programId, { request }, env = process.env) {
  const program = await detail(pool, programId, { admin: true });
  const count = Math.max(1, Math.min(rules.limits.sessions, program.sessionCount || 3));
  const minutes = program.minutes.max || 30;
  const { sessions, ai } = await draftSessions(pool, adminId, program, { count, minutes, request }, env);
  await inTransaction(pool, async (conn) => {
    await removeSessions(conn, programId);
    await writeSessions(conn, programId, sessions);
    await conn.query("UPDATE fitness_programs SET ai_drafted = ? WHERE id = ?", [ai, programId]);
    await audit(conn, adminId, "program.redraft", "program", programId, `Rewrote the sessions of “${program.title}”${ai ? " with AI" : ""}`);
  });
  return detail(pool, programId, { admin: true });
}

/** A new program from the admin, its sessions written by the AI (the library's when it can't) */
async function create(pool, adminId, fields, env = process.env) {
  await ensureCatalog(pool);
  await sections.mustExist(pool, fields.section);
  const draft = { ...fields, id: null };
  const { sessions, ai } = await draftSessions(pool, adminId, draft, { count: fields.sessions, minutes: fields.minutes, request: "" }, env);
  const programId = await inTransaction(pool, async (conn) => {
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    const [[{ next }]] = await conn.query("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM fitness_programs WHERE section = ?", [fields.section]);
    const slug = `${fields.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program"}-${id.slice(0, 8)}`;
    await conn.query(
      `INSERT INTO fitness_programs (id, slug, title, subtitle, description, section, place, level, kit, icon, palette, position, published, ai_drafted, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, fields.title, fields.subtitle, fields.description, fields.section, fields.place, fields.level, fields.kit, fields.icon, fields.palette, next, fields.published ?? true, ai, adminId],
    );
    await writeSessions(conn, id, sessions);
    await audit(conn, adminId, "program.create", "program", id, `Created program “${fields.title}”`);
    return id;
  });
  return detail(pool, programId, { admin: true });
}

// Tests only: check the catalog again on the next read
const resetCatalogCheck = () => { catalogChecked = false; };

module.exports = { ensureCatalog, list, detail, startToday, adminList, update, redraft, create, setCover, removeCover, coverFile, resetCatalogCheck };
