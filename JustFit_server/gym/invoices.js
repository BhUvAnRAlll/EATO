// Invoices (2026-11-07): one payment's invoice, read for the Invoice screen, and the branch's
// Invoice details. Every read is scoped to the caller's branch (req.gym), never to an id alone.
// Numbers: a payment saved after migration 2026-12-07-gym-invoices.sql gets its number when it is
// saved (service.addPayment); an older payment gets the branch's next number the first time its
// invoice is opened, inside a transaction with the branch's counter locked, so two opens never
// share one. Before the migration the routes answer 503 naming it (routes.js).
const { NotFoundError } = require("../errors");
const { audit } = require("../admin/overview");
const invoiceRules = require("./invoiceRules");
const { inTransaction } = require("./service");

const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;
const PAYMENT = `p.id, p.kind, p.title, p.detail, p.method, p.amount, ${DAY("p.paid_on")} AS paid_on, p.member_id, p.invoice_no`;
const MEMBER = `m.id AS m_id, m.full_name, m.member_code, m.phone AS m_phone, m.email AS m_email, m.plan_months, m.plan_days, ${DAY("m.expires_on")} AS expires_on, m.due_amount, ${DAY("m.due_by")} AS due_by`;

// The branch's next invoice number, with the counter row locked (call inside a transaction)
async function nextInvoiceNo(db, gymId) {
  const [[row]] = await db.query("SELECT next_invoice_no FROM gyms WHERE id = ? FOR UPDATE", [gymId]);
  await db.query("UPDATE gyms SET next_invoice_no = next_invoice_no + 1 WHERE id = ?", [gymId]);
  return row.next_invoice_no;
}

// Numbers a payment that has none yet (saved before the migration); answers the number
async function numberPayment(pool, gymId, paymentId) {
  return inTransaction(pool, async (db) => {
    const [[row]] = await db.query("SELECT invoice_no FROM gym_payments WHERE id = ? AND gym_id = ? FOR UPDATE", [paymentId, gymId]);
    if (!row) throw new NotFoundError("That payment isn't at your gym.");
    if (row.invoice_no) return row.invoice_no;
    const number = await nextInvoiceNo(db, gymId);
    await db.query("UPDATE gym_payments SET invoice_no = ? WHERE id = ? AND gym_id = ?", [number, paymentId, gymId]);
    return number;
  });
}

const memberOf = (row) => (row.m_id ? { id: row.m_id, full_name: row.full_name, member_code: row.member_code, phone: row.m_phone, email: row.m_email, plan_months: row.plan_months, plan_days: row.plan_days, expires_on: row.expires_on, due_amount: row.due_amount, due_by: row.due_by } : null);

// The invoice of one payment (by payment id), or of a member's latest payment (by member id)
async function invoice(pool, gym, { paymentId = null, memberId = null }, today) {
  const where = paymentId ? "p.id = ? AND p.gym_id = ?" : "p.member_id = ? AND p.gym_id = ?";
  const [[row]] = await pool.query(
    `SELECT ${PAYMENT}, ${MEMBER} FROM gym_payments p LEFT JOIN gym_members m ON m.id = p.member_id WHERE ${where} ORDER BY p.paid_on DESC, p.id DESC LIMIT 1`,
    [paymentId ?? memberId, gym.id],
  );
  if (!row) {
    if (paymentId) throw new NotFoundError("That payment isn't at your gym.");
    const [[member]] = await pool.query("SELECT id FROM gym_members WHERE id = ? AND gym_id = ?", [memberId, gym.id]);
    if (!member) throw new NotFoundError("That member isn't at your gym.");
    throw new NotFoundError("No payments yet, so there's no invoice to send.");
  }
  const invoiceNo = row.invoice_no ?? (await numberPayment(pool, gym.id, row.id));
  const details = await invoiceDetails(pool, gym.id);
  return invoiceRules.invoiceOf({ payment: { ...row, invoice_no: invoiceNo }, member: memberOf(row), gym: { ...gym, ...details }, today });
}

// Branch details › Invoice details: what's printed on every invoice
async function invoiceDetails(pool, gymId) {
  const [[row]] = await pool.query("SELECT address, phone, gstin FROM gyms WHERE id = ?", [gymId]);
  return { address: row?.address ?? null, phone: row?.phone ?? null, gstin: row?.gstin ?? null };
}

async function updateInvoiceDetails(pool, gym, userId, fields) {
  const keys = Object.keys(fields);
  await inTransaction(pool, async (db) => {
    await db.query(`UPDATE gyms SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => fields[k]), gym.id]);
    await audit(db, userId, "gym.edit", "gym", gym.id, `The gym admin edited the invoice details of ${gym.brand}’s ${gym.branch} branch`);
  });
  return invoiceDetails(pool, gym.id);
}

module.exports = { invoice, invoiceDetails, updateInvoiceDetails, nextInvoiceNo };
