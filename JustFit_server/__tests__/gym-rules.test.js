// The gym admin portal's input rules and India-calendar date arithmetic (gym/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/rules");

const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));

describe("gym rules: admissions, renewals, dues, sales, enquiries", () => {
  it("an admission: cleaned name, normalised phone, plan, fee, paid and what's owed", () => {
    assert.deepEqual(rules.admissionBody({ name: "  Mohammed   Asif ", phone: "+91 98765 43210", unit: "months", duration: 3, fee: 4500, paid: 3000, method: "online" }), {
      name: "Mohammed Asif", phone: "9876543210", dob: null, unit: "months", duration: 3, fee: 4500, paid: 3000, due: 1500, method: "online",
    });
    assert.equal(rules.admissionBody({ name: "Ravi", unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" }).phone, null, "the phone is optional");
  });

  it("refuses bad admissions", () => {
    const ok = { name: "Ravi", unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" };
    refuses(() => rules.admissionBody({ ...ok, duration: 25 }), /1 to 24 months/);
    refuses(() => rules.admissionBody({ ...ok, unit: "weeks" }), /months or days/);
    assert.deepEqual(rules.planLength({ unit: "days", duration: 15 }), { unit: "days", duration: 15 });
    refuses(() => rules.planLength({ unit: "days", duration: 366 }), /1 to 365 days/);
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
    assert.deepEqual(rules.renewalBody({ unit: "months", duration: 12, fee: 12000, paid: 10000, method: "cash" }), { unit: "months", duration: 12, fee: 12000, paid: 10000, due: 2000, method: "cash" });
    refuses(() => rules.renewalBody({ unit: "months", duration: 12, fee: 12000, paid: 10000, method: "cash", memberId: 3 }), /fields/);
    assert.deepEqual(rules.duePaymentBody({ amount: 500, method: "online" }), { amount: 500, method: "online" });
    refuses(() => rules.duePaymentBody({ amount: -5, method: "online" }), /rupees/);
    assert.deepEqual(rules.saleBody({ item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" }), { item: "Whey Protein 1kg", detail: "Supplement", amount: 3200, method: "cash" });
    assert.deepEqual(rules.ptBody({ package: " 12  sessions ", amount: 6000, method: "online" }), { package: "12 sessions", amount: 6000, method: "online" });
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online", trainerId: 1 }), /fields/);
    refuses(() => rules.ptBody({ package: "x", amount: 6000, method: "online" }), /PT package/);
    refuses(() => rules.saleBody({ item: "Whey", category: "__proto__", amount: 3200, method: "cash" }), /what was sold/);
    assert.deepEqual(rules.enquiryBody({ name: "Priya", phone: "", note: "  Evening batch?  " }), { name: "Priya", phone: null, note: "Evening batch?" });
    assert.equal(rules.enquiryBody({ name: "Priya" }).note, null);
  });

  it("dates of birth: optional, real, not in the future", () => {
    assert.equal(rules.optionalDob("", "2026-11-04"), null);
    assert.equal(rules.optionalDob(undefined, "2026-11-04"), null);
    assert.equal(rules.optionalDob("1995-08-15", "2026-11-04"), "1995-08-15");
    assert.equal(rules.optionalDob("2000-02-29", "2026-11-04"), "2000-02-29", "a leap day");
    for (const bad of ["1995-02-30", "2026-11-05", "1919-12-31", "15-08-1995", "1995/08/15", 19950815]) refuses(() => rules.optionalDob(bad, "2026-11-04"), /real date/);
    assert.equal(rules.admissionBody({ name: "Kavya", dob: "1995-08-15", unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" }).dob, "1995-08-15");
    assert.deepEqual(rules.memberEditBody({ dob: "" }), { dob: null });
    assert.deepEqual(rules.membersQuery({ filter: "birthday" }).filter, "birthday");
    assert.deepEqual(rules.membersQuery({ filter: "expiring_soon" }).filter, "expiring_soon");
  });

  it("member edits, list filters, payment pages, ids", () => {
    assert.deepEqual(rules.memberEditBody({ phone: "" }), { phone: null });
    refuses(() => rules.memberEditBody({}), /Change the name/);
    assert.deepEqual(rules.membersQuery({}), { filter: "all", search: "" });
    assert.deepEqual(rules.membersQuery({ filter: "due", search: " asif " }), { filter: "due", search: "asif" });
    refuses(() => rules.membersQuery({ filter: "everyone" }), /filter/);
    refuses(() => rules.membersQuery({ search: "x".repeat(61) }), /at most/);
    assert.deepEqual(rules.paymentsQuery({ kind: "sale", before: "40", today: "1" }), { kind: "sale", before: 40, today: true });
    assert.equal(rules.paymentsQuery({ kind: "pt" }).kind, "pt");
    refuses(() => rules.paymentsQuery({ kind: "refund" }), /type/);
    refuses(() => rules.paymentsQuery({ before: "1 OR 1=1" }), /page/);
    assert.equal(rules.id("12"), 12);
    for (const bad of ["0", "-1", "1.5", "abc", "1;DROP", "12345678901", undefined]) refuses(() => rules.id(bad), /doesn't exist/);
  });

  it("gyms and staff, as the justFit admin sends them", () => {
    assert.deepEqual(rules.gymBody({ name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" }, { creating: true }), { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    refuses(() => rules.gymBody({ name: "Forma", area: "Batawadi", city: "Tumakuru" }, { creating: true }), /branch name/);
    assert.deepEqual(rules.gymBody({ city: "Bengaluru" }, { creating: false }), { city: "Bengaluru" });
    refuses(() => rules.gymBody({}, { creating: false }), /Change/);
    assert.deepEqual(rules.branchBody({ branch: "Kunigal", area: "Main Road", city: "Kunigal" }), { branch: "Kunigal", area: "Main Road", city: "Kunigal" });
    refuses(() => rules.branchBody({ branch: "Kunigal", area: "Main Road", city: "Kunigal", name: "Other" }), /fields/);
    assert.deepEqual(rules.gymDetailsBody({ branch: "Tumkur", adminName: "Arjun" }), { branch: "Tumkur", adminName: "Arjun" });
    refuses(() => rules.gymDetailsBody({ name: "Renamed gym" }), /fields/, "a gym admin can't rename the whole gym");
    refuses(() => rules.gymDetailsBody({}), /Change/);
    assert.deepEqual(rules.switchBody({ branchId: 3 }), { branchId: 3 });
    for (const bad of [{ branchId: "3" }, { branchId: 0 }, { branchId: 1.5 }, { branchId: 3, userId: "x" }]) refuses(() => rules.switchBody(bad), /branch|fields/);
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

  it("plans in days include their first day", () => {
    assert.equal(rules.planEnd("2026-11-04", 15, "days"), "2026-11-18");
    assert.equal(rules.planEnd("2026-11-04", 1, "days"), "2026-11-04", "a one-day pass ends the same day");
    assert.equal(rules.renewedUntil("2026-11-10", "2026-11-04", 7, "days"), "2026-11-17");
  });

  it("a renewal follows on from the current plan, or starts today once it has ended", () => {
    assert.equal(rules.renewedUntil("2026-11-10", "2026-11-04", 1), "2026-12-10", "still running: the new month starts on the 11th");
    assert.equal(rules.renewedUntil("2026-11-04", "2026-11-04", 1), "2026-12-04", "ends today: starts tomorrow");
    assert.equal(rules.renewedUntil("2026-10-01", "2026-11-04", 3), "2027-02-03", "ended: starts today");
  });
});
