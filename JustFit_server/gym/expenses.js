// Gym expenses (Manage › Expense, 2026-11-08): each branch's spending, listed a month at a time
// with the month's totals, added and edited by the gym admin and the Staff given the Expenses area,
// deleted by the gym admin only (audited, with the bill's file). Every query is scoped to the
// caller's branch (req.gym.id), never to a branch named in the request.
const { audit } = require("../admin/overview");
const { NotFoundError } = require("../errors");
const expenseRules = require("./expenseRules");
const rules = require("./rules");
const { inTransaction } = require("./service");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const COLUMNS = `id, category, title, paid_to, method, amount, ${DAY("spent_on")} AS spent_on, note, bill_key`;

// billUrl: the bill photo (gym/expenseBills.js), read with the session; ?v= changes with the file
const expenseOf = (r) => ({
  id: r.id,
  category: r.category,
  title: r.title ?? null,
  paidTo: r.paid_to ?? null,
  method: r.method,
  amount: r.amount,
  spentOn: r.spent_on,
  note: r.note ?? null,
  billUrl: r.bill_key ? `/api/gym/expenses/${r.id}/bill?v=${r.bill_key.slice(0, 8)}` : null,
});

// The search's bound SQL: the title, who was paid, the note
function searchSql(search) {
  if (!search) return { sql: "", params: [] };
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return { sql: " AND (title LIKE ? OR paid_to LIKE ? OR note LIKE ?)", params: [like, like, like] };
}

/**
 * One month of the branch's expenses, newest first, 50 a page. `summary` is the whole month
 * (total, online, cash, whatever the filters); `counts` and `totals` are per category within the
 * search, so each chip shows what tapping it would list.
 */
async function list(pool, gymId, { month, from, to, category, search, page }) {
  const found = searchSql(search);
  const base = `FROM gym_expenses WHERE gym_id = ? AND spent_on BETWEEN ? AND ?`;
  const where = `${base}${found.sql}${category ? " AND category = ?" : ""}`;
  const params = [gymId, from, to, ...found.params, ...(category ? [category] : [])];
  const size = rules.limits.page;
  const [[rows], [byCategory], [[month_]]] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} ${where} ORDER BY spent_on DESC, id DESC LIMIT ? OFFSET ?`, [...params, size + 1, (page - 1) * size]),
    pool.query(`SELECT category, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total ${base}${found.sql} GROUP BY category`, [gymId, from, to, ...found.params]),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(CASE WHEN method = 'online' THEN amount END), 0) AS online,
              COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END), 0) AS cash,
              COUNT(*) AS n
       ${base}`,
      [gymId, from, to],
    ),
  ]);
  const counts = { all: 0 };
  const totals = { all: 0 };
  for (const c of expenseRules.CATEGORIES) { counts[c] = 0; totals[c] = 0; }
  for (const r of byCategory) {
    counts[r.category] = Number(r.n);
    totals[r.category] = Number(r.total);
    counts.all += Number(r.n);
    totals.all += Number(r.total);
  }
  return {
    month,
    summary: { total: Number(month_.total), online: Number(month_.online), cash: Number(month_.cash), count: Number(month_.n) },
    counts,
    totals,
    expenses: rows.slice(0, size).map(expenseOf),
    page,
    nextPage: rows.length > size ? page + 1 : null,
  };
}

/** One of the branch's expenses → { expense }; 404 for another branch's */
async function one(pool, gymId, expenseId) {
  const [[row]] = await pool.query(`SELECT ${COLUMNS} FROM gym_expenses WHERE id = ? AND gym_id = ?`, [expenseId, gymId]);
  if (!row) throw new NotFoundError("That expense isn't at your branch.");
  return { expense: expenseOf(row) };
}

async function add(pool, gymId, userId, e) {
  const [result] = await pool.query(
    "INSERT INTO gym_expenses (gym_id, category, title, paid_to, method, amount, spent_on, note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [gymId, e.category, e.title, e.paidTo, e.method, e.amount, e.spentOn, e.note, userId, userId],
  );
  return one(pool, gymId, result.insertId);
}

// An edit replaces every field (the sheet sends them all); the change is audited with the old amount
async function edit(pool, gym, userId, expenseId, e) {
  await inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query("SELECT amount, category FROM gym_expenses WHERE id = ? AND gym_id = ? FOR UPDATE", [expenseId, gym.id]);
    if (!row) throw new NotFoundError("That expense isn't at your branch.");
    await conn.query(
      "UPDATE gym_expenses SET category = ?, title = ?, paid_to = ?, method = ?, amount = ?, spent_on = ?, note = ?, updated_by = ? WHERE id = ? AND gym_id = ?",
      [e.category, e.title, e.paidTo, e.method, e.amount, e.spentOn, e.note, userId, expenseId, gym.id],
    );
    await audit(conn, userId, "gym.expense_edit", "gym", gym.id, `Edited expense #${expenseId} at ${gym.brand}’s ${gym.branch} branch (${row.category} ₹${row.amount} → ${e.category} ₹${e.amount})`);
  });
  return one(pool, gym.id, expenseId);
}

/** Deletes one of the branch's expenses (audited) → the bill's file name to delete, or null */
async function remove(pool, gym, userId, expenseId) {
  return inTransaction(pool, async (conn) => {
    const [[row]] = await conn.query(`SELECT ${COLUMNS} FROM gym_expenses WHERE id = ? AND gym_id = ? FOR UPDATE`, [expenseId, gym.id]);
    if (!row) throw new NotFoundError("That expense isn't at your branch.");
    await conn.query("DELETE FROM gym_expenses WHERE id = ? AND gym_id = ?", [expenseId, gym.id]);
    await audit(conn, userId, "gym.expense_delete", "gym", gym.id, `Deleted expense #${expenseId} at ${gym.brand}’s ${gym.branch} branch (${row.category} ₹${row.amount} on ${row.spent_on})`);
    return row.bill_key ?? null;
  });
}

/**
 * Today's and the month's spending for Wallet → { today, month } in rupees. Before the migration
 * there is no table: null, and Wallet shows no expense lines.
 */
async function spent(pool, gymId, today) {
  try {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN spent_on = ? THEN amount END), 0) AS today, COALESCE(SUM(amount), 0) AS month
       FROM gym_expenses WHERE gym_id = ? AND spent_on BETWEEN ? AND ?`,
      [today, gymId, `${today.slice(0, 8)}01`, today],
    );
    return { today: Number(row.today), month: Number(row.month) };
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return null;
    throw error;
  }
}

module.exports = { list, one, add, edit, remove, spent, expenseOf };
