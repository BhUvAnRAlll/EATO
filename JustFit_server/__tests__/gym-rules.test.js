// The gym admin portal's input rules and India-calendar date arithmetic (gym/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/rules");

const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));

describe("gym rules: admissions, renewals, dues, sales, enquiries", () => {
  it("an admission: cleaned name, normalised phone, plan, fee, paid and what's owed", () => {
    assert.deepEqual(rules.admissionBody({ name: "  Mohammed   Asif ", phone: "+91 98765 43210", months: 3, fee: 4500, paid: 3000, method: "online" }), {
      name: "Mohammed Asif", phone: "9876543210", months: 3, fee: 4500, paid: 3000, due: 1500, method: "online",
    });
    assert.equal(rules.admissionBody({ name: "Ravi", months: 1, fee: 1500, paid: 1500, method: "cash" }).phone, null, "the phone is optional");
  });

  it("refuses bad admissions", () => {
    const ok = { name: "Ravi", months: 1, fee: 1500, paid: 1500, method: "cash" };
    refuses(() => rules.admissionBody({ ...ok, months: 2 }), /plan/);
    refuses(() => rules.admissionBody({ ...ok, paid: 2000 }), /more than the plan fee/);
    refuses(() => rules.admissionBody({ ...ok, paid: 0 }), /at least ₹1/);
    refuses(() => rules.admissionBody({ ...ok, fee: 1500.5 }), /whole rupees/);
    refuses(() => rules.admissionBody({ ...ok, fee: "1500" }), /whole rupees/);
    refuses(() => rules.admissionBody({ ...ok, fee: 2_000_000, paid: 1 }), /10,00,000/);
    refuses(() => rules.admissionBody({ ...ok, method: "card" }), /online or cash/);
    refuses(() => rules.admissionBody({ ...ok, name: "R" }), /name/);
    refuses(() => rules.admissionBody({ ...ok, phone: "12345" }), /mobile number/);
    refuses(() => rules.admissionBody({ ...ok, gymId: 2 }), /fields we don't use/);
    refuses(() => rules.admissionBody({ ...ok, name: "x'; DROP TABLE gyms; --".repeat(10) }), /name/);
    refuses(() => rules.admissionBody(null), /JSON/);
    refuses(() => rules.admissionBody([ok]), /JSON/);
  });

  it("renewals, due payments, sales and enquiries", () => {
    assert.deepEqual(rules.renewalBody({ months: 12, fee: 12000, paid: 10000, method: "cash" }), { months: 12, fee: 12000, paid: 10000, due: 2000, method: "cash" });
    refuses(() => rules.renewalBody({ months: 12, fee: 12000, paid: 10000, method: "cash", memberId: 3 }), /fields/);
    assert.deepEqual(rules.duePaymentBody({ amount: 500, method: "online" }), { amount: 500, method: "online" });
    refuses(() => rules.duePaymentBody({ amount: -5, method: "online" }), /rupees/);
    assert.deepEqual(rules.saleBody({ item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" }), { item: "Whey Protein 1kg", detail: "Supplement Sale", amount: 3200, method: "cash" });
    refuses(() => rules.saleBody({ item: "Whey", category: "__proto__", amount: 3200, method: "cash" }), /what was sold/);
    assert.deepEqual(rules.enquiryBody({ name: "Priya", phone: "", note: "  Evening batch?  " }), { name: "Priya", phone: null, note: "Evening batch?" });
    assert.equal(rules.enquiryBody({ name: "Priya" }).note, null);
  });

  it("member edits, list filters, payment pages, ids", () => {
    assert.deepEqual(rules.memberEditBody({ phone: "" }), { phone: null });
    refuses(() => rules.memberEditBody({}), /Change the name/);
    assert.deepEqual(rules.membersQuery({}), { filter: "all", search: "" });
    assert.deepEqual(rules.membersQuery({ filter: "due", search: " asif " }), { filter: "due", search: "asif" });
    refuses(() => rules.membersQuery({ filter: "everyone" }), /filter/);
    refuses(() => rules.membersQuery({ search: "x".repeat(61) }), /at most/);
    assert.deepEqual(rules.paymentsQuery({ kind: "sale", before: "40", today: "1" }), { kind: "sale", before: 40, today: true });
    refuses(() => rules.paymentsQuery({ kind: "refund" }), /type/);
    refuses(() => rules.paymentsQuery({ before: "1 OR 1=1" }), /page/);
    assert.equal(rules.id("12"), 12);
    for (const bad of ["0", "-1", "1.5", "abc", "1;DROP", "12345678901", undefined]) refuses(() => rules.id(bad), /doesn't exist/);
  });

  it("gyms and staff, as the justFit admin sends them", () => {
    assert.deepEqual(rules.gymBody({ name: "Just Fit", area: "Anna Nagar", city: "Chennai" }, { creating: true }), { name: "Just Fit", area: "Anna Nagar", city: "Chennai" });
    refuses(() => rules.gymBody({ name: "Just Fit" }, { creating: true }), /area/);
    assert.deepEqual(rules.gymBody({ city: "Bengaluru" }, { creating: false }), { city: "Bengaluru" });
    refuses(() => rules.gymBody({}, { creating: false }), /Change/);
    assert.deepEqual(rules.staffBody({ phone: "96065 77501" }), { phone: "9606577501" });
    refuses(() => rules.staffBody({ phone: "9606577501", role: "admin" }), /fields/);
  });
});

describe("gym rules: India's calendar", () => {
  it("today in India, whatever the server's zone", () => {
    assert.equal(rules.todayInIndia(Date.parse("2026-11-03T18:29:00Z")), "2026-11-03");
    assert.equal(rules.todayInIndia(Date.parse("2026-11-03T18:30:00Z")), "2026-11-04", "midnight in India is 18:30 UTC");
  });

  it("plans cover whole months, ending the day before", () => {
    assert.equal(rules.planEnd("2026-11-04", 1), "2026-12-03");
    assert.equal(rules.planEnd("2026-11-04", 12), "2027-11-03");
    assert.equal(rules.planEnd("2026-01-31", 1), "2026-02-27", "31 Jan + 1 month is 28 Feb, so the plan ends on the 27th");
    assert.equal(rules.addMonths("2028-01-31", 1), "2028-02-29", "leap years");
  });

  it("a renewal follows on from the current plan, or starts today once it has ended", () => {
    assert.equal(rules.renewedUntil("2026-11-10", "2026-11-04", 1), "2026-12-10", "still running: the new month starts on the 11th");
    assert.equal(rules.renewedUntil("2026-11-04", "2026-11-04", 1), "2026-12-04", "ends today: starts tomorrow");
    assert.equal(rules.renewedUntil("2026-10-01", "2026-11-04", 3), "2027-02-03", "ended: starts today");
  });
});
