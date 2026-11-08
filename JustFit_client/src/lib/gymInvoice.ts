import type { GymInvoice, PaymentKind } from "@/lib/gymApi";

// The Invoice screen's pure parts (2026-11-07): the PDF's HTML (expo-print turns it into a file),
// the file's name and the text sent through WhatsApp, SMS or email. No React Native here, so the
// unit tests run under Node. Dates and rupees are written out by hand (Node's locale data differs
// from the phone's), the same way everywhere on the invoice.
//
// Since 2026-11-08 both the screen and the PDF follow the user's invoice template: "Invoice" with a
// red rule and the kind under it, the gym's own logo at the top right (gym/logos.js; the gym's
// initials when it has none), the number and dates, a Member Details and a Plan Details card, the
// item table with a red header, the totals with the Total Amount on a pink band, Payment Details
// with a green Paid badge, the signature line and the gym's footer bar. The rows the screen draws
// come from the same helpers as the PDF (detailRows, dueDate, invoiceSubtitle, itemDescription).

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

// The line under "Invoice": what kind of invoice this is
const SUBTITLE: Record<PaymentKind, string> = { admission: "Membership Invoice", renewal: "Renewal Invoice", due: "Payment Invoice", pt: "Personal Training Invoice", service: "Service Invoice", sale: "Product Invoice" };
export const invoiceSubtitle = (kind: PaymentKind) => SUBTITLE[kind] ?? "Invoice";

// The invoice's Due Date: when a balance is owed, the day it is due; otherwise the invoice is
// settled on its own date
export const dueDate = (invoice: GymInvoice) => (invoice.balance?.dueBy ? invoice.balance.dueBy : invoice.date);

// The gym's initials for the corner when it has no logo ("Forma" → "F", "Just Fit" → "JF")
export const gymInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export type InvoiceRow = [label: string, value: string];
export type InvoiceCards = { member: { title: string; rows: InvoiceRow[] }; plan: { title: string; rows: InvoiceRow[] } };

const MEMBERSHIP_KINDS: PaymentKind[] = ["admission", "renewal", "due"];

// The two cards under the heading: who is billed, and what the payment bought. A membership
// payment shows the plan as it stands; PT, a service or a product show the item.
export function detailRows(invoice: GymInvoice): InvoiceCards {
  const memberRows: InvoiceRow[] = invoice.billTo
    ? [["Name", invoice.billTo.name], ["Member ID", invoice.billTo.code], ...(invoice.billTo.phone ? [["Phone", invoicePhone(invoice.billTo.phone)] as InvoiceRow] : [])]
    : [["Name", "Walk-in customer"]];
  const member = { title: "Member Details", rows: memberRows };
  if (MEMBERSHIP_KINDS.includes(invoice.item.kind) && invoice.membership) {
    const m = invoice.membership;
    const rows: InvoiceRow[] = [
      ["Plan", invoice.item.kind === "due" ? "Membership" : invoice.item.label],
      ...(m.plan ? [["Duration", m.plan] as InvoiceRow] : []),
      [m.active ? "Valid till" : "Ended on", invoiceDate(m.until)],
      ["Status", m.active ? "Active" : "Ended"],
    ];
    return { member, plan: { title: "Plan Details", rows } };
  }
  const title = invoice.item.kind === "pt" ? "PT Details" : invoice.item.kind === "service" ? "Service Details" : invoice.item.kind === "sale" ? "Product Details" : "Plan Details";
  const rows: InvoiceRow[] = [
    [invoice.item.kind === "pt" ? "Package" : "Item", invoice.item.title],
    ...(invoice.item.detail && invoice.item.detail !== invoice.item.title ? [["Detail", invoice.item.detail] as InvoiceRow] : []),
    ...(invoice.membership ? [[invoice.membership.active ? "Membership till" : "Membership ended", invoiceDate(invoice.membership.until)] as InvoiceRow] : []),
  ];
  return { member, plan: { title, rows } };
}

// The item table's one line: "Membership – 3 Months", "Product – Whey 1 kg"
export const itemDescription = (invoice: GymInvoice) => {
  const { label, detail, title, kind } = invoice.item;
  const second = MEMBERSHIP_KINDS.includes(kind) ? detail : title;
  return second && second !== label ? `${label} – ${second}` : label;
};

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

// Only a data URL of an image the server made is ever put in an <img>; anything else is dropped
export const safeLogo = (dataUrl: string | null) => (dataUrl && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ? dataUrl : null);

