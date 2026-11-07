// Pause Membership's pure rules (gym/pauseRules.js): the request body for members and staff, the
// decision body, the list query, when a membership can be paused, when a request can be decided,
// and the plan's new end.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/pauseRules.js");

const today = "2026-11-07";

describe("gym pause rules", () => {
  it("reads a member's request: dates from today to 60 days ahead, 1 to 90 days, a reason", () => {
    assert.deepEqual(rules.pauseBody({ from: "2026-11-10", until: "2026-11-20", reason: "Travelling for work" }, today), { from: "2026-11-10", until: "2026-11-20", days: 11, reason: "Travelling for work" });
    assert.equal(rules.pauseBody({ from: today, until: today, reason: "Unwell" }, today).days, 1, "one day: from and until the same");
    assert.equal(rules.pauseBody({ from: today, until: "2027-02-04", reason: "Exams" }, today).days, 90, "the longest pause");
    assert.throws(() => rules.pauseBody({ from: today, until: "2027-02-05", reason: "Exams" }, today), /1 to 90 days/);
    assert.throws(() => rules.pauseBody({ from: "2026-11-06", until: "2026-11-20", reason: "Yesterday" }, today), /from today/, "a member can't backdate");
    assert.throws(() => rules.pauseBody({ from: "2027-01-07", until: "2027-01-10", reason: "Too far" }, today), /from today/, "61 days ahead");
    assert.throws(() => rules.pauseBody({ from: "2026-11-20", until: "2026-11-10", reason: "Backwards" }, today), /on or after the start/);
    for (const from of ["2026-02-30", "7 Nov 2026", "", null, 20261107, "2026-11-07T00:00:00Z"]) assert.throws(() => rules.pauseBody({ from, until: "2026-11-20", reason: "Bad date" }, today), { status: 400 }, String(from));
    for (const reason of ["", "ok", null, 7, "x".repeat(401)]) assert.throws(() => rules.pauseBody({ from: today, until: "2026-11-20", reason }, today), { status: 400 }, String(reason));
    assert.equal(rules.pauseBody({ from: today, until: today, reason: "  Trip <script>alert(1)</script>  " }, today).reason, "Trip script alert(1) /script", "the reason is cleaned");
    assert.throws(() => rules.pauseBody({ from: today, until: today, reason: "Trip", status: "approved" }, today), /fields we don't use/, "nothing picks the status");
    assert.throws(() => rules.pauseBody({ from: today, until: today, reason: "Trip", memberId: 9 }, today), /fields we don't use/);
    for (const body of [null, [], "x", 1]) assert.throws(() => rules.pauseBody(body, today), /JSON/);
  });

  it("lets staff date a pause up to 30 days back, no further", () => {
    assert.equal(rules.pauseBody({ from: "2026-10-08", until: "2026-10-20", reason: "Was away" }, today, { staff: true }).days, 13);
    assert.throws(() => rules.pauseBody({ from: "2026-10-07", until: "2026-10-20", reason: "Too far back" }, today, { staff: true }), /30 days ago/);
    assert.throws(() => rules.pauseBody({ from: "2027-01-07", until: "2027-01-10", reason: "Too far" }, today, { staff: true }), /60 days ahead/);
  });

  it("reads an optional note on a decision", () => {
    assert.deepEqual(rules.decisionBody(undefined), { note: null });
    assert.deepEqual(rules.decisionBody({}), { note: null });
    assert.deepEqual(rules.decisionBody({ note: "" }), { note: null });
    assert.deepEqual(rules.decisionBody({ note: " Renew first " }), { note: "Renew first" });
    assert.throws(() => rules.decisionBody({ note: "x".repeat(201) }), /200 characters/);
    assert.throws(() => rules.decisionBody({ note: "ok", status: "approved" }), /fields we don't use/);
    assert.throws(() => rules.decisionBody({ note: 5 }), /200 characters/);
  });

  it("reads the list view and a pause id", () => {
    assert.deepEqual(rules.listQuery({}), { view: "pending" });
    assert.deepEqual(rules.listQuery({ view: "all" }), { view: "all" });
    for (const view of ["approved", "1 OR 1=1", "PENDING"]) assert.throws(() => rules.listQuery({ view }), /pending or all/);
    assert.equal(rules.pauseId("12"), 12);
    for (const id of ["0", "-1", "1.5", "1 OR 1=1", "", undefined, "99999999999"]) assert.throws(() => rules.pauseId(id), /doesn't exist/, String(id));
  });

  it("knows an open pause and a pause running today", () => {
    const pending = { status: "pending", from: "2026-11-10", until: "2026-11-20" };
    const approved = { status: "approved", from: "2026-11-05", until: "2026-11-09" };
    const over = { status: "approved", from: "2026-10-01", until: "2026-10-10" };
    assert.equal(rules.isOpen(pending, today), true);
    assert.equal(rules.isOpen(approved, today), true);
    assert.equal(rules.isOpen(over, today), false);
    assert.equal(rules.isOpen({ ...pending, status: "rejected" }, today), false);
    assert.equal(rules.isOpen(null, today), false);
    assert.equal(rules.pausedOn(approved, today), true);
    assert.equal(rules.pausedOn({ ...approved, from: "2026-11-08" }, today), false, "starts tomorrow");
    assert.equal(rules.pausedOn(pending, today), false, "not approved yet");
  });

  it("says why a membership can't be paused", () => {
    const member = { expiresOn: "2026-12-31" };
    assert.equal(rules.pauseProblem(member, null, "2026-11-10", today), null);
    assert.match(rules.pauseProblem({ expiresOn: "2026-11-06" }, null, "2026-11-10", today), /has ended/);
    assert.match(rules.pauseProblem(member, { status: "pending", until: "2026-11-20" }, "2026-11-10", today), /already waiting/);
    assert.match(rules.pauseProblem(member, { status: "approved", until: "2026-11-20" }, "2026-11-10", today), /already paused until 2026-11-20/);
    assert.match(rules.pauseProblem(member, null, "2027-01-01", today), /after the plan ends/);
    assert.equal(rules.pauseProblem(member, null, "2026-12-31", today), null, "may start on the last day");
  });

  it("decides only a pending request, and extends the plan by the days", () => {
    assert.equal(rules.decisionProblem({ status: "pending" }), null);
    assert.match(rules.decisionProblem({ status: "approved" }), /already approved/);
    assert.match(rules.decisionProblem({ status: "rejected" }), /already rejected/);
    assert.match(rules.decisionProblem({ status: "cancelled" }), /cancelled/);
    assert.equal(rules.extendedUntil("2026-12-31", 11), "2027-01-11");
    assert.equal(rules.daysBetween("2026-11-10", "2026-11-20"), 11);
  });
});
