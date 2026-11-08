import type { GymInvoice } from "@/lib/gymApi";

// The Invoice screen's pure parts (2026-11-07): the PDF's HTML (expo-print turns it into a file),
// the file's name and the text sent through WhatsApp, SMS or email. No React Native here, so the
// unit tests run under Node. Dates and rupees are written out by hand (Node's locale data differs
// from the phone's), the same way everywhere on the invoice.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// 2026-11-07 → "7 Nov 2026"
export const invoiceDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};
// 12500 → "₹12,500" in the Indian grouping
export const invoiceRupees = (amount: number) => {
  const digits = String(Math.abs(Math.trunc(amount)));
  const last = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}₹${rest ? `${rest},${last}` : last}`;
};
// "9876543210" → "+91 98765 43210"
export const invoicePhone = (phone: string | null) => (phone && /^\d{10}$/.test(phone) ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone ?? "");

export const METHOD_WORD = { online: "Online", cash: "Cash" } as const;

// The file the PDF is saved as: the invoice number, with the member's ID when there is one
export const invoiceFileName = (invoice: GymInvoice) => `${invoice.number}${invoice.billTo ? `-${invoice.billTo.code}` : ""}.pdf`;

// The gym's lines on the invoice: where it is, then the address, phone and GSTIN when they're set
export function gymLines(gym: GymInvoice["gym"]) {
  return [
    `${gym.branch} · ${gym.area}, ${gym.city}`,
    ...(gym.address ? [gym.address] : []),
    ...(gym.phone ? [invoicePhone(gym.phone)] : []),
    ...(gym.gstin ? [`GSTIN ${gym.gstin}`] : []),
  ];
}

// The invoice as a short message, for WhatsApp, SMS or the body of an email
export function invoiceText(invoice: GymInvoice) {
  const lines = [
    `${invoice.gym.name} (${invoice.gym.branch}) · Invoice ${invoice.number}`,
    `Date: ${invoiceDate(invoice.date)}`,
    ...(invoice.billTo ? [`${invoice.billTo.name} (${invoice.billTo.code})`] : []),
    `${invoice.item.label}: ${invoice.item.detail}`,
    `Paid: ${invoiceRupees(invoice.amount)} (${METHOD_WORD[invoice.method]})`,
    ...(invoice.membership ? [`Membership ${invoice.membership.active ? "valid till" : "ended on"} ${invoiceDate(invoice.membership.until)}`] : []),
    invoice.balance ? `Balance due: ${invoiceRupees(invoice.balance.due)}${invoice.balance.dueBy ? ` by ${invoiceDate(invoice.balance.dueBy)}` : ""}` : "Nothing due. Thank you!",
  ];
  return lines.join("\n");
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

// The PDF: one A4 page, the portal's indigo header, the gym on the left and the invoice number
// and date on the right, then Bill to, the one item, what was paid and the balance. Everything
// written into it is escaped; the member's name and the item come from the server.
export function invoiceHtml(invoice: GymInvoice) {
  const e = escapeHtml;
  const gym = gymLines(invoice.gym).map((line) => `<div class="muted">${e(line)}</div>`).join("");
  const billTo = invoice.billTo
    ? `<div class="name">${e(invoice.billTo.name)}</div><div class="muted">Member ID ${e(invoice.billTo.code)}</div>${invoice.billTo.phone ? `<div class="muted">${e(invoicePhone(invoice.billTo.phone))}</div>` : ""}`
    : `<div class="name">Walk-in customer</div>`;
  const balance = invoice.balance
    ? `<tr class="due"><td>Balance due${invoice.balance.dueBy ? ` by ${e(invoiceDate(invoice.balance.dueBy))}` : ""}</td><td class="num">${e(invoiceRupees(invoice.balance.due))}</td></tr>`
    : `<tr class="ok"><td>Balance due</td><td class="num">Nil · Paid in full</td></tr>`;
  const membership = invoice.membership
    ? `<p class="note">Membership${invoice.membership.plan ? ` (${e(invoice.membership.plan)})` : ""} ${invoice.membership.active ? "valid till" : "ended on"} <b>${e(invoiceDate(invoice.membership.until))}</b>.</p>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(invoice.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; font-family: -apple-system, Roboto, "Segoe UI", Helvetica, Arial, sans-serif; color: #111827; }
  .page { padding: 40px 44px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; background: linear-gradient(135deg, #4F46E5, #7C3AED); color: #fff; border-radius: 18px; padding: 26px 28px; }
  .head .muted { color: rgba(255,255,255,0.82); font-size: 12px; line-height: 18px; }
  .gym { font-size: 22px; font-weight: 600; line-height: 28px; margin-bottom: 4px; }
  .tag { text-align: right; }
  .tag .label { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.85; }
  .tag .number { font-size: 18px; font-weight: 600; line-height: 26px; margin-top: 4px; }
  .tag .date { font-size: 12px; opacity: 0.85; }
  h2 { font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: #6B7280; margin: 30px 0 8px; }
  .name { font-size: 16px; font-weight: 600; line-height: 22px; }
  .muted { color: #4B5563; font-size: 13px; line-height: 19px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: #6B7280; padding: 10px 0; border-bottom: 1px solid #E5E7EB; }
  td { padding: 14px 0; border-bottom: 1px solid #E5E7EB; font-size: 14px; }
  td .detail { color: #4B5563; font-size: 13px; margin-top: 2px; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 600; font-size: 16px; border-bottom: 0; padding-top: 18px; }
  .due td { color: #DC2626; font-weight: 600; border-bottom: 0; padding-top: 4px; }
  .ok td { color: #059669; font-weight: 600; border-bottom: 0; padding-top: 4px; }
  .note { margin: 18px 0 0; font-size: 13px; color: #374151; }
  .foot { margin-top: 44px; padding-top: 16px; border-top: 1px solid #E5E7EB; display: flex; justify-content: space-between; font-size: 12px; color: #6B7280; }
</style></head><body><div class="page">
  <div class="head">
    <div><div class="gym">${e(invoice.gym.name)}</div>${gym}</div>
    <div class="tag"><div class="label">Invoice</div><div class="number">${e(invoice.number)}</div><div class="date">${e(invoiceDate(invoice.date))}</div></div>
  </div>
  <h2>Bill to</h2>
  ${billTo}
  <h2>Payment</h2>
  <table>
    <tr><th>Item</th><th class="num">Amount</th></tr>
    <tr><td>${e(invoice.item.label)}<div class="detail">${e(invoice.item.detail)}</div></td><td class="num">${e(invoiceRupees(invoice.amount))}</td></tr>
    <tr class="total"><td>Paid · ${e(METHOD_WORD[invoice.method])}</td><td class="num">${e(invoiceRupees(invoice.amount))}</td></tr>
    ${balance}
  </table>
  ${membership}
  <div class="foot"><span>Thank you for training with ${e(invoice.gym.name)}.</span><span>Made with justFit</span></div>
</div></body></html>`;
}
