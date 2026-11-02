// The Fitness tab's categories ("sections", table fitness_sections): the six built in (the
// starter catalog's, added the first time programs are read) and any the admin creates in
// Admin › Programs › Categories. The admin renames them, changes their note and card layout,
// reorders, shows or hides them; a category they made can be deleted while it has no programs
// (the foreign key from fitness_programs refuses it otherwise too). Every change is audited.
const { audit } = require("../admin/overview");
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const rules = require("./rules");

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

/** Adds the six built-in categories the table doesn't have yet (an admin's edits are kept) */
async function ensureBuiltIn(db) {
  const { SECTION_ORDER, SECTION_TITLE, SECTION_NOTE, SECTION_LAYOUT } = rules.catalog;
  await db.query(
    `INSERT IGNORE INTO fitness_sections (slug, title, note, layout, position, built_in) VALUES ${SECTION_ORDER.map(() => "(?, ?, ?, ?, ?, TRUE)").join(", ")}`,
    SECTION_ORDER.flatMap((slug, i) => [slug, SECTION_TITLE[slug], SECTION_NOTE[slug], SECTION_LAYOUT[slug], i]),
  );
}

const sectionOf = (row) => ({
  id: row.slug,
  title: row.title,
  note: row.note,
  layout: row.layout,
  position: Number(row.position),
  published: Boolean(row.published),
  builtIn: Boolean(row.built_in),
  ...(row.program_count !== undefined ? { programCount: Number(row.program_count) } : {}),
});

/** Every category in order; `published` only for the Fitness tab */
async function all(db, { published = false } = {}) {
  const [rows] = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM fitness_programs p WHERE p.section = s.slug) AS program_count
       FROM fitness_sections s${published ? " WHERE s.published = TRUE" : ""} ORDER BY s.position, s.slug`,
  );
  return rows.map(sectionOf);
}

async function one(db, slug) {
  const [[row]] = await db.query(
    "SELECT s.*, (SELECT COUNT(*) FROM fitness_programs p WHERE p.section = s.slug) AS program_count FROM fitness_sections s WHERE s.slug = ?",
    [slug],
  );
  if (!row) throw new NotFoundError("That category doesn't exist.");
  return sectionOf(row);
}

/** Refuses a program's category that doesn't exist (a ValidationError, so the admin sees why) */
async function mustExist(db, slug) {
  const [[row]] = await db.query("SELECT slug FROM fitness_sections WHERE slug = ?", [slug]);
  if (!row) throw new ValidationError("Choose a category.");
}

/** A new category at the end of the list; its key comes from its name (made unique) */
async function create(pool, adminId, fields) {
  return inTransaction(pool, async (conn) => {
    // The whole list is locked while the key and position are chosen, so two at once can't clash
    const [rows] = await conn.query("SELECT slug, title, position FROM fitness_sections FOR UPDATE");
    if (rows.some((r) => r.title.toLowerCase() === fields.title.toLowerCase())) throw new ValidationError("There's already a category with that name.");
    const base = rules.slugFor(fields.title);
    const taken = new Set(rows.map((r) => r.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}_${n}`;
    const position = rows.reduce((max, r) => Math.max(max, Number(r.position) + 1), 0);
    await conn.query(
      "INSERT INTO fitness_sections (slug, title, note, layout, position, published, built_in, created_by) VALUES (?, ?, ?, ?, ?, ?, FALSE, ?)",
      [slug, fields.title, fields.note, fields.layout, position, fields.published ?? true, adminId],
    );
    await audit(conn, adminId, "section.create", "section", slug, `Created category “${fields.title}”`);
    return one(conn, slug);
  });
}

const COLUMN = { title: "title", note: "note", layout: "layout", published: "published" };

/** Saves an admin's edits to a category (the column names come from COLUMN, never the request) */
async function update(pool, adminId, slug, fields) {
  return inTransaction(pool, async (conn) => {
    const [[before]] = await conn.query("SELECT title FROM fitness_sections WHERE slug = ? FOR UPDATE", [slug]);
    if (!before) throw new NotFoundError("That category doesn't exist.");
    const keys = Object.keys(fields).filter((k) => COLUMN[k]);
    if (keys.length === 0) return one(conn, slug);
    if (fields.title !== undefined) {
      const [[clash]] = await conn.query("SELECT slug FROM fitness_sections WHERE LOWER(title) = LOWER(?) AND slug <> ?", [fields.title, slug]);
      if (clash) throw new ValidationError("There's already a category with that name.");
    }
    await conn.query(`UPDATE fitness_sections SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(", ")} WHERE slug = ?`, [...keys.map((k) => fields[k]), slug]);
    const what = keys.length === 1 && keys[0] === "published" ? (fields.published ? "Showed" : "Hid") : "Edited";
    await audit(conn, adminId, `section.${what === "Edited" ? "edit" : what === "Showed" ? "show" : "hide"}`, "section", slug, `${what} category “${fields.title ?? before.title}”`);
    return one(conn, slug);
  });
}

/** Moves a category one place up or down; the list is renumbered 0, 1, 2… → every category in order */
async function move(pool, adminId, slug, direction) {
  await inTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT slug, title FROM fitness_sections ORDER BY position, slug FOR UPDATE");
    const at = rows.findIndex((r) => r.slug === slug);
    if (at === -1) throw new NotFoundError("That category doesn't exist.");
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= rows.length) return;
    [rows[at], rows[to]] = [rows[to], rows[at]];
    for (const [i, r] of rows.entries()) await conn.query("UPDATE fitness_sections SET position = ? WHERE slug = ?", [i, r.slug]);
    await audit(conn, adminId, "section.move", "section", slug, `Moved category “${rows[to].title}” ${direction}`);
  });
  return all(pool);
}

/** Deletes a category the admin made, only while no program is in it */
async function remove(pool, adminId, slug) {
  await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT title, built_in FROM fitness_sections WHERE slug = ? FOR UPDATE", [slug]);
    if (!row) throw new NotFoundError("That category doesn't exist.");
    if (row.built_in) throw new ValidationError("Built-in categories can't be deleted. Hide it instead.");
    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM fitness_programs WHERE section = ? FOR UPDATE", [slug]);
    if (n > 0) throw new ValidationError(`Move its ${n} program${n === 1 ? "" : "s"} to another category first.`);
    await conn.query("DELETE FROM fitness_sections WHERE slug = ?", [slug]);
    await audit(conn, adminId, "section.delete", "section", slug, `Deleted category “${row.title}”`);
  });
}

module.exports = { ensureBuiltIn, all, one, mustExist, create, update, move, remove };
