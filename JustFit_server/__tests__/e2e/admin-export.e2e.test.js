// Super Admin › App Usage › Export end to end: the five CSV reports against justfit_test, with
// the screen's filters applied, as real files (content type, file name, BOM, quoting), a member's
// name that looks like a formula defused, and the attack paths: no or forged session, a member,
// an unknown report, a bad range.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("admin export e2e: App Usage as CSV", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const ids = {};
  const tokens = {};

  const get = async (route, token) => {
    const response = await fetch(`${server.baseUrl}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    // The raw bytes: text() would decode away the UTF-8 BOM the file deliberately starts with
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), bytes, text: bytes.toString("utf8") };
  };
  const csv = (query) => get(`/api/admin/portal/usage/export?${query}`, tokens.admin);
  const rows = (text) => text.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const at = (daysAgo) => `DATE_SUB(CURDATE(), INTERVAL ${daysAgo} DAY) + INTERVAL 10 HOUR`;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["a", "user"], ["b", "user"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, { role });
        ids[tag] = identity.id;
        tokens[tag] = (await testAccounts.mintToken(identity.id)).jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    // b's name is a formula and has a comma: both must survive the export harmlessly
    await connection.query("UPDATE users SET full_name = 'Asha Rao' WHERE id = ?", [ids.a]);
    await connection.query("UPDATE users SET full_name = '=HYPERLINK(\"http://x\"), Bala' WHERE id = ?", [ids.b]);
    await connection.query(`UPDATE users SET created_at = ${at(10)} WHERE id IN (?, ?)`, [ids.a, ids.b]);
    // The sessions the harness minted are dated now; move them before the range so only the meals count as activity
    await connection.query(`UPDATE auth_sessions SET created_at = ${at(10)}, last_used_at = ${at(10)}`);
    await connection.query(`INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at, created_at) VALUES (?, CURDATE(), 'lunch', 'Dal', ${at(0)}, ${at(0)}), (?, CURDATE() - INTERVAL 1 DAY, 'lunch', 'Rice', ${at(1)}, ${at(1)})`, [ids.a, ids.b]);
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      for (const tag of ["admin", "a", "b"]) if (ids[tag]) await db.deleteUsers(connection, [ids[tag]]);
      await connection.end();
    }
  });

  it("1. needs a valid session and the admin role; a member gets nothing", run(async () => {
    assert.equal((await get("/api/admin/portal/usage/export?report=features")).status, 401);
    assert.equal((await get("/api/admin/portal/usage/export?report=features", "jfs_" + "x".repeat(43))).status, 401);
    assert.equal((await get("/api/admin/portal/usage/export?report=features", tokens.a)).status, 403);
  }));

  it("2. features: a CSV file with a BOM, the range in its name, the header, and one row per feature", run(async () => {
    const r = await csv("report=features&range=7d");
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/csv; charset=utf-8/);
    assert.match(r.disposition, /^attachment; filename="justfit-features-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.deepEqual([...r.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "a UTF-8 BOM, so Excel reads the characters right");
    const lines = rows(r.text);
    assert.equal(lines[0], "Rank,Feature,Area,Members,Uses,Uses per member,% of active members,\"Members, period before\",\"Uses, period before\",Change in members %,Declining,Unused");
    const meals = lines.find((l) => l.includes("Meals logged"));
    assert.ok(meals, "the meal row is there");
    assert.match(meals, /^1,Meals logged,Meals & Macro,2,2,1,100,/, "2 members, 2 uses, 1 per member, 100% of the 2 active members");
  }));

  it("3. overview and daily follow the range; daily has one line per day", run(async () => {
    const overview = rows((await csv("report=overview&range=today")).text);
    assert.equal(overview[0], "Metric,Value");
    assert.ok(overview.some((l) => l === "Active members,1"), `today only a was active: ${overview.join(" | ")}`);
    assert.ok(overview.some((l) => l.startsWith("Not tracked: ")));
    const daily = rows((await csv("report=daily&range=7d")).text);
    assert.equal(daily.length, 8, "a header and 7 days");
    assert.equal(daily[0], "Date,Active members");
  }));

  it("4. members: every member in the screen's order; a name that is a formula is defused and a comma is quoted", run(async () => {
    const r = await csv("report=members&sort=name");
    const lines = rows(r.text);
    assert.equal(lines[0], "Member id,Name,Joined,Last active,Sessions,Interactions,Active days,Most used feature,\"Most used, count\"");
    assert.equal(lines.length, 3, "a and b; never the admin");
    const bala = lines.find((l) => l.includes("Bala"));
    assert.ok(bala.includes("\"'=HYPERLINK(\"\"http://x\"\"), Bala\""), `defused and quoted: ${bala}`);
    assert.ok(!/,=HYPERLINK/.test(bala), "never a bare formula cell");
    const search = rows((await csv("report=members&search=asha")).text);
    assert.equal(search.length, 2, "the search narrows the file too");
  }));

  it("5. retention: one row per cohort with the day columns and the curve", run(async () => {
    const lines = rows((await csv("report=retention&unit=week")).text);
    assert.match(lines[0], /^Cohort,Joined,Day 1 %,Day 7 %,Day 30 %,Week 0 %/);
    assert.equal(lines.length, 2, "one cohort: a and b joined the same week");
    assert.match(lines[1], /^\d{4}-\d{2}-\d{2},2,/);
  }));

  it("6. an unknown report or a bad range is refused with one friendly line, not a file", run(async () => {
    for (const q of ["report=users", "report=../etc/passwd", "", "report=features&range=forever", "report=retention&unit=day"]) {
      const r = await csv(q);
      assert.equal(r.status, 400, q);
      assert.match(r.type, /application\/json/);
      assert.ok(!/sql|syntax/i.test(r.text));
    }
  }));
});
