import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GymInvoice } from "../gymApi.ts";
import { gymLines, invoiceDate, invoiceFileName, invoiceHtml, invoicePhone, invoiceRupees, invoiceText } from "../gymInvoice.ts";

const invoice: GymInvoice = {
  number: "INV-FOR-TUM-0007",
  date: "2026-11-07",
  gym: { name: "Forma", branch: "Tumkur", area: "SS Puram", city: "Tumkur", address: "12, 1st Main <Road>", phone: "9876543210", gstin: "29ABCDE1234F1Z5" },
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

  it("the HTML carries every line, escaped", () => {
    const html = invoiceHtml(invoice);
    assert.match(html, /<title>INV-FOR-TUM-0007<\/title>/);
    assert.match(html, /12, 1st Main &lt;Road&gt;/, "the address is escaped");
    assert.match(html, /Ravi &amp; Sons/, "the name is escaped");
    assert.match(html, /Member ID FOR-TUM-0076/);
    assert.match(html, /GSTIN 29ABCDE1234F1Z5/);
    assert.match(html, /Paid · Cash/);
    assert.match(html, /Balance due by 20 Nov 2026<\/td><td class="num">₹2,500/);
    assert.match(html, /valid till <b>6 Feb 2027<\/b>/);
    assert.doesNotMatch(html, /<Road>/);
    const walkIn = invoiceHtml({ ...invoice, billTo: null, membership: null, balance: null, item: { kind: "sale", label: "Product", detail: "Whey 1 kg", title: "Whey 1 kg" } });
    assert.match(walkIn, /Walk-in customer/);
    assert.match(walkIn, /Nil · Paid in full/);
    assert.doesNotMatch(walkIn, /Membership/);
  });
});
