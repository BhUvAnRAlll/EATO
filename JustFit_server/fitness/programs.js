// The Fitness tab's programs (asked for by the user on 2026-11-02): free programs in sections,
// for home, the center or both. Since 2026-11-03 a program's sessions are YouTube videos the
// admin adds (a title, minutes and one video link, embedded in the app, never uploaded); members
// browse and search the programs and play the videos on a program's page. No AI writes sessions.
//
// The starter programs come from JustFit_client/src/lib/fitness/catalog.ts, added the first time
// the list is read, with no sessions. The exercise sessions written before 2026-11-03 stay in the
// table (members' past workout days point at them) but are never shown. Nothing cascades.
const rules = require("./rules");
const plans = require("../workout/plans");
const { audit } = require("../admin/overview");
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const covers = require("./covers");
const sections = require("./sections");
const youtube = require("./youtube");


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

// Numbers a program's sessions 0, 1, 2… in their current order (through 100+ first, as the
// position is unique per program)
async function renumberSessions(conn, programId) {
  const [rows] = await conn.query("SELECT id FROM fitness_program_sessions WHERE program_id = ? ORDER BY position", [programId]);
  await conn.query("UPDATE fitness_program_sessions SET position = position + 100 WHERE program_id = ?", [programId]);
  for (const [i, row] of rows.entries()) await conn.query("UPDATE fitness_program_sessions SET position = ? WHERE id = ?", [i, row.id]);
}

// ---- the starter catalog --------------------------------------------------------------------

let catalogChecked = false;

/**
 * Adds the catalog's programs the table doesn't have yet (by slug; an admin's edits are kept).
 * They start with no sessions: the admin adds video sessions. Checked once per server start.
 */
