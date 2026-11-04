// The gym admin portal's input rules and India-calendar date arithmetic (gym/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/rules");

const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));

describe("gym rules: admissions, renewals, dues, sales, enquiries", () => {
  it("an admission: cleaned name, normalised phone, plan, fee, paid and what's owed", () => {
    const soon = rules.addDays(rules.todayInIndia(), 7);
    const today = rules.todayInIndia();
    assert.deepEqual(rules.admissionBody({ name: "  Mohammed   Asif ", phone: "+91 98765 43210", unit: "months", duration: 3, fee: 4500, paid: 3000, method: "online", dueBy: soon }), {
      name: "Mohammed Asif", phone: "9876543210", dob: null, gender: null, email: null, heightCm: null, weightKg: null, address: null, notes: null,
      unit: "months", duration: 3, fee: 4500, admissionFee: 0, discount: 0, payable: 4500, paid: 3000, due: 1500, dueBy: soon, method: "online", joinedOn: today, paidOn: today,
    });
    assert.equal(rules.admissionBody({ name: "Ravi", unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" }).phone, null, "the phone is optional");
  });

  it("refuses bad admissions", () => {
    const ok = { name: "Ravi", unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" };
    refuses(() => rules.admissionBody({ ...ok, duration: 25 }), /1 to 24 months/);
    refuses(() => rules.admissionBody({ ...ok, unit: "weeks" }), /months or days/);
    assert.deepEqual(rules.planLength({ unit: "days", duration: 15 }), { unit: "days", duration: 15 });
    refuses(() => rules.planLength({ unit: "days", duration: 366 }), /1 to 365 days/);
    refuses(() => rules.admissionBody({ ...ok, paid: 2000 }), /more than the amount payable/);
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

  it("admission amounts: plan + admission − discount is payable; dates and details", () => {
    const today = rules.todayInIndia();
    const base = { name: "Kiran", unit: "months", duration: 1, fee: 1500, method: "cash" };
    const a = rules.admissionBody({ ...base, admissionFee: 500, discount: 200, paid: 1800 });
    assert.deepEqual([a.payable, a.due, a.dueBy], [1800, 0, null]);
    const b = rules.admissionBody({ ...base, admissionFee: 500, paid: 1000, dueBy: today, joinedOn: rules.addDays(today, -10), paidOn: rules.addDays(today, -2) });
    assert.deepEqual([b.payable, b.due, b.joinedOn, b.paidOn], [2000, 1000, rules.addDays(today, -10), rules.addDays(today, -2)]);
    refuses(() => rules.admissionBody({ ...base, discount: 2000, paid: 1 }), /discount can't be more/);
    refuses(() => rules.admissionBody({ ...base, discount: 1500, paid: 1 }), /at least ₹1/);
    refuses(() => rules.admissionBody({ ...base, paid: 1600 }), /more than the amount payable/);
    refuses(() => rules.admissionBody({ ...base, paid: 1500, paidOn: rules.addDays(today, 1) }), /payment date/);
    refuses(() => rules.admissionBody({ ...base, paid: 1500, joinedOn: rules.addDays(today, 61) }), /joining date/);
    const d = rules.admissionBody({ ...base, paid: 1500, email: " Kiran@Example.COM ", heightCm: 172, weightKg: 68.25, address: "  12, MG Road ", notes: "Knee injury; go easy" });
    assert.deepEqual([d.email, d.heightCm, d.weightKg, d.address], ["kiran@example.com", 172, 68.3, "12, MG Road"]);
    for (const bad of [{ email: "not-an-email" }, { heightCm: 20 }, { heightCm: 170.5 }, { weightKg: 500 }, { weightKg: "70" }]) refuses(() => rules.admissionBody({ ...base, paid: 1500, ...bad }), /email|height|weight/);
    assert.deepEqual(rules.memberEditBody({ email: "", weightKg: 70 }), { email: null, weightKg: 70 });
  });

  it("due dates: needed when something is owed, from today to a year ahead", () => {
    const today = rules.todayInIndia();
    const ok = { name: "Ravi", unit: "months", duration: 1, fee: 1500, paid: 1000, method: "cash" };
    refuses(() => rules.admissionBody(ok), /date the rest should be paid by/);
    for (const bad of [rules.addDays(today, -1), rules.addDays(today, 366), "2026-02-30", "11-11-2026"]) refuses(() => rules.admissionBody({ ...ok, dueBy: bad }), /from today to a year ahead/);
    assert.equal(rules.admissionBody({ ...ok, dueBy: today }).dueBy, today, "today is fine");
    assert.equal(rules.admissionBody({ ...ok, paid: 1500, dueBy: rules.addDays(today, 3) }).dueBy, null, "paid in full: no date kept");
    assert.deepEqual(rules.duePaymentBody({ amount: 500, method: "cash" }), { amount: 500, method: "cash", paidOn: today });
    assert.equal(rules.duePaymentBody({ amount: 500, method: "cash", dueBy: rules.addDays(today, 10) }).dueBy, rules.addDays(today, 10));
  });

  it("renewals, due payments, sales and enquiries", () => {
    const soon = rules.addDays(rules.todayInIndia(), 7);
    assert.deepEqual(rules.renewalBody({ unit: "months", duration: 12, fee: 12000, paid: 10000, method: "cash", dueBy: soon }), { unit: "months", duration: 12, fee: 12000, paid: 10000, due: 2000, dueBy: soon, method: "cash" });
    refuses(() => rules.renewalBody({ unit: "months", duration: 12, fee: 12000, paid: 10000, method: "cash", memberId: 3 }), /fields/);
    assert.deepEqual(rules.duePaymentBody({ amount: 500, method: "online" }), { amount: 500, method: "online", paidOn: rules.todayInIndia() });
    refuses(() => rules.duePaymentBody({ amount: -5, method: "online" }), /rupees/);
    assert.deepEqual(rules.saleBody({ item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" }), { item: "Whey Protein 1kg", detail: "Supplement", amount: 3200, method: "cash" });
    const month = { unit: "months", duration: 1 };
    assert.deepEqual(rules.ptBody({ package: " 12  sessions ", amount: 6000, method: "online", ...month }), { package: "12 sessions", amount: 6000, method: "online", unit: "months", duration: 1 });
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online", ...month, trainerId: 1 }), /fields/);
    refuses(() => rules.ptBody({ package: "x", amount: 6000, method: "online", ...month }), /PT package/);
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online" }), /duration type/, "PT needs its period");
    const today = rules.todayInIndia();
    assert.equal(rules.duePaymentBody({ amount: 1, method: "cash" }).paidOn, today);
    assert.equal(rules.duePaymentBody({ amount: 1, method: "cash", paidOn: rules.addDays(today, -3) }).paidOn, rules.addDays(today, -3));
    refuses(() => rules.duePaymentBody({ amount: 1, method: "cash", paidOn: rules.addDays(today, 1) }), /collected date/);
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

describe("gym rules: member IDs and gender", () => {
  it("IDs: three letters of the gym and of the branch, then the branch's number", () => {
    assert.equal(rules.memberCode("Forma", "Tumkur", 1), "FOR-TUM-0001");
    assert.equal(rules.memberCode("Just Fit", "Anna Nagar", 107), "JUS-ANN-0107");
    assert.equal(rules.memberCode("F2", "No. 1", 12345), "F-NO-12345", "letters only; long numbers aren't cut");
    assert.equal(rules.memberCode("123", "!!", 5), "GYM-BR-0005", "a name with no letters");
  });

  it("gender is optional, from a fixed list; there is no batch", () => {
    const ok = { name: "Ravi", unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" };
    assert.equal(rules.admissionBody(ok).gender, null);
    assert.equal(rules.admissionBody({ ...ok, gender: "female" }).gender, "female");
    refuses(() => rules.admissionBody({ ...ok, gender: "unknown" }), /male, female or other/);
    refuses(() => rules.admissionBody({ ...ok, batch: "evening" }), /fields/, "batch was removed");
    refuses(() => rules.admissionBody({ ...ok, code: "FOR-TUM-9999" }), /fields/, "the ID is never sent by the app");
    assert.deepEqual(rules.memberEditBody({ gender: "other" }), { gender: "other" });
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
