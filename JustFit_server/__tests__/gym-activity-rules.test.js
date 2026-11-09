// Activity log's pure rules (gym/activityRules.js): every write route is recorded as the right
// change, the line names what changed (values only for prices, amounts, dates and statuses, never
// a phone number or a note), and the log's query is checked.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/activityRules.js");

const TODAY = "2026-11-09";

describe("gym activity rules", () => {
  it("knows every write route of the gym router, so none goes unrecorded", () => {
    const { gymRouter } = require("../gym/routes");
    const writes = gymRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((m) => [m.toUpperCase(), layer.route.path]))
      .filter(([method]) => !["GET", "HEAD"].includes(method));
    assert.ok(writes.length > 40, "the router's writes were found");
    for (const [method, path] of writes) {
      const sample = path.replace(/:[A-Za-z]+/g, (p) => (p === ":kind" ? "due" : p === ":userId" ? "user_Ab12" : "7"));
      const found = rules.routeOf(method, sample);
      assert.notEqual(found, undefined, `${method} ${path} isn't in activityRules.ROUTES`);
      // Only the login's own view records nothing: switching branch, arranging Home's tiles
      if (!["/branch", "/home-tiles"].includes(path)) assert.ok(found.entry, `${method} ${path} records something`);
      else assert.equal(found.entry, null, `${method} ${path} records nothing`);
    }
  });

  it("reads the record's id from the path, whatever the case or a trailing slash", () => {
    assert.deepEqual(rules.routeOf("PATCH", "/members/12"), { entry: rules.routeOf("PATCH", "/members/12").entry, id: "12" });
    assert.equal(rules.routeOf("patch", "/Members/12/").id, "12");
    assert.equal(rules.routeOf("DELETE", "/catalog/5").entry.action, "delete");
    assert.equal(rules.routeOf("PUT", "/templates/added/3").entry.target, "template", "an added template, not a reminder kind");
    assert.equal(rules.routeOf("PUT", "/templates/due").entry.target, undefined);
    assert.equal(rules.routeOf("POST", "/branch").entry, null, "switching branch changes nothing");
    assert.equal(rules.routeOf("GET", "/members"), undefined, "reads aren't recorded");
    assert.equal(rules.routeOf("DELETE", "/staff/%E0%A4%A").id, null, "a broken escape doesn't throw");
  });

  it("names the changed fields, with values only for the business record", () => {
    const member = { full_name: "Arjun M", phone: "9876500001", weight_kg: "72.0", address: "MG Road", dob: new Date("1999-01-02T00:00:00Z"), notes: null };
    assert.equal(rules.changes("member", member, { ...member, phone: "9876500002", weight_kg: "70.5", notes: "" }), "Changed: mobile, weight");
    assert.equal(rules.changes("member", member, { ...member, dob: new Date("1999-01-02T00:00:00Z") }), "Saved with no changes");
    const line = rules.changes("member", member, { ...member, phone: "9123456789" });
    assert.doesNotMatch(line, /9123456789|9876500001/, "a phone number never goes into the log");
    const item = { kind: "plan", name: "Gold", duration: 3, price: 1500, stock: null, image_key: null };
    assert.equal(rules.changes("catalog", item, { ...item, price: 1800, duration: 6 }), "Changed: duration 3 → 6, price ₹1,500 → ₹1,800");
    const enquiry = { full_name: "Sneha", status: "new", follow_up_on: null, note: "wants mornings" };
    assert.equal(rules.changes("enquiry", enquiry, { ...enquiry, status: "joined", note: "joined today" }), "Changed: note, status New → Joined");
    const expense = { category: "rent", title: null, amount: 20000, method: "online", spent_on: new Date("2026-11-01T00:00:00Z"), paid_to: "Mr Rao" };
    assert.equal(rules.changes("expense", expense, { ...expense, amount: 21000, paid_to: "Mrs Rao" }), "Changed: paid to, amount ₹20,000 → ₹21,000");
    assert.equal(rules.changes("member", null, member), null);
  });

  it("labels records as they were, so a deleted one still reads", () => {
    assert.equal(rules.labelOf("member", { full_name: "Arjun M", member_code: "FOR-TUM-0003" }), "Arjun M (FOR-TUM-0003)");
    assert.equal(rules.labelOf("catalog", { kind: "plan", name: "Gold" }), "Plan Gold");
    assert.equal(rules.labelOf("expense", { title: null, category: "rent" }), "Rent");
    assert.equal(rules.labelOf("team", { full_name: " ", verified_phone: "9876543210" }), "+91 ••••• ••210", "a team member without a name: the masked number");
    const deleted = rules.rowFor(rules.routeOf("DELETE", "/catalog/5").entry, { before: { kind: "product", name: "Whey 1kg", price: 2400 }, after: null, body: {} });
    assert.deepEqual(deleted, { action: "delete", type: "catalog", label: "Product Whey 1kg", detail: "Was ₹2,400" });
    const admitted = rules.rowFor(rules.routeOf("POST", "/members").entry, { body: { name: "Arjun M", paid: 1500, method: "cash", phone: "9876500001" }, answer: { member: { name: "Arjun M", code: "FOR-TUM-0003" } } });
    assert.deepEqual(admitted, { action: "create", type: "member", label: "Arjun M (FOR-TUM-0003)", detail: "New member · paid ₹1,500 · cash" });
    const contact = rules.rowFor(rules.routeOf("POST", "/enquiries/4/contacts").entry, { before: { full_name: "Sneha" }, body: { kind: "call", outcome: "no_answer" } });
    assert.equal(contact.detail, "Logged a call: no answer");
    const planned = rules.rowFor(rules.routeOf("POST", "/enquiries/4/contacts").entry, { before: { full_name: "Sneha" }, body: { kind: "call", outcome: "reached", note: "Price is high", followUpOn: "2026-11-12" } });
    assert.equal(planned.detail, "Logged a call: reached, next follow-up 2026-11-12", "the date, never the note");
    const long = rules.rowFor(rules.routeOf("POST", "/services").entry, { body: { item: "x".repeat(300), amount: 100, method: "cash" } });
    assert.ok(long.label.length <= 120 && long.detail.length <= 200);
  });

  it("checks the log's query: a day in the last year, a kind, a person, a page", () => {
    assert.deepEqual(rules.activityQuery({}, TODAY), { day: TODAY, action: "all", person: "all", page: 1 });
    assert.deepEqual(rules.activityQuery({ day: "2026-11-01", action: "delete", person: "user_Ab12", page: "2" }, TODAY), { day: "2026-11-01", action: "delete", person: "user_Ab12", page: 2 });
    for (const day of ["2026-11-10", "2025-11-08", "09-11-2026", "2026-13-01", "today"]) assert.throws(() => rules.activityQuery({ day }, TODAY), { status: 400 }, day);
    for (const action of ["remove", "ALL", "1 OR 1=1"]) assert.throws(() => rules.activityQuery({ action }, TODAY), { status: 400 }, action);
    for (const person of ["x' OR 1=1", "a".repeat(65), ["u1"]]) assert.throws(() => rules.activityQuery({ person }, TODAY), { status: 400 }, String(person));
    for (const page of ["0", "-1", "1.5", "abc"]) assert.throws(() => rules.activityQuery({ page }, TODAY), { status: 400 }, page);
    assert.throws(() => rules.activityQuery({ gymId: "2" }, TODAY), /fields we don't use/);
  });
});
