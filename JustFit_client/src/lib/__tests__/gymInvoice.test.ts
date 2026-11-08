import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GymInvoice } from "../gymApi.ts";
import { detailRows, dueDate, gymInitials, gymLines, invoiceDate, invoiceFileName, invoiceHtml, invoicePhone, invoiceRupees, invoiceSubtitle, invoiceText, itemDescription, safeLogo } from "../gymInvoice.ts";

const invoice: GymInvoice = {
  number: "INV-FOR-TUM-0007",
  date: "2026-11-07",
  gym: { name: "Forma", branch: "Tumkur", area: "SS Puram", city: "Tumkur", address: "12, 1st Main <Road>", phone: "9876543210", gstin: "29ABCDE1234F1Z5", logoDataUrl: null },
  billTo: { id: 3, name: "Ravi & Sons", code: "FOR-TUM-0076", phone: "9123456789", email: null },
  item: { kind: "admission", label: "Membership", detail: "3 Months", title: "Ravi & Sons" },
  amount: 125000,
  method: "cash",
  paymentId: 41,
  membership: { plan: "3 Months", until: "2027-02-06", active: true },
  balance: { due: 2500, dueBy: "2026-11-20" },
};

describe("gym invoice: the words, the file and the PDF's HTML", () => {
  it("writes dates, rupees and phones the Indian way", () => {
    assert.equal(invoiceDate("2026-11-07"), "7 Nov 2026");
    assert.equal(invoiceRupees(125000), "₹1,25,000");
    assert.equal(invoiceRupees(999), "₹999");
    assert.equal(invoiceRupees(1000), "₹1,000");
    assert.equal(invoiceRupees(10000000), "₹1,00,00,000");
    assert.equal(invoicePhone("9876543210"), "+91 98765 43210");
    assert.equal(invoicePhone(null), "");
  });

  it("names the file by the invoice number and the member", () => {
    assert.equal(invoiceFileName(invoice), "INV-FOR-TUM-0007-FOR-TUM-0076.pdf");
    assert.equal(invoiceFileName({ ...invoice, billTo: null }), "INV-FOR-TUM-0007.pdf");
  });

  it("lists the gym's lines only when they're set", () => {
    assert.deepEqual(gymLines(invoice.gym), ["Tumkur · SS Puram, Tumkur", "12, 1st Main <Road>", "+91 98765 43210", "GSTIN 29ABCDE1234F1Z5"]);
    assert.deepEqual(gymLines({ ...invoice.gym, address: null, phone: null, gstin: null }), ["Tumkur · SS Puram, Tumkur"]);
  });

  it("the message says what was paid, the membership and the balance", () => {
    assert.equal(
      invoiceText(invoice),
      ["Forma (Tumkur) · Invoice INV-FOR-TUM-0007", "Date: 7 Nov 2026", "Ravi & Sons (FOR-TUM-0076)", "Membership: 3 Months", "Paid: ₹1,25,000 (Cash)", "Membership valid till 6 Feb 2027", "Balance due: ₹2,500 by 20 Nov 2026"].join("\n"),
    );
    const settled = invoiceText({ ...invoice, balance: null, membership: { plan: null, until: "2026-11-03", active: false }, method: "online" });
    assert.match(settled, /Paid: ₹1,25,000 \(Online\)/);
    assert.match(settled, /Membership ended on 3 Nov 2026/);
    assert.match(settled, /Nothing due\. Thank you!/);
    assert.doesNotMatch(invoiceText({ ...invoice, billTo: null }), /FOR-TUM-0076/, "a counter sale names no member");
  });

  it("the template's words: the kind, the due date, the two cards and the item line", () => {
    assert.equal(invoiceSubtitle("admission"), "Membership Invoice");
    assert.equal(invoiceSubtitle("renewal"), "Renewal Invoice");
    assert.equal(invoiceSubtitle("sale"), "Product Invoice");
    assert.equal(dueDate(invoice), "2026-11-20", "a balance is due by its date");
    assert.equal(dueDate({ ...invoice, balance: null }), "2026-11-07", "paid in full: settled on the invoice's date");
    assert.equal(dueDate({ ...invoice, balance: { due: 500, dueBy: null } }), "2026-11-07", "owed with no date: the invoice's date");
    assert.deepEqual(detailRows(invoice), {
      member: { title: "Member Details", rows: [["Name", "Ravi & Sons"], ["Member ID", "FOR-TUM-0076"], ["Phone", "+91 91234 56789"]] },
      plan: { title: "Plan Details", rows: [["Plan", "Membership"], ["Duration", "3 Months"], ["Valid till", "6 Feb 2027"], ["Status", "Active"]] },
    });
    const ended = detailRows({ ...invoice, item: { kind: "due", label: "Due payment", detail: "Due payment", title: "Ravi & Sons" }, membership: { plan: null, until: "2026-11-03", active: false } });
    assert.deepEqual(ended.plan.rows, [["Plan", "Membership"], ["Ended on", "3 Nov 2026"], ["Status", "Ended"]]);
    const sale = detailRows({ ...invoice, billTo: null, membership: null, item: { kind: "sale", label: "Product", detail: "Supplement", title: "Whey 1 kg" } });
    assert.deepEqual(sale, { member: { title: "Member Details", rows: [["Name", "Walk-in customer"]] }, plan: { title: "Product Details", rows: [["Item", "Whey 1 kg"], ["Detail", "Supplement"]] } });
    const pt = detailRows({ ...invoice, item: { kind: "pt", label: "Personal training", detail: "PT · 12 sessions · 1 Month", title: "12 sessions" } });
    assert.deepEqual(pt.plan, { title: "PT Details", rows: [["Package", "12 sessions"], ["Detail", "PT · 12 sessions · 1 Month"], ["Membership till", "6 Feb 2027"]] });
    assert.equal(itemDescription(invoice), "Membership – 3 Months");
    assert.equal(itemDescription({ ...invoice, item: { kind: "sale", label: "Product", detail: "Supplement", title: "Whey 1 kg" } }), "Product – Whey 1 kg");
    assert.equal(itemDescription({ ...invoice, item: { kind: "due", label: "Due payment", detail: "Due payment", title: "x" } }), "Due payment", "nothing repeated");
    assert.equal(gymInitials("Forma"), "F");
    assert.equal(gymInitials("Just Fit Gym"), "JF");
  });

  it("only a data URL the server made goes into the logo", () => {
    const good = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(safeLogo(good), good);
    assert.equal(safeLogo(null), null);
    assert.equal(safeLogo("https://evil.example/x.png"), null);
    assert.equal(safeLogo('data:image/svg+xml;base64,PHN2Zz4='), null, "no SVG");
    assert.equal(safeLogo('data:image/png;base64,abc" onerror="alert(1)'), null);
  });

  it("the HTML follows the template and carries every line, escaped", () => {
    const html = invoiceHtml(invoice);
    assert.match(html, /<title>INV-FOR-TUM-0007<\/title>/);
    assert.match(html, /<h1>Invoice<\/h1>/);
    assert.match(html, /class="subtitle">Membership Invoice</);
    assert.match(html, /<th>Invoice No<\/th><td class="colon">:<\/td><td>INV-FOR-TUM-0007/);
    assert.match(html, /<th>Due Date<\/th><td class="colon">:<\/td><td>20 Nov 2026/);
    assert.match(html, /class="mark" aria-label="Forma">F</, "no logo: the gym's initials in the corner");
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /Member Details/);
    assert.match(html, /<th>Name<\/th><td class="colon">:<\/td><td>Ravi &amp; Sons/, "the name is escaped");
    assert.match(html, /<th>Member ID<\/th><td class="colon">:<\/td><td>FOR-TUM-0076/);
    assert.match(html, /Plan Details/);
    assert.match(html, /<th>Duration<\/th><td class="colon">:<\/td><td>3 Months/);
    assert.match(html, /<th>Valid till<\/th><td class="colon">:<\/td><td>6 Feb 2027/);
    assert.match(html, /<th>Description<\/th>/);
    assert.match(html, /<td class="desc">Membership – 3 Months<\/td><td class="num">₹1,25,000/);
    assert.match(html, /<td>Subtotal<\/td><td class="num">₹1,25,000/);
    assert.match(html, /<tr class="total"><td>Total Amount<\/td><td class="num">₹1,25,000/);
    assert.match(html, /<tr class="due"><td>Balance Due <span class="by">by 20 Nov 2026<\/span><\/td><td class="num">₹2,500/);
    assert.match(html, /<th>Payment Mode<\/th><td class="colon">:<\/td><td>Cash/);
    assert.match(html, /class="badge">✓ Paid/);
    assert.match(html, /Authorized Signature/);
    assert.match(html, /12, 1st Main &lt;Road&gt;/, "the address is escaped");
    assert.match(html, /GSTIN 29ABCDE1234F1Z5/);
    assert.match(html, /\+91 98765 43210/);
    assert.match(html, /Made with justFit/);
    assert.doesNotMatch(html, /<Road>/);

    const withLogo = invoiceHtml({ ...invoice, gym: { ...invoice.gym, logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" } });
    assert.match(withLogo, /<img class="logo" src="data:image\/png;base64,iVBORw0KGgo=" alt="Forma">/, "the gym's logo at the top right");
    assert.doesNotMatch(withLogo, /class="mark"/);
    const badLogo = invoiceHtml({ ...invoice, gym: { ...invoice.gym, logoDataUrl: 'javascript:alert(1)' } });
    assert.doesNotMatch(badLogo, /<img/, "anything but an image data URL is dropped");

    const walkIn = invoiceHtml({ ...invoice, billTo: null, membership: null, balance: null, item: { kind: "sale", label: "Product", detail: "Supplement", title: "Whey 1 kg" } });
    assert.match(walkIn, /Product Invoice/);
    assert.match(walkIn, /Walk-in customer/);
    assert.match(walkIn, /Product Details/);
    assert.match(walkIn, /<td class="desc">Product – Whey 1 kg<\/td>/);
    assert.match(walkIn, /Nil · Paid in full/);
    assert.match(walkIn, /<th>Due Date<\/th><td class="colon">:<\/td><td>7 Nov 2026/, "settled on the invoice's date");
    assert.doesNotMatch(walkIn, /Membership/);
  });
});
