// Gym predictions end to end: the renewal-risk list and Home's count, against the real Express
// server and justfit_test. Two gyms; gym A gets members whose records should score High
// (Ravi), Medium (Sneha), Low (steady, and one on PT; listed too since 2026-11-07) and one expired
// too long ago to be scored.
// Attack paths: no session, member and admin roles, a gym admin with no gym, another gym's staff
// (isolation), a bad level, SQL in the search, an oversized search.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");
const predictionRules = require("../../gym/predictionRules.js");

describe("gym predictions e2e: who may not renew, and tomorrow's busy hours", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  const days = (n) => rules.addDays(today, n);

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({ get: (route) => api("GET", route, tokens[tag]), post: (route, body) => api("POST", route, tokens[tag], body ?? {}), patch: (route, body) => api("PATCH", route, tokens[tag], body) });
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  // A member of gym A: the admission through the API, then the plan's end set directly
  const admit = async (name, { expiresIn, due = 0 }) => {
    const body = { name, unit: "months", duration: 3, fee: 4500, paid: 4500 - due, method: "cash", ...(due > 0 ? { dueBy: days(5) } : {}) };
    const r = await as("gymA").post("/api/gym/members", body);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await connection.query("UPDATE gym_members SET expires_on = ?, joined_on = ? WHERE id = ?", [days(expiresIn), days(-100), r.json.member.id]);
    return r.json.member.id;
  };
  // Visits on the given days back (each a finished visit, as the staff desk would have recorded)
  const visits = async (memberId, daysBack) => {
    for (const n of daysBack) {
      await connection.query(
        "INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, in_source, out_source, duration_min) VALUES (?, ?, ?, ?, ?, 'completed', 'staff', 'staff', 60)",
        [state.gymA, memberId, days(-n), `${days(-n)} 07:00:00`, `${days(-n)} 08:00:00`],
      );
    }
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["loner", "gym_admin"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_enquiry_contacts", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms, each with its gym admin, and gym A's members with their visits", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    state.gymB = (await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" })).json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);

    // Ravi: plan ends in 5 days, last visit 12 days ago, ₹800 due → 30 + 30 + 20 = 80, High
    state.ravi = await admit("Ravi Kumar", { expiresIn: 5, due: 800 });
    await visits(state.ravi, [12, 20, 40, 45]);
    // Sneha: plan ends in 6 days, 8 visits the month before and 3 this month (last one 2 days ago) → 30 + 20 = 50, Medium
    state.sneha = await admit("Sneha R", { expiresIn: 6 });
    await visits(state.sneha, [2, 4, 6, 35, 36, 38, 40, 42, 44, 46, 48]);
    // Steady: plan runs for months, came yesterday → 0, Low
    state.steady = await admit("Steady Sam", { expiresIn: 90 });
    await visits(state.steady, [1, 3, 5, 33, 35]);
    // On PT: plan ends in 3 days but PT is running → 30 − 15 = 15, Low
    state.pt = await admit("Priya PT", { expiresIn: 3 });
    await visits(state.pt, [1]);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.pt}/pt`, { package: "12 sessions", amount: 6000, method: "online", unit: "months", duration: 1 })).status, 200);
    // Gone: plan ended 20 days ago, never visited → would score High, but is past the week of grace
    state.gone = await admit("Gone Guy", { expiresIn: -20 });
  }));

  it("2. the list: Ravi High with his three reasons, Sneha Medium, then the two Low members; the lapsed one is not scored", run(async () => {
    const r = await as("gymA").get("/api/gym/predictions/renewals");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.gym.name, r.json.gym.branch, r.json.gym.area, r.json.gym.city], ["Forma", "Tumkur", "Batawadi", "Tumakuru"]);
    assert.equal(r.json.today, today);
    assert.match(r.json.calculatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(r.json.counts, { high: 1, medium: 1, low: 2 });
    assert.deepEqual(r.json.members.map((m) => [m.name, m.risk.score, m.risk.level]), [["Ravi Kumar", 80, "high"], ["Sneha R", 50, "medium"], ["Priya PT", 15, "low"], ["Steady Sam", 0, "low"]], "highest first; Gone Guy is past the week of grace");
    assert.deepEqual(r.json.members[3].risk.reasons, [], "a clean Low member has no reasons");

    const [ravi, sneha] = r.json.members;
    assert.deepEqual(ravi.risk.reasons, [{ points: 30, text: "Plan ends in 5 days" }, { points: 30, text: "No visit in 12 days" }, { points: 20, text: "₹800 due" }]);
    assert.deepEqual([ravi.risk.lastVisit, ravi.risk.visitsLast, ravi.risk.visitsPrior, ravi.due, ravi.expiresOn], [days(-12), 2, 2, 800, days(5)]);
    assert.equal(ravi.code, "FOR-TUM-0001", "the usual member fields come along");
    assert.deepEqual(sneha.risk.reasons.map((x) => x.text), ["Plan ends in 6 days", "Visits down from 8 to 3 a month"]);
    assert.deepEqual([sneha.risk.visitsLast, sneha.risk.visitsPrior], [3, 8]);
  }));

  it("3. one level at a time, search, and bad queries", run(async () => {
    const gym = as("gymA");
    assert.deepEqual((await gym.get("/api/gym/predictions/renewals?level=high")).json.members.map((m) => m.name), ["Ravi Kumar"]);
    assert.deepEqual((await gym.get("/api/gym/predictions/renewals?level=medium")).json.members.map((m) => m.name), ["Sneha R"]);
    assert.deepEqual((await gym.get("/api/gym/predictions/renewals?search=rav")).json.members.map((m) => m.name), ["Ravi Kumar"]);
    assert.deepEqual((await gym.get("/api/gym/predictions/renewals?search=FOR-TUM-0002")).json.members.map((m) => m.name), ["Sneha R"], "by member ID");
    const injected = await gym.get(`/api/gym/predictions/renewals?search=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(injected.status, 200);
    assert.deepEqual(injected.json.members, [], "a search is only a bound value");
    assert.deepEqual((await gym.get("/api/gym/predictions/renewals?level=low")).json.members.map((m) => m.name), ["Priya PT", "Steady Sam"], "Low on its own");
    assert.equal((await gym.get("/api/gym/predictions/renewals?level=none")).status, 400);
    assert.equal((await gym.get("/api/gym/predictions/renewals?level=1%20OR%201=1")).status, 400);
    assert.equal((await gym.get(`/api/gym/predictions/renewals?search=${"x".repeat(61)}`)).status, 400);
  }));

  it("4. Home's Needs attention counts the High-risk members", run(async () => {
    const home = await as("gymA").get("/api/gym/dashboard");
    assert.equal(home.status, 200);
    assert.equal(home.json.alerts.renewalRisk, 1);
    assert.equal(home.json.alerts.dueMembers, 1, "the other counts are as before");
  }));

  it("5. only this gym's staff, and only this gym's members", run(async () => {
    assert.equal((await api("GET", "/api/gym/predictions/renewals", null)).status, 401);
    assert.equal((await api("GET", "/api/gym/predictions/renewals", "not-a-token")).status, 401);
    for (const tag of ["member", "admin"]) assert.equal((await as(tag).get("/api/gym/predictions/renewals")).status, 403, `${tag} is refused`);
    assert.equal((await as("loner").get("/api/gym/predictions/renewals")).status, 403, "a gym admin with no gym");
    const b = await as("gymB").get("/api/gym/predictions/renewals");
    assert.equal(b.status, 200);
    assert.deepEqual([b.json.counts, b.json.members], [{ high: 0, medium: 0, low: 0 }, []], "gym B never sees gym A's members");
    assert.equal((await as("gymB").get("/api/gym/dashboard")).json.alerts.renewalRisk, 0);
  }));

  it("6. once Ravi renews and pays, he drops to Low", run(async () => {
    const renewed = await as("gymA").post(`/api/gym/members/${state.ravi}/renew`, { unit: "months", duration: 3, fee: 4500, paid: 4500, method: "cash" });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    assert.equal(renewed.json.member.due, 800, "a renewal doesn't clear what was owed before");
    const renewedOnly = await as("gymA").get("/api/gym/predictions/renewals");
    assert.deepEqual(renewedOnly.json.members.slice(0, 2).map((m) => [m.name, m.risk.score, m.risk.level]), [["Ravi Kumar", 50, "medium"], ["Sneha R", 50, "medium"]], "still no recent visit and ₹800 due: Medium");
    assert.deepEqual(renewedOnly.json.members[0].risk.reasons.map((x) => x.text), ["No visit in 12 days", "₹800 due"]);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.ravi}/due`, { amount: 800, method: "cash" })).status, 200);
    const paid = await as("gymA").get("/api/gym/predictions/renewals");
    assert.deepEqual(paid.json.members.map((m) => [m.name, m.risk.level]), [["Sneha R", "medium"], ["Ravi Kumar", "low"], ["Priya PT", "low"], ["Steady Sam", "low"]], "only the old visit remains against Ravi, which is Low");
    assert.deepEqual(paid.json.counts, { high: 0, medium: 1, low: 3 });
  }));

  // Busy hours, at gym B (no attendance yet). Check-ins are inserted at an India-time hour
  // through an epoch, so the hour is the same whatever zone the database session runs in.
  const { forDate, dates } = predictionRules.busyDates(today);
  const visitAt = (memberId, day, hour, minute = 15) =>
    connection.query(
      "INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, status, in_source) VALUES (?, ?, ?, FROM_UNIXTIME(?), 'no_checkout', 'qr')",
      [state.gymB, memberId, day, Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`) / 1000],
    );

  it("7. busy hours: no forecast until the branch has two weeks of check-ins", run(async () => {
    const none = await as("gymB").get("/api/gym/predictions/busy-hours");
    assert.equal(none.status, 200, JSON.stringify(none.json));
    assert.deepEqual([none.json.enough, none.json.weeksUsed, none.json.forDate, none.json.dates, none.json.hours, none.json.total, none.json.busiest, none.json.lastWeek], [false, 0, forDate, dates, [], 0, null, null]);
    assert.match(none.json.calculatedAt, /^\d{4}-\d{2}-\d{2}T/);

    state.b = [];
    for (const name of ["Anil", "Bina", "Chitra", "Dev"]) {
      const r = await as("gymB").post("/api/gym/members", { name, unit: "months", duration: 3, fee: 4500, paid: 4500, method: "cash" });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      state.b.push(r.json.member.id);
    }
    await visitAt(state.b[0], dates[0], 18);
    const one = await as("gymB").get("/api/gym/predictions/busy-hours");
    assert.deepEqual([one.json.enough, one.json.weeksUsed], [false, 1], "one recorded week, even with visits, isn't enough");
  }));

  it("8. busy hours: the hourly average over the recorded weeks, a member once per hour, other weekdays ignored", run(async () => {
    const [anil, bina, chitra, dev] = state.b;
    // 6 pm on the four dates: 3, 2, 4, 3 members → 3 (the first visit at dates[0] is from test 7)
    await visitAt(bina, dates[0], 18, 20); await visitAt(chitra, dates[0], 18, 40);
    await visitAt(anil, dates[1], 18); await visitAt(dev, dates[1], 18);
    for (const m of state.b) await visitAt(m, dates[2], 18);
    await visitAt(bina, dates[3], 18); await visitAt(chitra, dates[3], 18); await visitAt(dev, dates[3], 18);
    // 7 am: Anil twice in the hour on dates[0] (counts once), Bina on dates[1] → 1, 1, 0, 0 → 1
    await visitAt(anil, dates[0], 7, 5); await visitAt(anil, dates[0], 7, 50); await visitAt(bina, dates[1], 7);
    // The day before last week's date is another weekday: ignored
    await visitAt(anil, rules.addDays(dates[0], -1), 18); await visitAt(bina, rules.addDays(dates[0], -1), 18);

    const r = await as("gymB").get("/api/gym/predictions/busy-hours");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.enough, r.json.weeksUsed, r.json.total], [true, 4, 4]);
    const byHour = Object.fromEntries(r.json.hours.map((h) => [h.hour, h]));
    assert.deepEqual(byHour[18], { hour: 18, samples: [3, 2, 4, 3], expected: 3 });
    assert.deepEqual(byHour[7], { hour: 7, samples: [1, 1, 0, 0], expected: 1 });
    assert.deepEqual(byHour[12].samples, [0, 0, 0, 0]);
    assert.deepEqual(r.json.hours.map((h) => h.hour), Array.from({ length: 18 }, (_, i) => i + 5));
    assert.deepEqual(r.json.busiest, { hour: 18, expected: 3 });
    assert.deepEqual(r.json.quietest, { hour: 5, expected: 0 });
    assert.deepEqual(r.json.lastWeek, { date: dates[0], total: 4 });

    // Gym A's forecast is its own: none of gym B's 6 pm visits appear in it
    const a = await as("gymA").get("/api/gym/predictions/busy-hours");
    assert.equal(a.status, 200);
    assert.deepEqual((a.json.hours.find((h) => h.hour === 18) ?? { samples: [] }).samples.filter(Boolean), [], "gym A has no 6 pm visits");
    assert.equal((await api("GET", "/api/gym/predictions/busy-hours", null)).status, 401);
    for (const tag of ["member", "admin", "loner"]) assert.equal((await as(tag).get("/api/gym/predictions/busy-hours")).status, 403, `${tag} is refused`);
  }));

  it("9. revenue: with no history, only what's collected counts and the estimate says it is partial", run(async () => {
    // Gym B so far: four admissions today at ₹4,500 each, nobody ending this month, nothing due
    const r = await as("gymB").get("/api/gym/predictions/revenue");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.month, predictionRules.monthRange(today));
    assert.deepEqual([r.json.collected, r.json.lastMonth], [18000, 0]);
    assert.deepEqual(r.json.renewals, { expiring: 0, priced: 0, sample: { renewed: 0, lapsed: 0 }, rate: null, amount: null });
    assert.deepEqual(r.json.dues, { outstanding: 0, sample: { paid: 0, overdue: 0 }, rate: null, amount: 0 });
    assert.deepEqual([r.json.expected, r.json.complete], [18000, false]);
    assert.match(r.json.calculatedAt, /^\d{4}-\d{2}-\d{2}T/);
  }));

  it("10. revenue: plans ending this month × the branch's renewal rate × their last plan payment, plus dues × the collection rate", run(async () => {
    const gym = as("gymB");
    const { daysLeft } = predictionRules.monthRange(today);
    const [anil, bina, chitra, dev] = state.b;
    // Anil and Bina's plans end this month (₹4,500 each, their admission)
    const ending = rules.addDays(today, Math.min(3, daysLeft));
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id IN (?)", [ending, [anil, bina]]);
    // History: Chitra and Dev renewed (₹1,500 each); three members lapsed 10 days ago → 2 of 5 renew = 40%
    for (const id of [chitra, dev]) assert.equal((await gym.post(`/api/gym/members/${id}/renew`, { unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" })).status, 200);
    for (const name of ["Lapsed One", "Lapsed Two", "Lapsed Three"]) {
      const m = await gym.post("/api/gym/members", { name, unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
      assert.equal(m.status, 201, JSON.stringify(m.json));
      await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [days(-10), m.json.member.id]);
    }
    // Dues: Esha owes ₹2,000 due in two days; Farah owed ₹1,000 since last week and paid ₹500 of it
    const esha = await gym.post("/api/gym/members", { name: "Esha", unit: "months", duration: 3, fee: 4500, paid: 2500, method: "cash", dueBy: days(2) });
    assert.equal(esha.status, 201, JSON.stringify(esha.json));
    const farah = await gym.post("/api/gym/members", { name: "Farah", unit: "months", duration: 3, fee: 4500, paid: 3500, method: "online", dueBy: days(5) });
    assert.equal(farah.status, 201, JSON.stringify(farah.json));
    assert.equal((await gym.post(`/api/gym/members/${farah.json.member.id}/due`, { amount: 500, method: "cash", dueBy: days(5) })).status, 200);
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [days(-5), farah.json.member.id]);

    const r = await gym.get("/api/gym/predictions/revenue");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    // Collected this month: 4 × 4,500 + 2 × 1,500 renewals + 3 × 1,000 + 2,500 + 3,500 + 500 due
    assert.equal(r.json.collected, 30500);
    assert.deepEqual(r.json.renewals, { expiring: 2, priced: 2, sample: { renewed: 2, lapsed: 3 }, rate: 0.4, amount: 3600 }, "(4,500 + 4,500) × 40%");
    assert.deepEqual(r.json.dues, { outstanding: 2500, sample: { paid: 500, overdue: 500 }, rate: 0.5, amount: 1250 }, "Esha's 2,000 due this month plus Farah's 500 overdue, at the 50% the branch collects");
    assert.deepEqual([r.json.expected, r.json.complete], [35350, true]);

    // Gym A's own numbers: Ravi renewed, Gone Guy lapsed → two endings, no rate yet
    const a = await as("gymA").get("/api/gym/predictions/revenue");
    assert.deepEqual([a.json.renewals.sample, a.json.renewals.rate, a.json.complete], [{ renewed: 1, lapsed: 1 }, null, false]);
    assert.equal((await api("GET", "/api/gym/predictions/revenue", null)).status, 401);
    for (const tag of ["member", "admin", "loner"]) assert.equal((await as(tag).get("/api/gym/predictions/revenue")).status, 403, `${tag} is refused`);
  }));

  it("11. enquiries: each open one carries its Hot / Warm / Cold score; logging contacts moves it; Open is hottest first", run(async () => {
    const gym = as("gymB");
    const kiran = (await gym.post("/api/gym/enquiries", { name: "Kiran P", phone: "9000000001", source: "referral", referredBy: "9000000099", interest: "membership" })).json.enquiry;
    assert.deepEqual([kiran.lead, kiran.contacts], [{ score: 30, level: "warm", reasons: [{ points: 30, text: "Referral" }] }, []], "a referral starts Warm at 30");
    const deepa = (await gym.post("/api/gym/enquiries", { name: "Deepa N", phone: "9000000002", source: "instagram" })).json.enquiry;
    assert.deepEqual(deepa.lead, { score: 0, level: "cold", reasons: [] });
    const walk = (await gym.post("/api/gym/enquiries", { name: "Walked In", source: "walk_in", interest: "trial" })).json.enquiry;
    assert.deepEqual([walk.lead.score, walk.lead.level], [50, "warm"], "trial 30 + walk-in 20");

    // Kiran: called today (within 2 days) and reached → +20 = 50; then visited → +20 = 70, Hot
    const called = await gym.post(`/api/gym/enquiries/${kiran.id}/contacts`, { kind: "call", outcome: "reached" });
    assert.equal(called.status, 201, JSON.stringify(called.json));
    assert.deepEqual(called.json.enquiry.lead, { score: 50, level: "warm", reasons: [{ points: 30, text: "Referral" }, { points: 20, text: "Called back within 2 days" }] });
    assert.deepEqual(called.json.enquiry.contacts.map((c) => [c.kind, c.outcome, c.on]), [["call", "reached", today]]);
    const visited = await gym.post(`/api/gym/enquiries/${kiran.id}/contacts`, { kind: "visit" });
    assert.deepEqual([visited.json.enquiry.lead.score, visited.json.enquiry.lead.level], [70, "hot"]);
    assert.deepEqual(visited.json.enquiry.lead.reasons.map((r) => r.text), ["Referral", "Visited the gym", "Called back within 2 days"]);
    // Deepa: no answer twice → 20 − 30, floored at 0
    await gym.post(`/api/gym/enquiries/${deepa.id}/contacts`, { kind: "call", outcome: "no_answer" });
    const twice = await gym.post(`/api/gym/enquiries/${deepa.id}/contacts`, { kind: "whatsapp", outcome: "no_answer" });
    assert.deepEqual(twice.json.enquiry.lead, { score: 0, level: "cold", reasons: [{ points: 20, text: "Called back within 2 days" }, { points: -30, text: "No answer twice" }] });
    assert.equal(twice.json.enquiry.contacts.length, 2);

    const open = (await gym.get("/api/gym/enquiries?view=open")).json.enquiries;
    assert.deepEqual(open.map((e) => [e.name, e.lead.score]), [["Kiran P", 70], ["Walked In", 50], ["Deepa N", 0]], "hottest first");
    // Closed enquiries aren't scored
    const lost = await gym.patch(`/api/gym/enquiries/${deepa.id}`, { status: "lost" });
    assert.equal(lost.json.enquiry.lead, null);
    assert.equal(lost.json.enquiry.contacts.length, 2, "the history stays");
  }));

  it("12. contacts: bad bodies, another gym's enquiry, and the usual guards", run(async () => {
    const gym = as("gymB");
    const kiran = (await gym.get("/api/gym/enquiries?view=open")).json.enquiries.find((e) => e.name === "Kiran P");
    for (const body of [{ kind: "email", outcome: "reached" }, { kind: "call" }, { kind: "call", outcome: "visited" }, { kind: "call", outcome: "reached", note: "x" }, { kind: "visit", gymId: 1 }]) {
      assert.equal((await gym.post(`/api/gym/enquiries/${kiran.id}/contacts`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await gym.post("/api/gym/enquiries/999999/contacts", { kind: "visit" })).status, 404);
    assert.equal((await gym.post("/api/gym/enquiries/1%20OR%201=1/contacts", { kind: "visit" })).status, 400);
    assert.equal((await as("gymA").post(`/api/gym/enquiries/${kiran.id}/contacts`, { kind: "visit" })).status, 404, "another gym's enquiry");
    assert.equal((await api("POST", `/api/gym/enquiries/${kiran.id}/contacts`, null, { kind: "visit" })).status, 401);
    for (const tag of ["member", "admin", "loner"]) assert.equal((await as(tag).post(`/api/gym/enquiries/${kiran.id}/contacts`, { kind: "visit" })).status, 403, `${tag} is refused`);
    assert.equal(await count("gym_enquiry_contacts", "enquiry_id = ?", [kiran.id]), 2, "only Kiran's two real contacts were written");
  }));

  it("13. payments: a due payment keeps the due date it was paid against; the Due Members list scores late payers first", run(async () => {
    const gym = as("gymA");
    // Arjun: ₹3,500 due; paid ₹500 late twice (each after the date it was due by) → ₹2,500 left
    state.arjun = await admit("Arjun M", { expiresIn: 60, due: 3500 });
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [days(-30), state.arjun]);
    // (the rest's new date must be today or later, so the past due dates are set directly)
    let r = await gym.post(`/api/gym/members/${state.arjun}/due`, { amount: 500, method: "cash", paidOn: days(-25), dueBy: days(5) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [days(-20), state.arjun]);
    r = await gym.post(`/api/gym/members/${state.arjun}/due`, { amount: 500, method: "cash", paidOn: days(-10), dueBy: days(5) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const [stored] = await connection.query("SELECT amount, DATE_FORMAT(paid_on, '%Y-%m-%d') AS paid_on, DATE_FORMAT(due_by, '%Y-%m-%d') AS due_by FROM gym_payments WHERE member_id = ? AND kind = 'due' ORDER BY id", [state.arjun]);
    assert.deepEqual(stored, [{ amount: 500, paid_on: days(-25), due_by: days(-30) }, { amount: 500, paid_on: days(-10), due_by: days(-20) }], "each payment keeps the due date that applied when it was collected");
    // Priya: ₹900 due, paid ₹100 three times before the date → on time, ₹600 left
    state.priya = await admit("Priya S", { expiresIn: 60, due: 900 });
    for (let i = 0; i < 3; i += 1) assert.equal((await gym.post(`/api/gym/members/${state.priya}/due`, { amount: 100, method: "online", paidOn: days(-3) })).status, 200);

    const list = await gym.get("/api/gym/predictions/payments");
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.counts, { late: 1, watch: 0 });
    assert.deepEqual(list.json.members.map((m) => [m.name, m.due, m.payment.score, m.payment.level]), [["Arjun M", 2500, 60, "late"], ["Priya S", 600, 0, "on_time"]], "likeliest late first; nobody else at gym A has a due");
    const [arjun, priya] = list.json.members;
    assert.deepEqual(arjun.payment.reasons, [{ points: 40, text: "Paid late twice before" }, { points: 20, text: "₹2,500 due" }]);
    assert.deepEqual([arjun.payment.late, arjun.payment.onTime, arjun.dueBy], [2, 0, days(5)]);
    assert.deepEqual(priya.payment.reasons, [{ points: -30, text: "Paid on time the last 3 times" }]);
    assert.deepEqual([priya.payment.late, priya.payment.onTime], [0, 3]);
    assert.ok(Date.parse(list.json.calculatedAt) > 0);
    // Search by name, phone digits or ID; SQL in it finds nobody; too long is refused
    assert.deepEqual((await gym.get("/api/gym/predictions/payments?search=pri")).json.members.map((m) => m.name), ["Priya S"]);
    assert.deepEqual((await gym.get(`/api/gym/predictions/payments?search=${encodeURIComponent("' OR 1=1 --")}`)).json.members, []);
    assert.equal((await gym.get(`/api/gym/predictions/payments?search=${"x".repeat(200)}`)).status, 400);
  }));

  it("14. payments: only this gym's staff, and only this gym's members", run(async () => {
    const gymB = await as("gymB").get("/api/gym/predictions/payments");
    assert.equal(gymB.status, 200);
    assert.ok(gymB.json.members.length > 0 && gymB.json.members.every((m) => !["Arjun M", "Priya S"].includes(m.name)), "gym B sees only its own dues, none of gym A's");
    assert.equal((await api("GET", "/api/gym/predictions/payments", null)).status, 401);
    for (const tag of ["member", "admin", "loner"]) assert.equal((await as(tag).get("/api/gym/predictions/payments")).status, 403, `${tag} is refused`);
  }));
});
