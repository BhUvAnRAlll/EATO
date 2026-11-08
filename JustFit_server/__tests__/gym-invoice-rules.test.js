// Invoices: the number, the Invoice details and one payment's invoice (gym/invoiceRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/invoiceRules");

const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));

describe("gym invoice rules", () => {
  it("numbers invoices like member IDs, per branch", () => {
    assert.equal(rules.invoiceNumber("Forma", "Tumkur", 1), "INV-FOR-TUM-0001");
    assert.equal(rules.invoiceNumber("Just Fit", "Anna Nagar", 12345), "INV-JUS-ANN-12345");
  });

  it("Invoice details: each field optional, cleaned, an empty one clears", () => {
    assert.deepEqual(rules.invoiceDetailsBody({ address: "  12, 1st Main  Road ", phone: "+91 98765 43210", gstin: " 29abcde1234f1z5 " }), { address: "12, 1st Main Road", phone: "9876543210", gstin: "29ABCDE1234F1Z5" });
    assert.deepEqual(rules.invoiceDetailsBody({ address: "", phone: "", gstin: "" }), { address: null, phone: null, gstin: null });
    assert.deepEqual(rules.invoiceDetailsBody({ gstin: null }), { gstin: null });
    assert.deepEqual(rules.invoiceDetailsBody({ phone: "9876543210" }), { phone: "9876543210" }, "only the keys sent change");
  });

  it("refuses bad Invoice details", () => {
    refuses(() => rules.invoiceDetailsBody({}), /Change the address/);
    refuses(() => rules.invoiceDetailsBody({ name: "x" }), /fields we don't use/);
    refuses(() => rules.invoiceDetailsBody({ gstin: "29ABCDE1234F1X5" }), /GSTIN/);
    refuses(() => rules.invoiceDetailsBody({ gstin: "1234" }), /GSTIN/);
    refuses(() => rules.invoiceDetailsBody({ phone: "12345" }), /mobile/i);
    refuses(() => rules.invoiceDetailsBody({ phone: 9876543210 }), /mobile/i);
    refuses(() => rules.invoiceDetailsBody({ address: "x".repeat(161) }), /160 characters/);
    refuses(() => rules.invoiceDetailsBody({ address: 12 }), /address/);
    refuses(() => rules.invoiceDetailsBody("nope"), /JSON/);
  });

  it("carries the gym's logo when it has one, and null when not", () => {
    const payment = { id: 1, kind: "sale", title: "Whey", detail: "Supplement", method: "cash", amount: 100, paid_on: "2026-11-08", invoice_no: 1 };
    const gym = { brand: "Forma", branch: "Tumkur", area: "SS Puram", city: "Tumkur" };
    assert.equal(rules.invoiceOf({ payment, member: null, gym: { ...gym, logoDataUrl: "data:image/png;base64,AAAA" }, today: "2026-11-08" }).gym.logoDataUrl, "data:image/png;base64,AAAA");
    assert.equal(rules.invoiceOf({ payment, member: null, gym, today: "2026-11-08" }).gym.logoDataUrl, null);
  });

  it("one payment's invoice: the number, the member, the item, the standing today", () => {
    const gym = { brand: "Forma", branch: "Tumkur", area: "SS Puram", city: "Tumkur", address: "12, 1st Main", phone: "9876543210", gstin: null };
    const payment = { id: 41, kind: "admission", title: "Ravi", detail: "3 Months", method: "cash", amount: 4500, paid_on: "2026-11-07", member_id: 3, invoice_no: 7 };
    const member = { id: 3, full_name: "Ravi", member_code: "FOR-TUM-0003", phone: "9123456789", email: null, plan_months: 3, plan_days: null, expires_on: "2027-02-06", due_amount: 500, due_by: "2026-11-20" };
    assert.deepEqual(rules.invoiceOf({ payment, member, gym, today: "2026-11-07" }), {
      number: "INV-FOR-TUM-0007",
      date: "2026-11-07",
      gym: { name: "Forma", branch: "Tumkur", area: "SS Puram", city: "Tumkur", address: "12, 1st Main", phone: "9876543210", gstin: null, logoDataUrl: null },
      billTo: { id: 3, name: "Ravi", code: "FOR-TUM-0003", phone: "9123456789", email: null },
      item: { kind: "admission", label: "Membership", detail: "3 Months", title: "Ravi" },
      amount: 4500,
      method: "cash",
      paymentId: 41,
      membership: { plan: "3 Months", until: "2027-02-06", active: true },
      balance: { due: 500, dueBy: "2026-11-20" },
    });
    const settled = rules.invoiceOf({ payment: { ...payment, kind: "pt", detail: "PT · 12 sessions · 1 Month" }, member: { ...member, due_amount: 0, due_by: null, plan_months: null, plan_days: 15, expires_on: "2026-11-01" }, gym, today: "2026-11-07" });
    assert.equal(settled.item.label, "Personal training");
    assert.equal(settled.balance, null, "nothing owed: no balance line");
    assert.deepEqual(settled.membership, { plan: "15 Days", until: "2026-11-01", active: false });
    const counter = rules.invoiceOf({ payment: { ...payment, kind: "sale", title: "Whey 1 kg", detail: "Supplement", member_id: null }, member: null, gym, today: "2026-11-07" });
    assert.equal(counter.billTo, null);
    assert.equal(counter.membership, null);
    assert.equal(counter.item.label, "Product");
  });
});
