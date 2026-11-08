// Invoices (2026-11-07, the user's request): pure rules, no database. The invoice number, the
// Invoice details a gym admin can print on every invoice (address, phone, GSTIN), and the shape
// of one payment's invoice as the app's Invoice screen shows it. gym/invoices.js does the reading.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");
const rules = require("./rules");

const ADDRESS_MAX = 160;
// A GSTIN: 2 digits of the state, the PAN (5 letters, 4 digits, 1 letter), the entity number,
// the letter Z and a check character (15 characters in all)
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const DETAIL_KEYS = ["address", "phone", "gstin"];

// "INV-FOR-TUM-0001": the member codes' letters with the branch's running number
function invoiceNumber(gymName, branchName, number) {
  return `INV-${rules.memberCode(gymName, branchName, number)}`;
}

// PATCH /api/gym/invoice-details { address?, phone?, gstin? }: each field given is set, and an
// empty one clears it. Only the keys sent change; nothing sent is refused.
function invoiceDetailsBody(body) {
  rules.onlyKeys(body, DETAIL_KEYS);
  const out = {};
  if (body.address !== undefined) {
    if (typeof body.address !== "string" || body.address.length > ADDRESS_MAX * 2) throw new ValidationError("Enter the address.");
    const address = rules.cleanText(body.address, ADDRESS_MAX + 1);
    if (address.length > ADDRESS_MAX) throw new ValidationError(`Keep the address to ${ADDRESS_MAX} characters.`);
    out.address = address || null;
  }
  if (body.phone !== undefined) {
    if (body.phone !== null && typeof body.phone !== "string") throw new ValidationError("Enter the gym's mobile number.");
    out.phone = body.phone === null || body.phone.trim() === "" ? null : normalizePhone(body.phone);
  }
  if (body.gstin !== undefined) {
    if (body.gstin !== null && typeof body.gstin !== "string") throw new ValidationError("Enter the GSTIN.");
    const gstin = (body.gstin ?? "").replace(/\s+/g, "").toUpperCase();
    if (gstin && !GSTIN.test(gstin)) throw new ValidationError("That doesn't look like a GSTIN (15 characters, like 29ABCDE1234F1Z5).");
    out.gstin = gstin || null;
  }
  if (Object.keys(out).length === 0) throw new ValidationError("Change the address, the mobile number or the GSTIN.");
  return out;
}

// What a payment paid for, as the invoice's one line: the kind in words and the payment's detail
const ITEM_LABEL = { admission: "Membership", renewal: "Membership renewal", due: "Due payment", pt: "Personal training", service: "Service", sale: "Product" };

// "3 Months" or "15 Days" (plans saved in days before 2026-11-07)
const planText = (months, days) => (months ? `${months} ${months === 1 ? "Month" : "Months"}` : days ? `${days} ${days === 1 ? "Day" : "Days"}` : null);

// One payment's invoice. payment: the gym_payments row with its invoice_no; member: the
// gym_members row it belongs to (null for a sale at the counter); gym: the branch with its
// invoice details. Nothing here is stored: the number is the only thing that must never change.
function invoiceOf({ payment, member, gym, today }) {
  const number = invoiceNumber(gym.brand, gym.branch, payment.invoice_no);
  const billTo = member ? { id: member.id, name: member.full_name, code: member.member_code, phone: member.phone ?? null, email: member.email ?? null } : null;
  // The membership as it stands today, so the member sees how long they're covered
  const membership = member ? { plan: planText(member.plan_months, member.plan_days), until: member.expires_on, active: member.expires_on >= today } : null;
  const balance = member && member.due_amount > 0 ? { due: member.due_amount, dueBy: member.due_by ?? null } : null;
  return {
    number,
    date: payment.paid_on,
    gym: { name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city, address: gym.address ?? null, phone: gym.phone ?? null, gstin: gym.gstin ?? null },
    billTo,
    item: { kind: payment.kind, label: ITEM_LABEL[payment.kind] ?? "Payment", detail: payment.detail, title: payment.title },
    amount: payment.amount,
    method: payment.method,
    paymentId: payment.id,
    membership,
    balance,
  };
}

module.exports = { invoiceNumber, invoiceDetailsBody, invoiceOf, ITEM_LABEL, GSTIN, ADDRESS_MAX };