async function ensureCatalog(pool) {
  if (catalogChecked) return;
  await sections.ensureBuiltIn(pool);
  await plans.syncLibrary(pool);
  const [existing] = await pool.query("SELECT slug FROM fitness_programs");
  const have = new Set(existing.map((r) => r.slug));
  for (const [i, seed] of rules.catalog.PROGRAMS.entries()) {
    if (have.has(seed.slug)) continue;
    await pool.query(
      `INSERT IGNORE INTO fitness_programs (id, slug, title, subtitle, description, section, place, level, kit, icon, palette, position, built_in)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [seed.slug, seed.title, seed.subtitle, seed.description, seed.section, seed.place, seed.level, seed.kit, seed.icon, seed.palette, i],
    );
  }
  catalogChecked = true;
}

// ---- reading -----------------------------------------------------------------------------

// A program's two photos, the card's cover and the program page's photo (hero): their columns and
// the words used in the audit log. Column names come only from here, never from a request.
const PHOTOS = {
  cover: { key: "cover_key", updated: "cover_updated_at", noun: "cover", missing: "That program has no cover." },
  hero: { key: "hero_key", updated: "hero_updated_at", noun: "page photo", missing: "That program has no page photo." },
};

const PROGRAM_COLUMNS = `p.id, p.slug, p.title, p.subtitle, p.description, p.section, p.place, p.level, p.kit, p.icon, p.palette, p.cover_key, p.cover_updated_at, p.hero_key, p.hero_updated_at, p.position, p.published, p.built_in, p.ai_drafted,
  (SELECT fs.title FROM fitness_sections fs WHERE fs.slug = p.section) AS section_title,
  (SELECT COUNT(*) FROM fitness_program_sessions s WHERE s.program_id = p.id AND s.youtube_id IS NOT NULL) AS session_count,
  (SELECT MIN(s.minutes) FROM fitness_program_sessions s WHERE s.program_id = p.id AND s.youtube_id IS NOT NULL) AS min_minutes,
  (SELECT MAX(s.minutes) FROM fitness_program_sessions s WHERE s.program_id = p.id AND s.youtube_id IS NOT NULL) AS max_minutes`;

// Where the app reads a program's cover (null: no cover, the palette's gradient). Members read
// published programs' covers; the admin's route also serves hidden ones. `v` changes with each
// new cover, so the long cache on the answer never shows an old one.
// The program page's own photo (heroUrl) works the same way at /hero.
const photoUrlOf = (row, admin, kind) =>
  row[PHOTOS[kind].key]
    ? `${admin ? "/api/admin/portal/programs" : "/api/fitness/programs"}/${encodeURIComponent(row.id)}/${kind}?v=${new Date(row[PHOTOS[kind].updated] ?? 0).getTime()}`
    : null;
const coverUrlOf = (row, admin) => photoUrlOf(row, admin, "cover");

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
  // Programs without video sessions yet are shown too ("Coming soon" in the app)
  const usable = rows.filter((r) => matches(r, search));
  return {
    place,
    search,
    sections: (await sections.all(pool, { published: true }))
      .map((section) => ({ id: section.id, title: section.title, note: section.note, layout: section.layout, programs: usable.filter((r) => r.section === section.id).map((r) => cardOf(r)) }))
      .filter((section) => section.programs.length > 0),
  };
}

/**
 * One program in full: its card, description, and its sessions, each a YouTube video (the
 * creator's name only while YouTube's answer is under KEEP_DAYS old). Sessions without a video
 * (the exercise sessions from before 2026-11-03) are kept in the table but never shown.
 */
async function detail(pool, programId, { admin = false } = {}) {
  await ensureCatalog(pool);
  const [[row]] = await pool.query(`SELECT ${PROGRAM_COLUMNS} FROM fitness_programs p WHERE p.id = ?${admin ? "" : " AND p.published = TRUE"}`, [programId]);
  if (!row) throw new NotFoundError("That program doesn't exist.");
  const [sessions] = await pool.query(
    `SELECT id, position, title, minutes, youtube_id, youtube_channel,
       (youtube_synced_at IS NOT NULL AND youtube_synced_at > NOW() - INTERVAL ${youtube.KEEP_DAYS} DAY) AS channel_fresh
     FROM fitness_program_sessions WHERE program_id = ? AND youtube_id IS NOT NULL ORDER BY position`,
    [programId],
  );
  return {
    ...cardOf(row, admin),
    // The photo at the top of the program's screen (not the card's cover); null: the gradient
    heroUrl: photoUrlOf(row, admin, "hero"),
    description: row.description,
    kit: row.kit,
    source: row.built_in ? "built_in" : "admin",
    aiDrafted: Boolean(row.ai_drafted),
    // Each session is a YouTube video played on the page (the app embeds YouTube's own player)
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      minutes: s.minutes,
      video: { id: s.youtube_id, channel: s.channel_fresh ? s.youtube_channel || null : null },
    })),
  };
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

// ---- the sessions the admin adds and edits ------------------------------------------------------

/**
 * Reads a session video's creator from YouTube (fitness/youtube.js) and saves it with the time,
 * for the credit under the player → null, or why YouTube couldn't be asked (the video is saved
 * either way; the refresh job tries again)
 */
async function loadSessionChannel(pool, sessionId, videoId, env = process.env) {
  try {
    const { channel } = await youtube.fetchVideos({ kind: "video", id: videoId }, env);
    await pool.query("UPDATE fitness_program_sessions SET youtube_channel = ?, youtube_synced_at = NOW() WHERE id = ? AND youtube_id = ?", [channel || null, sessionId, videoId]);
    return null;
  } catch (error) {
    if (!(error instanceof youtube.YouTubeError)) throw error;
    return error.message;
  }
}

// The program row locked for a session change, and the session (when given) checked to be its own
async function lockSession(conn, programId, sessionId) {
  const [[program]] = await conn.query("SELECT title FROM fitness_programs WHERE id = ? FOR UPDATE", [programId]);
  if (!program) throw new NotFoundError("That program doesn't exist.");
  if (!sessionId) return { program };
  const [[session]] = await conn.query("SELECT id, title, position, youtube_id FROM fitness_program_sessions WHERE id = ? AND program_id = ? AND youtube_id IS NOT NULL", [sessionId, programId]);
  if (!session) throw new NotFoundError("That session isn't in the program.");
  return { program, session };
}

// The program as the admin sees it, with `videoError` when the video's creator couldn't be read
async function withVideo(pool, programId, sessionId, videoId, env) {
  const videoError = videoId ? await loadSessionChannel(pool, sessionId, videoId, env) : null;
  const program = await detail(pool, programId, { admin: true });
  return videoError ? { ...program, videoError } : program;
}

/** Adds a session at the end: { title, minutes, youtubeId } (fitness/rules.js sessionBody) */
async function addSession(pool, adminId, programId, fields, env = process.env) {
  const sessionId = await inTransaction(pool, async (conn) => {
    const { program } = await lockSession(conn, programId);
    const [[{ n, next }]] = await conn.query("SELECT COUNT(youtube_id) AS n, COALESCE(MAX(position) + 1, 0) AS next FROM fitness_program_sessions WHERE program_id = ?", [programId]);
    if (Number(n) >= rules.limits.allSessions) throw new ValidationError(`A program has at most ${rules.limits.allSessions} sessions.`);
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    await conn.query("INSERT INTO fitness_program_sessions (id, program_id, position, title, minutes, youtube_id) VALUES (?, ?, ?, ?, ?, ?)", [id, programId, next, fields.title, fields.minutes, fields.youtubeId]);
    await audit(conn, adminId, "program.session_add", "program", programId, `Added the session “${fields.title}” to “${program.title}”`);
    return id;
  });
  return withVideo(pool, programId, sessionId, fields.youtubeId, env);
}

/** Edits a session's title, minutes or video (a session always keeps one) */
async function editSession(pool, adminId, programId, sessionId, fields, env = process.env) {
  const videoChanged = await inTransaction(pool, async (conn) => {
    const { program, session } = await lockSession(conn, programId, sessionId);
    const changed = fields.youtubeId !== undefined && fields.youtubeId !== session.youtube_id;
    const sets = [];
    const values = [];
    if (fields.title !== undefined) { sets.push("title = ?"); values.push(fields.title); }
    if (fields.minutes !== undefined) { sets.push("minutes = ?"); values.push(fields.minutes); }
    if (changed) {
      // A new video's creator is read again (the old one's credit goes)
      sets.push("youtube_id = ?", "youtube_channel = NULL", "youtube_synced_at = NULL");
      values.push(fields.youtubeId);
    }
    if (sets.length) await conn.query(`UPDATE fitness_program_sessions SET ${sets.join(", ")} WHERE id = ?`, [...values, sessionId]);
    await audit(conn, adminId, "program.session_edit", "program", programId, `Edited the session “${fields.title ?? session.title}” of “${program.title}”`);
    return changed;
  });
  return withVideo(pool, programId, sessionId, videoChanged ? fields.youtubeId : null, env);
}

/** Deletes a session; the others close up */
async function removeSession(pool, adminId, programId, sessionId) {
  await inTransaction(pool, async (conn) => {
    const { program, session } = await lockSession(conn, programId, sessionId);
    await conn.query("DELETE FROM fitness_program_sessions WHERE id = ?", [sessionId]);
    await renumberSessions(conn, programId);
    await audit(conn, adminId, "program.session_remove", "program", programId, `Deleted the session “${session.title}” of “${program.title}”`);
  });
  return detail(pool, programId, { admin: true });
}

/** Moves a session one place up or down (the first can't go up, the last can't go down) */
async function moveSession(pool, adminId, programId, sessionId, direction) {
  await inTransaction(pool, async (conn) => {
    const { program, session } = await lockSession(conn, programId, sessionId);
    const [[neighbour]] = await conn.query(
      `SELECT id, position FROM fitness_program_sessions WHERE program_id = ? AND youtube_id IS NOT NULL AND position ${direction === "up" ? "<" : ">"} ? ORDER BY position ${direction === "up" ? "DESC" : "ASC"} LIMIT 1`,
      [programId, session.position],
    );
    if (!neighbour) return;
    await conn.query("UPDATE fitness_program_sessions SET position = 255 WHERE id = ?", [session.id]);
    await conn.query("UPDATE fitness_program_sessions SET position = ? WHERE id = ?", [session.position, neighbour.id]);
    await conn.query("UPDATE fitness_program_sessions SET position = ? WHERE id = ?", [neighbour.position, session.id]);
    await audit(conn, adminId, "program.session_move", "program", programId, `Moved the session “${session.title}” of “${program.title}” ${direction}`);
  });
  return detail(pool, programId, { admin: true });
}

// ---- the cover photo and the page photo -------------------------------------------------------

/**
 * Puts a checked photo (fitness/covers.js checkCover) on the program as its cover (`kind` "cover")
 * or its page photo ("hero"), replacing the one it had: the new file is written first, the program
 * then points at it, and only then is the old file deleted, so members never get a missing photo.
 * Two uploads at once each delete the file they replaced (the row is locked while it changes).
 * Answers the program as the admin sees it.
 */
async function setPhoto(pool, adminId, programId, { bytes, mediaType }, env = process.env, kind = "cover") {
  const photo = PHOTOS[kind];
  await detail(pool, programId, { admin: true }); // a 404 before anything is written
  const key = await covers.save(bytes, mediaType, env);
  let replaced;
  try {
    replaced = await inTransaction(pool, async (conn) => {
      const [[row]] = await conn.query(`SELECT title, ${photo.key} AS photo_key FROM fitness_programs WHERE id = ? FOR UPDATE`, [programId]);
      if (!row) throw new NotFoundError("That program doesn't exist.");
      await conn.query(`UPDATE fitness_programs SET ${photo.key} = ?, ${photo.updated} = NOW(3) WHERE id = ?`, [key, programId]);
      await audit(conn, adminId, `program.${kind}_${row.photo_key ? "replace" : "add"}`, "program", programId, `${row.photo_key ? "Replaced" : "Added"} the ${photo.noun} of “${row.title}”`);
      return row.photo_key;
    });
  } catch (error) {
    await covers.remove(key, env).catch(() => {});
    throw error;
  }
  if (replaced) await covers.remove(replaced, env).catch((error) => console.error(`Program ${kind} cleanup failed: ${error?.code ?? "unknown"}`));
  return detail(pool, programId, { admin: true });
}

/** Takes the cover or the page photo off (the gradient shows again) and deletes its file */
async function removePhoto(pool, adminId, programId, env = process.env, kind = "cover") {
  const photo = PHOTOS[kind];
  await detail(pool, programId, { admin: true });
  const removed = await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query(`SELECT title, ${photo.key} AS photo_key FROM fitness_programs WHERE id = ? FOR UPDATE`, [programId]);
    if (!row) throw new NotFoundError("That program doesn't exist.");
    if (!row.photo_key) return null;
    await conn.query(`UPDATE fitness_programs SET ${photo.key} = NULL, ${photo.updated} = NOW(3) WHERE id = ?`, [programId]);
    await audit(conn, adminId, `program.${kind}_remove`, "program", programId, `Removed the ${photo.noun} of “${row.title}”`);
    return row.photo_key;
  });
  if (removed) await covers.remove(removed, env).catch((error) => console.error(`Program ${kind} cleanup failed: ${error?.code ?? "unknown"}`));
  return detail(pool, programId, { admin: true });
}

/** The cover's or page photo's file (members: published programs only) → { bytes, mediaType }; 404 when there is none */
async function photoFile(pool, programId, { admin = false } = {}, env = process.env, kind = "cover") {
  const photo = PHOTOS[kind];
  const [[row]] = await pool.query(`SELECT ${photo.key} AS photo_key FROM fitness_programs WHERE id = ?${admin ? "" : " AND published = TRUE"}`, [programId]);
  const file = row?.photo_key ? await covers.read(row.photo_key, env) : null;
  if (!file) throw new NotFoundError(photo.missing);
  return file;
}

const setCover = (pool, adminId, programId, checked, env) => setPhoto(pool, adminId, programId, checked, env, "cover");
const removeCover = (pool, adminId, programId, env) => removePhoto(pool, adminId, programId, env, "cover");
const coverFile = (pool, programId, options, env) => photoFile(pool, programId, options, env, "cover");
const setHero = (pool, adminId, programId, checked, env) => setPhoto(pool, adminId, programId, checked, env, "hero");
const removeHero = (pool, adminId, programId, env) => removePhoto(pool, adminId, programId, env, "hero");
const heroFile = (pool, programId, options, env) => photoFile(pool, programId, options, env, "hero");

/** A new program from the admin, with no sessions yet (the admin adds video sessions next) */
async function create(pool, adminId, fields) {
  await ensureCatalog(pool);
  await sections.mustExist(pool, fields.section);
  const programId = await inTransaction(pool, async (conn) => {
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    const [[{ next }]] = await conn.query("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM fitness_programs WHERE section = ?", [fields.section]);
    const slug = `${fields.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program"}-${id.slice(0, 8)}`;
    await conn.query(
      `INSERT INTO fitness_programs (id, slug, title, subtitle, description, section, place, level, kit, icon, palette, position, published, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, fields.title, fields.subtitle, fields.description, fields.section, fields.place, fields.level, fields.kit, fields.icon, fields.palette, next, fields.published ?? true, adminId],
    );
    await audit(conn, adminId, "program.create", "program", id, `Created program “${fields.title}”`);
    return id;
  });
  return detail(pool, programId, { admin: true });
}

// Tests only: check the catalog again on the next read
const resetCatalogCheck = () => { catalogChecked = false; };

module.exports = { ensureCatalog, list, detail, adminList, update, create, setCover, removeCover, coverFile, setHero, removeHero, heroFile, addSession, editSession, removeSession, moveSession, loadSessionChannel, resetCatalogCheck };
