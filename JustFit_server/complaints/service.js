// Complaints about gyms (Gym Hub ecosystem, section 7). Members report a branch they can see (any
// approved, published gym; never a draft) and read only their own reports: status and the
// resolution, never the internal notes. justFit admins read every complaint with its history,
// assign it, add notes and change its status; each step is a complaint_events row and audited.
const { NotFoundError, ConflictError } = require("../errors");
const { audit } = require("../admin/overview");
const rules = require("./rules");
const discover = require("../gym/discover");
const notify = require("../notifications/service");

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function inTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await work(conn);
    await conn.commit();
    return out;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

const memberView = (r) => ({
  id: r.id, gym: { id: r.gym_id, name: r.brand, branch: r.branch }, category: r.category, categoryLabel: rules.CATEGORY_LABEL[r.category],
  status: r.status, statusLabel: rules.STATUS_LABEL[r.status], resolution: r.resolution, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const FROM = "FROM complaints c JOIN gyms g ON g.id = c.gym_id JOIN gym_brands b ON b.id = g.brand_id";
const COLUMNS = "c.id, c.gym_id, c.reporter_id, c.category, c.details, c.status, c.assigned_to, c.resolution, c.created_at, c.updated_at, g.name AS branch, g.city, b.name AS brand";

/** POST /api/complaints: 5 open reports per member at most; one open report per member per gym */
async function report(pool, userId, { gymId, category, details }) {
  await discover.assertVisible(pool, gymId);
  const id = await inTransaction(pool, async (db) => {
    await db.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [open] = await db.query("SELECT gym_id FROM complaints WHERE reporter_id = ? AND status IN ('open', 'investigating')", [userId]);
    if (open.some((o) => o.gym_id === gymId)) throw new ConflictError("You already have an open report about this gym. justFit is looking into it.");
    if (open.length >= 5) throw new ConflictError("You have 5 open reports. Please wait for justFit to answer them.");
    const [made] = await db.query("INSERT INTO complaints (gym_id, reporter_id, category, details) VALUES (?, ?, ?, ?)", [gymId, userId, category, details]);
    await db.query("INSERT INTO complaint_events (complaint_id, kind, status, by_user) VALUES (?, 'created', 'open', ?)", [made.insertId, userId]);
    return made.insertId;
  });
  const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  const [[row]] = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE c.id = ?`, [id]);
  await notify.notify(pool, admins.map((a) => a.id), {
    kind: "platform.complaint", key: `${id}`, title: "New complaint about a gym", body: `${rules.CATEGORY_LABEL[category]}: ${row.brand} ${row.branch}.`, link: `/admin/complaints/${id}`,
  });
  return { complaint: memberView(row) };
}

/** GET /api/complaints: the member's own reports, newest first */
async function mine(pool, userId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE c.reporter_id = ? ORDER BY c.id DESC LIMIT 30`, [userId]);
  return { complaints: rows.map(memberView), categories: rules.CATEGORIES.map((id) => ({ id, label: rules.CATEGORY_LABEL[id] })) };
}

const PAGE = 30;
/** GET /api/admin/portal/complaints */
async function list(pool, { status, page }) {
  const statuses = rules.statusesFor(status);
  const [[rows], [counts]] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS}, u.full_name AS reporter_name, a.full_name AS assignee_name ${FROM} LEFT JOIN users u ON u.id = c.reporter_id LEFT JOIN users a ON a.id = c.assigned_to
       WHERE c.status IN (?) ORDER BY FIELD(c.status, 'open', 'investigating', 'resolved', 'dismissed'), c.id DESC LIMIT ? OFFSET ?`,
      [statuses, PAGE + 1, (page - 1) * PAGE],
    ),
    pool.query("SELECT status, COUNT(*) AS n FROM complaints GROUP BY status"),
  ]);
  const byStatus = Object.fromEntries(rules.STATUSES.map((s) => [s, 0]));
  for (const c of counts) byStatus[c.status] = Number(c.n);
  return {
    page,
    nextPage: rows.length > PAGE ? page + 1 : null,
    counts: { ...byStatus, active: byStatus.open + byStatus.investigating, all: rules.STATUSES.reduce((a, s) => a + byStatus[s], 0) },
    complaints: rows.slice(0, PAGE).map((r) => ({ ...memberView(r), city: r.city, reporter: r.reporter_name?.trim() || "Member", assignee: r.assigned_to ? r.assignee_name?.trim() || "justFit admin" : null, preview: r.details.slice(0, 120) })),
  };
}

/** GET /api/admin/portal/complaints/:id: the whole case with its history */
async function detail(pool, id) {
  const [[r]] = await pool.query(
    `SELECT ${COLUMNS}, u.full_name AS reporter_name, u.verified_phone AS reporter_phone, a.full_name AS assignee_name ${FROM}
     LEFT JOIN users u ON u.id = c.reporter_id LEFT JOIN users a ON a.id = c.assigned_to WHERE c.id = ?`,
    [id],
  );
  if (!r) throw new NotFoundError("That complaint doesn't exist.");
  const [events] = await pool.query(
    "SELECT e.kind, e.status, e.note, e.created_at, u.full_name FROM complaint_events e LEFT JOIN users u ON u.id = e.by_user WHERE e.complaint_id = ? ORDER BY e.id",
    [id],
  );
  const [[others]] = await pool.query("SELECT COUNT(*) AS n FROM complaints WHERE gym_id = ? AND id <> ?", [r.gym_id, id]);
  return {
    complaint: {
      ...memberView(r), city: r.city, details: r.details,
      reporter: { id: r.reporter_id, name: r.reporter_name?.trim() || "Member", phone: r.reporter_phone ? `+91${r.reporter_phone}` : null },
      assignee: r.assigned_to ? { id: r.assigned_to, name: r.assignee_name?.trim() || "justFit admin" } : null,
      otherReportsAboutGym: Number(others.n),
    },
    history: events.map((e) => ({ kind: e.kind, status: e.status, note: e.note, by: e.full_name?.trim() || "Someone", at: iso(e.created_at) })),
  };
}

// The case locked for a change; 404 when missing
async function lockedCase(db, id) {
  const [[row]] = await db.query("SELECT id, status, reporter_id, gym_id FROM complaints WHERE id = ? FOR UPDATE", [id]);
  if (!row) throw new NotFoundError("That complaint doesn't exist.");
  return row;
}

/** POST …/complaints/:id/assign: to the calling admin */
async function assignToMe(pool, adminId, id) {
  await inTransaction(pool, async (db) => {
    await lockedCase(db, id);
    await db.query("UPDATE complaints SET assigned_to = ? WHERE id = ?", [adminId, id]);
    await db.query("INSERT INTO complaint_events (complaint_id, kind, by_user) VALUES (?, 'assigned', ?)", [id, adminId]);
    await audit(db, adminId, "complaint.assign", "gym", null, `Took complaint #${id}`);
  });
  return detail(pool, id);
}

