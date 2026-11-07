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
    refuses(() => rules.admissionBody({ ...ok, unit: "weeks" }), /whole months now/);
    // Day plans ended on 2026-11-07: days are refused, and `unit` may be left out
    refuses(() => rules.planLength({ unit: "days", duration: 15 }), /whole months now/);
    assert.deepEqual(rules.planLength({ duration: 15 }), { unit: "months", duration: 15 });
    refuses(() => rules.planLength({ duration: 0 }), /1 to 24 months/);
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
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online", ...month, gymId: 1 }), /fields/);
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online", ...month, trainerId: 1 }), /trainers/, "a trainer is an account id, not a number");
    refuses(() => rules.ptBody({ package: "x", amount: 6000, method: "online", ...month }), /PT package/);
    refuses(() => rules.ptBody({ package: "12 sessions", amount: 6000, method: "online" }), /1 to 24 months/, "PT needs its period");
    // Start and end dates picked by hand
    const ptToday = rules.todayInIndia();
    const base = { package: "12 sessions", amount: 6000, method: "online", ...month };
    assert.deepEqual(rules.ptBody({ ...base, startsOn: ptToday, endsOn: rules.addDays(ptToday, 9) }), { ...base, package: "12 sessions", startsOn: ptToday, endsOn: rules.addDays(ptToday, 9) });
    assert.deepEqual(rules.ptBody({ ...base, startsOn: "", endsOn: null }), base, "blank dates are left out");
    for (const bad of [rules.addDays(ptToday, -366), rules.addDays(ptToday, 61), "2026-02-30", "07-11-2026"]) refuses(() => rules.ptBody({ ...base, startsOn: bad }), /start date from a year ago to two months ahead/);
    refuses(() => rules.ptBody({ ...base, endsOn: "2026-02-30" }), /end date within 24 months/);
    // ptPeriod: the dates picked, else following on from a running PT, else today
    const running = rules.addDays(ptToday, 20);
    assert.deepEqual(rules.ptPeriod(rules.ptBody(base), running, ptToday), { from: rules.addDays(running, 1), until: rules.planEnd(rules.addDays(running, 1), 1) }, "follows on");
    assert.deepEqual(rules.ptPeriod(rules.ptBody(base), rules.addDays(ptToday, -1), ptToday), { from: ptToday, until: rules.planEnd(ptToday, 1) }, "an ended PT: from today");
    assert.deepEqual(rules.ptPeriod(rules.ptBody({ ...base, startsOn: ptToday }), running, ptToday), { from: ptToday, until: rules.planEnd(ptToday, 1) }, "a picked start wins over the follow-on");
    assert.deepEqual(rules.ptPeriod(rules.ptBody({ ...base, startsOn: ptToday, endsOn: rules.addDays(ptToday, 44) }), null, ptToday), { from: ptToday, until: rules.addDays(ptToday, 44) }, "a picked end wins over the duration");
    refuses(() => rules.ptPeriod(rules.ptBody({ ...base, startsOn: ptToday, endsOn: rules.addDays(ptToday, -1) }), null, ptToday), /before the start date/);
    refuses(() => rules.ptPeriod(rules.ptBody({ ...base, startsOn: ptToday, endsOn: rules.addDays(rules.planEnd(ptToday, 24), 1) }), null, ptToday), /within 24 months/);
    const today = rules.todayInIndia();
    assert.equal(rules.duePaymentBody({ amount: 1, method: "cash" }).paidOn, today);
    assert.equal(rules.duePaymentBody({ amount: 1, method: "cash", paidOn: rules.addDays(today, -3) }).paidOn, rules.addDays(today, -3));
    refuses(() => rules.duePaymentBody({ amount: 1, method: "cash", paidOn: rules.addDays(today, 1) }), /collected date/);
    refuses(() => rules.saleBody({ item: "Whey", category: "__proto__", amount: 3200, method: "cash" }), /what was sold/);
    assert.deepEqual(rules.enquiryBody({ name: "Priya", phone: "", note: "  Evening batch?  " }), { name: "Priya", phone: null, note: "Evening batch?", interest: null, source: null, followUpOn: null });
    assert.equal(rules.enquiryBody({ name: "Priya" }).note, null);
    // QA 2026-11-04: a note that isn't text was saved as "object Object"
    for (const note of [{ a: 1 }, ["x"], 42, true]) assert.throws(() => rules.enquiryBody({ name: "Priya", note }), /note as text/);
  });

  it("enquiry follow-up: interest, source, the call-back day, status and the member they became", () => {
    const today = "2026-11-05";
    const full = rules.enquiryBody({ name: "Priya", phone: "9123456780", note: "Evenings", interest: "pt", source: "instagram", followUpOn: "2026-11-06" }, today);
    assert.deepEqual(full, { name: "Priya", phone: "9123456780", note: "Evenings", interest: "pt", source: "instagram", followUpOn: "2026-11-06" });
    assert.equal(rules.enquiryBody({ name: "Priya", interest: "", source: "", followUpOn: "" }, today).followUpOn, null, "blank means none");
    refuses(() => rules.enquiryBody({ name: "Priya", interest: "yoga" }, today), /interested in/);
    refuses(() => rules.enquiryBody({ name: "Priya", source: "__proto__" }, today), /found the gym/);
    refuses(() => rules.enquiryBody({ name: "Priya", status: "joined" }, today), /fields/, "a new enquiry can't be added as joined");
    for (const bad of ["2027-11-06", "2025-11-04", "2026-02-30", "06-11-2026", 20261106]) refuses(() => rules.enquiryBody({ name: "Priya", followUpOn: bad }, today), /follow-up date/);
    assert.equal(rules.followUpDate("2025-11-05", today), "2025-11-05", "a year back is kept (an edit saved as it was)");

    assert.deepEqual(rules.enquiryEditBody({ status: "lost" }, today), { status: "lost" });
    assert.deepEqual(rules.enquiryEditBody({ followUpOn: "" }, today), { followUpOn: null });
    assert.deepEqual(rules.enquiryEditBody({ status: "joined", memberId: 7 }, today), { status: "joined", memberId: 7 });
    refuses(() => rules.enquiryEditBody({ status: "joined" }, today), /Convert the enquiry/);
    refuses(() => rules.enquiryEditBody({ memberId: 7 }, today), /only be linked/);
    refuses(() => rules.enquiryEditBody({ status: "lost", memberId: 7 }, today), /only be linked/);
    for (const memberId of ["7", 0, -1, 1.5, 2 ** 40]) refuses(() => rules.enquiryEditBody({ status: "joined", memberId }, today), /member doesn't exist/);
    refuses(() => rules.enquiryEditBody({ status: "won" }, today), /Pick a status/);
    refuses(() => rules.enquiryEditBody({}, today), /Change something/);
    refuses(() => rules.enquiryEditBody({ gymId: 2 }, today), /fields/);

    assert.deepEqual(rules.enquiriesQuery({}), { view: "open", search: "" });
    assert.deepEqual(rules.enquiriesQuery({ view: "overdue", search: " Priya " }), { view: "overdue", search: "Priya" });
    refuses(() => rules.enquiriesQuery({ view: "e.status" }), /Pick a list/);
    refuses(() => rules.enquiriesQuery({ search: "x".repeat(61) }), /at most 60/);
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
    assert.deepEqual(rules.membersQuery({}), { filter: "all", search: "", days: 3 });
    assert.deepEqual(rules.membersQuery({ filter: "due", search: " asif " }), { filter: "due", search: "asif", days: 3 });
    refuses(() => rules.membersQuery({ filter: "everyone" }), /filter/);
    // Expiring soon looks as many days ahead as the chips ask: 1 to 90, 3 when nothing is sent
    assert.equal(rules.membersQuery({ filter: "expiring_soon", days: "30" }).days, 30);
    assert.equal(rules.membersQuery({ filter: "expiring_soon", days: "" }).days, 3);
    assert.equal(rules.membersQuery({ filter: "expiring_soon", days: "90" }).days, 90);
    assert.equal(rules.membersQuery({ filter: "expiring_soon", days: "all" }).days, "all", "every plan still running");
    for (const bad of ["0", "91", "999", "-3", "3.5", "seven", " 7", ["7"], 7, "ALL", "all "]) refuses(() => rules.membersQuery({ filter: "expiring_soon", days: bad }), /days ahead/);
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
    assert.deepEqual(rules.gymDetailsBody({ branch: "Tumkur", city: "Tumakuru" }), { branch: "Tumkur", city: "Tumakuru" });
    refuses(() => rules.gymDetailsBody({ name: "Renamed gym" }), /fields/, "a gym admin can't rename the whole gym");
    refuses(() => rules.gymDetailsBody({ branch: "Tumkur", adminName: "Arjun" }), /fields/, "the admin's name is no longer edited here");
    refuses(() => rules.branchBody({ branch: "Gubbi" }), /area/, "a new branch needs its location");
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

describe("gym rules: catalogue stock and selling to a member", () => {
  it("catalogue items: plans and PT have a length, products may have stock", () => {
    assert.deepEqual(rules.catalogBody({ kind: "pt", name: "1 Month PT", unit: "months", duration: 1, price: 5000 }, { creating: true }), { kind: "pt", name: "1 Month PT", unit: "months", duration: 1, price: 5000 });
    assert.deepEqual(rules.catalogBody({ kind: "product", name: "Whey Protein 1kg", price: 3200, stock: 18 }, { creating: true }), { kind: "product", name: "Whey Protein 1kg", price: 3200, stock: 18 });
    assert.equal(rules.catalogBody({ kind: "product", name: "Shaker Bottle", price: 350 }, { creating: true }).stock, undefined, "stock is optional");
    assert.deepEqual(rules.catalogBody({ stock: "" }, { creating: false }), { stock: null }, "cleared: no longer counted");
    assert.deepEqual(rules.catalogBody({ stock: 0 }, { creating: false }), { stock: 0 });
    refuses(() => rules.catalogBody({ kind: "pt", name: "PT", price: 100 }, { creating: true }), /PT package's duration/);
    refuses(() => rules.catalogBody({ kind: "service", name: "Diet", unit: "months", duration: 1, price: 100 }, { creating: true }), /Only plans and PT/);
    refuses(() => rules.catalogBody({ kind: "service", name: "Diet", price: 100, stock: 5 }, { creating: true }), /Only products have stock/);
    for (const stock of [-1, 1.5, "18", 100001]) refuses(() => rules.catalogBody({ stock }, { creating: false }), /stock as a whole number/);
  });

  it("a member sale: the item, quantity, discount, collected now, the date; never a price", () => {
    const ok = { itemId: 7, quantity: 2, discount: 100, paid: 3000, method: "online" };
    assert.deepEqual(rules.memberSaleBody(ok, { product: true }, "2026-11-04"), { itemId: 7, quantity: 2, discount: 100, paid: 3000, method: "online", paidOn: "2026-11-04", dueBy: null });
    assert.equal(rules.memberSaleBody({ itemId: 7, paid: 1000, method: "cash" }, { product: false }).quantity, 1, "a service is one");
    assert.equal(rules.memberSaleBody({ ...ok, discount: "" }, { product: true }).discount, 0);
    assert.equal(rules.memberSaleBody({ ...ok, dueBy: "2026-11-10" }, { product: true }, "2026-11-04").dueBy, "2026-11-10");
    refuses(() => rules.memberSaleBody({ ...ok, price: 1 }, { product: true }), /fields/, "the price is the catalogue's");
    refuses(() => rules.memberSaleBody({ ...ok, gymId: 2 }, { product: true }), /fields/);
    refuses(() => rules.memberSaleBody(ok, { product: false }), /fields/, "a service has no quantity");
    for (const quantity of [0, 101, 1.5, "2"]) refuses(() => rules.memberSaleBody({ ...ok, quantity }, { product: true }), /quantity/);
    for (const itemId of [0, "7", "7 OR 1=1", null]) refuses(() => rules.memberSaleBody({ ...ok, itemId }, { product: true }), /Pick the product/);
    refuses(() => rules.memberSaleBody({ ...ok, paid: 0 }, { product: true }), /amount collected/);
    refuses(() => rules.memberSaleBody({ ...ok, discount: -5 }, { product: true }), /discount/);
    refuses(() => rules.memberSaleBody({ ...ok, method: "card" }, { product: true }), /online or cash/);
    refuses(() => rules.memberSaleBody({ ...ok, paidOn: "2026-11-05" }, { product: true }, "2026-11-04"), /payment date/, "not in the future");
    refuses(() => rules.memberSaleBody({ ...ok, dueBy: "2026-11-01" }, { product: true }, "2026-11-04"), /paid by/);
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
  });

  it("a renewal follows on from the current plan, or starts today once it has ended", () => {
    assert.equal(rules.renewedUntil("2026-11-10", "2026-11-04", 1), "2026-12-10", "still running: the new month starts on the 11th");
    assert.equal(rules.renewedUntil("2026-11-04", "2026-11-04", 1), "2026-12-04", "ends today: starts tomorrow");
    assert.equal(rules.renewedUntil("2026-10-01", "2026-11-04", 3), "2027-02-03", "ended: starts today");
  });
});