// Small line icons for the cards and the footer (the template's), in the brand red
const ICON = {
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 13h6M9 17h6"/></svg>',
};

// The PDF: one A4 page laid out like the template (see the top of this file). Everything written
// into it is escaped; the member's name and the item come from the server.
export function invoiceHtml(invoice: GymInvoice) {
  const e = escapeHtml;
  const cards = detailRows(invoice);
  const logo = safeLogo(invoice.gym.logoDataUrl);
  const corner = logo ? `<img class="logo" src="${logo}" alt="${e(invoice.gym.name)}">` : `<div class="mark" aria-label="${e(invoice.gym.name)}">${e(gymInitials(invoice.gym.name))}</div>`;
  const kv = (rows: InvoiceRow[]) => rows.map(([k, v]) => `<tr><th>${e(k)}</th><td class="colon">:</td><td>${e(v)}</td></tr>`).join("");
  const balance = invoice.balance
    ? `<tr class="due"><td>Balance Due${invoice.balance.dueBy ? ` <span class="by">by ${e(invoiceDate(invoice.balance.dueBy))}</span>` : ""}</td><td class="num">${e(invoiceRupees(invoice.balance.due))}</td></tr>`
    : `<tr class="settled"><td>Balance Due</td><td class="num">Nil · Paid in full</td></tr>`;
  const footer = [
    { icon: ICON.pin, lines: [invoice.gym.name, `${invoice.gym.branch} · ${invoice.gym.area}, ${invoice.gym.city}`, ...(invoice.gym.address ? [invoice.gym.address] : [])] },
    ...(invoice.gym.phone ? [{ icon: ICON.phone, lines: [invoicePhone(invoice.gym.phone)] }] : []),
    ...(invoice.gym.gstin ? [{ icon: ICON.file, lines: [`GSTIN ${invoice.gym.gstin}`] }] : []),
  ]
    .map((f) => `<div class="foot__item"><span class="icon">${f.icon}</span><div>${f.lines.map((l, i) => `<div class="${i === 0 ? "foot__main" : "foot__line"}">${e(l)}</div>`).join("")}</div></div>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(invoice.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Roboto, "Segoe UI", Helvetica, Arial, sans-serif; color: #111111; font-size: 13px; line-height: 19px; }
  svg { width: 100%; height: 100%; fill: none; stroke: #D40005; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .page { padding: 40px 44px 36px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { margin: 18px 0 0; font-size: 44px; line-height: 48px; font-weight: 700; letter-spacing: -0.5px; }
  .rule { width: 120px; height: 4px; background: #D40005; border-radius: 2px; margin: 8px 0 10px; }
  .subtitle { font-size: 18px; line-height: 24px; color: #111111; }
  .corner { display: flex; flex-direction: column; align-items: flex-end; gap: 18px; }
  .logo { max-width: 170px; max-height: 76px; object-fit: contain; }
  .mark { width: 76px; height: 76px; border-radius: 18px; background: #D40005; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 700; letter-spacing: 1px; }
  table { border-collapse: collapse; }
  .meta th { font-weight: 400; text-align: left; padding: 2px 10px 2px 0; }
  .meta td { padding: 2px 0; }
  .meta td.colon { padding: 2px 14px 2px 0; }
  .cards { display: flex; margin-top: 28px; border: 1px solid #E8E8EA; border-radius: 14px; }
  .card { flex: 1; padding: 16px 20px 18px; }
  .card + .card { border-left: 1px solid #E8E8EA; }
  .card__title { display: flex; align-items: center; gap: 10px; font-size: 16px; line-height: 22px; font-weight: 600; color: #D40005; margin-bottom: 10px; }
  .icon { width: 20px; height: 20px; display: inline-block; flex: none; }
  .kv th { font-weight: 400; text-align: left; color: #111111; padding: 3px 10px 3px 0; white-space: nowrap; vertical-align: top; }
  .kv td { padding: 3px 0; vertical-align: top; }
  .kv td.colon { padding: 3px 14px 3px 0; }
  .items { width: 100%; margin-top: 24px; border-radius: 12px; overflow: hidden; border: 1px solid #E8E8EA; }
  .items th { background: #D40005; color: #fff; text-align: left; font-size: 14px; font-weight: 600; padding: 12px 16px; }
  .items td { padding: 12px 16px; border-top: 1px solid #E8E8EA; font-size: 14px; }
  .items .hash { width: 48px; text-align: center; }
  .items th.num { text-align: right; }
  .items td.hash, .items td.desc { border-right: 1px solid #E8E8EA; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sum { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 18px; gap: 24px; }
  .thanks { max-width: 230px; color: #5C5C63; padding-top: 6px; }
  .totals { width: 320px; }
  .totals td { padding: 9px 12px; border-bottom: 1px solid #E8E8EA; font-size: 14px; }
  .totals tr.total td { background: #FDEAEA; border: 0; color: #D40005; font-size: 18px; font-weight: 700; padding: 14px 16px; }
  .totals tr.total td:first-child { border-radius: 12px 0 0 12px; }
  .totals tr.total td:last-child { border-radius: 0 12px 12px 0; }
  .totals tr.due td { color: #D92D20; font-weight: 600; border: 0; }
  .totals tr.settled td { color: #2F8F57; font-weight: 600; border: 0; }
  .by { font-weight: 400; color: #5C5C63; font-size: 12px; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; gap: 24px; }
  .pay { width: 300px; border: 1px solid #E8E8EA; border-radius: 14px; padding: 16px 20px 18px; }
  .badge { display: inline-block; background: #2F8F57; color: #fff; border-radius: 999px; padding: 2px 12px; font-size: 12px; font-weight: 600; line-height: 18px; }
  .sign { text-align: center; width: 220px; }
  .sign__line { border-top: 1px solid #C9C9CF; margin: 44px 0 8px; }
  .sign__title { font-weight: 600; font-size: 14px; }
  .sign__gym { color: #5C5C63; }
  .foot { display: flex; gap: 28px; margin-top: 30px; background: #F4F4F5; border-radius: 14px; padding: 16px 20px; }
  .foot__item { display: flex; gap: 10px; align-items: flex-start; }
  .foot__main { font-weight: 600; }
  .foot__line { color: #5C5C63; font-size: 12px; line-height: 17px; }
  .made { margin-top: 12px; text-align: center; color: #767680; font-size: 11px; }
</style></head><body><div class="page">
  <div class="top">
    <div>
      <h1>Invoice</h1>
      <div class="rule"></div>
      <div class="subtitle">${e(invoiceSubtitle(invoice.item.kind))}</div>
    </div>
    <div class="corner">
      ${corner}
      <table class="meta">
        <tr><th>Invoice No</th><td class="colon">:</td><td>${e(invoice.number)}</td></tr>
        <tr><th>Invoice Date</th><td class="colon">:</td><td>${e(invoiceDate(invoice.date))}</td></tr>
        <tr><th>Due Date</th><td class="colon">:</td><td>${e(invoiceDate(dueDate(invoice)))}</td></tr>
      </table>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="card__title"><span class="icon">${ICON.user}</span>${e(cards.member.title)}</div><table class="kv">${kv(cards.member.rows)}</table></div>
    <div class="card"><div class="card__title"><span class="icon">${ICON.calendar}</span>${e(cards.plan.title)}</div><table class="kv">${kv(cards.plan.rows)}</table></div>
  </div>

  <table class="items">
    <tr><th class="hash">#</th><th>Description</th><th class="num">Amount</th></tr>
    <tr><td class="hash">1</td><td class="desc">${e(itemDescription(invoice))}</td><td class="num">${e(invoiceRupees(invoice.amount))}</td></tr>
  </table>

  <div class="sum">
    <div class="thanks">Thank you for training with ${e(invoice.gym.name)}.</div>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${e(invoiceRupees(invoice.amount))}</td></tr>
      <tr class="total"><td>Total Amount</td><td class="num">${e(invoiceRupees(invoice.amount))}</td></tr>
      ${balance}
    </table>
  </div>

  <div class="bottom">
    <div class="pay">
      <div class="card__title"><span class="icon">${ICON.card}</span>Payment Details</div>
      <table class="kv">
        <tr><th>Payment Mode</th><td class="colon">:</td><td>${e(METHOD_WORD[invoice.method])}</td></tr>
        <tr><th>Payment Date</th><td class="colon">:</td><td>${e(invoiceDate(invoice.date))}</td></tr>
        <tr><th>Payment Status</th><td class="colon">:</td><td><span class="badge">✓ Paid</span></td></tr>
      </table>
    </div>
    <div class="sign"><div class="sign__line"></div><div class="sign__title">Authorized Signature</div><div class="sign__gym">${e(invoice.gym.name)}</div></div>
  </div>

  <div class="foot">${footer}</div>
  <div class="made">Made with justFit</div>
</div></body></html>`;
}