/** POST …/complaints/:id/notes: internal, never shown to the reporter */
async function addNote(pool, adminId, id, { note }) {
  await inTransaction(pool, async (db) => {
    await lockedCase(db, id);
    await db.query("INSERT INTO complaint_events (complaint_id, kind, note, by_user) VALUES (?, 'note', ?, ?)", [id, note, adminId]);
  });
  return detail(pool, id);
}

/** POST …/complaints/:id/status: closing it tells the reporter the resolution */
async function setStatus(pool, adminId, id, { status, resolution }) {
  const row = await inTransaction(pool, async (db) => {
    const c = await lockedCase(db, id);
    const problem = rules.moveProblem(c.status, status);
    if (problem) throw new ConflictError(problem);
    await db.query("UPDATE complaints SET status = ?, resolution = COALESCE(?, resolution) WHERE id = ?", [status, resolution, id]);
    await db.query("INSERT INTO complaint_events (complaint_id, kind, status, note, by_user) VALUES (?, 'status', ?, ?, ?)", [id, status, resolution, adminId]);
    await audit(db, adminId, `complaint.${status}`, "gym", c.gym_id, `Complaint #${id} is ${rules.STATUS_LABEL[status].toLowerCase()}`);
    return c;
  });
  if (rules.CLOSED.includes(status) && row.reporter_id) {
    await notify.notify(pool, [row.reporter_id], {
      kind: "gym.complaint_update", key: `${id}:${status}:${Date.now()}`, title: status === "resolved" ? "Your report is resolved" : "Your report is closed", body: resolution ?? "justFit has closed your report.", link: null,
    });
  }
  return detail(pool, id);
}

module.exports = { report, mine, list, detail, assignToMe, addNote, setStatus };
