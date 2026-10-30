// Super Admin › App Usage end to end: the real Express server against justfit_test. Seeds rows
// the way the features write them (meals, water, workouts, posts, likes, stories, check-ins,
// weigh-ins, coach plans, AI calls) for two members, a demo account and an admin, then checks
// the counts, the distinct-member counts, the ranges and the comparison with the period
// before, that admin and demo accounts never count, that failed AI calls never count, and the
// attack paths: no or forged session, a member, bad ranges, SQL in a date.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("admin app usage e2e: counts from the features' own rows", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const ids = {};
  const tokens = {};

  const api = async (route, token) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${server.baseUrl}${route}`, { headers });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const usage = (query = "") => api(`/api/admin/portal/usage${query}`, tokens.admin);
  const feature = (data, id) => data.features.find((f) => f.id === id);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  // A timestamp N days before today's start, at 10:00 (never on a day boundary)
  const at = (daysAgo) => `DATE_SUB(CURDATE(), INTERVAL ${daysAgo} DAY) + INTERVAL 10 HOUR`;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      for (const [tag, role, email] of [["admin", "admin"], ["a", "user"], ["b", "user"], ["c", "user"], ["demo", "user", `demo-${runId}@demo.justfit.test`]]) {
        const identity = await testAccounts.createIdentity(runId, tag, { role, ...(email ? { email } : {}) });
        ids[tag] = identity.id;
        tokens[tag] = (await testAccounts.mintToken(identity.id)).jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    // Members registered at known times: c joined this period, the others before it
    await connection.query(`UPDATE users SET created_at = ${at(40)} WHERE id IN (?, ?, ?, ?)`, [ids.admin, ids.a, ids.b, ids.demo]);
    await connection.query(`UPDATE users SET created_at = ${at(2)} WHERE id = ?`, [ids.c]);
    // Sessions last used before this period (so activity comes from the feature rows below)
    await connection.query(`UPDATE auth_sessions SET created_at = ${at(40)}, last_used_at = ${at(40)}`);

    const q = (sql, params = []) => connection.query(sql, params);
    // a: 3 meals (one 10 days ago), water, a completed and an abandoned workout, a post with b's like, a story b viewed
    await q(`INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at, created_at) VALUES (?, CURDATE(), 'lunch', 'Dal', ${at(0)}, ${at(0)}), (?, CURDATE() - INTERVAL 1 DAY, 'dinner', 'Roti', ${at(1)}, ${at(1)}), (?, CURDATE() - INTERVAL 10 DAY, 'lunch', 'Rice', ${at(10)}, ${at(10)})`, [ids.a, ids.a, ids.a]);
    await q(`INSERT INTO macro_water_logs (user_id, log_date, amount_ml, logged_at) VALUES (?, CURDATE(), 250, ${at(0)})`, [ids.a]);
    await q(`INSERT INTO workout_logs (user_id, on_date, started_at, completed_at, status) VALUES (?, CURDATE(), ${at(0)}, ${at(0)} + INTERVAL 40 MINUTE, 'completed'), (?, CURDATE() - INTERVAL 1 DAY, ${at(1)}, NULL, 'abandoned')`, [ids.a, ids.a]);
    const postId = crypto.randomUUID();
    await q(`INSERT INTO community_posts (id, user_id, body, created_at) VALUES (?, ?, 'Leg day', ${at(1)})`, [postId, ids.a]);
    await q(`INSERT INTO community_post_likes (post_id, user_id, created_at) VALUES (?, ?, ${at(1)})`, [postId, ids.b]);
    const storyId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    await q("INSERT INTO community_media (id, user_id, media_type, byte_size) VALUES (?, ?, 'image/jpeg', 1024)", [mediaId, ids.a]);
    await q(`INSERT INTO community_stories (id, user_id, media_id, created_at, expires_at) VALUES (?, ?, ?, ${at(0)}, ${at(0)} + INTERVAL 1 DAY)`, [storyId, ids.a, mediaId]);
    await q(`INSERT INTO community_story_views (story_id, user_id, viewed_at) VALUES (?, ?, ${at(0)})`, [storyId, ids.b]);
    // b: a weigh-in and a check-in with check-out; a coach plan 10 days ago
    await q("INSERT INTO weigh_ins (user_id, logged_on, weight_kg) VALUES (?, CURDATE(), 70.5)", [ids.b]);
    ids.gym = crypto.randomUUID();
    await q("INSERT INTO gyms (id, name, invite_code, visibility, member_count) VALUES (?, ?, ?, 'public', 0)", [ids.gym, `Usage Gym ${runId}`, crypto.randomBytes(4).toString("hex").toUpperCase()]);
    await q(`INSERT INTO gym_visits (gym_id, user_id, checked_in_at, checked_out_at, checkout_method) VALUES (?, ?, ${at(0)}, ${at(0)} + INTERVAL 1 HOUR, 'qr')`, [ids.gym, ids.b]);
    // AI calls: an ok food scan for b, a failed one for a (never counts), an ok one for the demo account (never counts)
    await q(`INSERT INTO ai_usage (created_at, user_id, feature, provider, model, status) VALUES (${at(0)}, ?, 'food_scan', 'openai', 'test', 'ok'), (${at(0)}, ?, 'food_scan', 'openai', 'test', 'failed'), (${at(0)}, ?, 'food_scan', 'openai', 'test', 'ok')`, [ids.b, ids.a, ids.demo]);
    // The app's own events (phase 2): two sessions for a with screen views, one for the demo account
    const s1 = crypto.randomUUID(), s2 = crypto.randomUUID(), s3 = crypto.randomUUID();
    await q(`INSERT INTO analytics_sessions (id, user_id, platform, started_at, last_event_at, event_count) VALUES (?, ?, 'ios', ${at(0)}, ${at(0)} + INTERVAL 120 SECOND, 3), (?, ?, 'ios', ${at(1)}, ${at(1)} + INTERVAL 60 SECOND, 2), (?, ?, 'android', ${at(0)}, ${at(0)} + INTERVAL 600 SECOND, 9)`, [s1, ids.a, s2, ids.a, s3, ids.demo]);
    await q(`INSERT INTO analytics_events (id, user_id, session_id, event_name, module, screen_name, occurred_at) VALUES (UUID(), ?, ?, 'screen_viewed', 'app', 'home', ${at(0)}), (UUID(), ?, ?, 'screen_viewed', 'app', 'macro', ${at(0)}), (UUID(), ?, ?, 'screen_viewed', 'app', 'home', ${at(1)}), (UUID(), ?, ?, 'screen_viewed', 'app', 'home', ${at(0)})`, [ids.a, s1, ids.a, s1, ids.a, s2, ids.demo, s3]);
    // The demo account and the admin do things too: none of it may count
    await q(`INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at, created_at) VALUES (?, CURDATE(), 'lunch', 'Demo', ${at(0)}, ${at(0)}), (?, CURDATE(), 'lunch', 'Admin', ${at(0)}, ${at(0)})`, [ids.demo, ids.admin]);
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      await connection.query("DELETE FROM ai_usage");
      await connection.query("DELETE FROM weigh_ins");
      await connection.query("DELETE FROM gym_visits");
      await connection.query("DELETE FROM analytics_events");
      await connection.query("DELETE FROM analytics_sessions");
      if (ids.gym) await connection.query("DELETE FROM gyms WHERE id = ?", [ids.gym]).catch(() => {});
      for (const tag of ["admin", "a", "b", "c", "demo"]) if (ids[tag]) await db.deleteUsers(connection, [ids[tag]]);
      await connection.end();
    }
  });

  it("1. needs a valid session and the admin role", run(async () => {
    assert.equal((await api("/api/admin/portal/usage")).status, 401);
    assert.equal((await api("/api/admin/portal/usage", "jfs_" + "x".repeat(43))).status, 401);
    assert.equal((await api("/api/admin/portal/usage", tokens.a)).status, 403);
    assert.equal((await usage()).status, 200);
  }));

  it("2. the last 7 days: uses and distinct members per feature, from the rows the features wrote", run(async () => {
    const { status, json } = await usage("?range=7d");
    assert.equal(status, 200);
    assert.equal(json.range.id, "7d");
    assert.equal(json.range.days, 7);
    assert.deepEqual([feature(json, "meal_log").uses, feature(json, "meal_log").members], [2, 1], "a's two meals this week; the 10-day-old one, the demo's and the admin's don't count");
    assert.deepEqual([feature(json, "water_log").uses, feature(json, "water_log").members], [1, 1]);
    assert.deepEqual([feature(json, "workout_started").uses, feature(json, "workout_completed").uses], [2, 1], "started counts both, completed only the finished one");
    assert.deepEqual([feature(json, "post").uses, feature(json, "like").members, feature(json, "story_created").uses, feature(json, "story_viewed").members], [1, 1, 1, 1]);
    assert.deepEqual([feature(json, "weigh_in").uses, feature(json, "weigh_in").members], [1, 1]);
    assert.deepEqual([feature(json, "check_in").uses, feature(json, "check_out").uses], [1, 1]);
    assert.deepEqual([feature(json, "food_scan").uses, feature(json, "food_scan").members], [1, 1], "only b's successful scan: a's failed one and the demo's don't count");
    assert.equal(feature(json, "coach_plan").uses, 0, "nothing this week");
    for (const f of json.features) assert.ok(Number.isInteger(f.uses) && Number.isInteger(f.members) && f.members <= f.uses, f.id);
  }));

  it("3. members: registered excludes admins and demo accounts; new, active and the share of active members", run(async () => {
    const { json } = await usage("?range=7d");
    assert.equal(json.members.registered, 3, "a, b and c");
    assert.equal(json.members.newInPeriod, 1, "c joined this week");
    assert.equal(json.members.active, 2, "a and b did things; c did nothing and their session is old");
    assert.equal(json.members.activePercent, 67);
    assert.equal(feature(json, "meal_log").sharePercent, 50, "1 of 2 active members logged a meal");
    assert.equal(json.totals.uses, json.features.reduce((s, f) => s + f.uses, 0));
  }));

  it("4. ranking is by distinct members, with the period before to compare", run(async () => {
    const { json } = await usage("?range=7d");
    const members = json.features.map((f) => f.members);
    assert.deepEqual(members, [...members].sort((x, y) => y - x), "sorted by members, descending");
    const meals = feature(json, "meal_log");
    assert.equal(meals.previousUses, 1, "the 10-day-old meal is in the 7 days before");
    assert.equal(meals.previousMembers, 1);
    assert.equal(meals.changePercent, 0, "1 member then, 1 member now");
    assert.equal(feature(json, "coach_plan").unused, true);
    assert.equal(json.members.previousActive, 1, "only a was active in the 7 days before (the old meal)");
  }));

  it("5. ranges: today, yesterday, 30 days, this month, a custom range; the series has one point per day", run(async () => {
    const today = await usage("?range=today");
    assert.equal(today.json.range.days, 1);
    assert.equal(feature(today.json, "meal_log").uses, 1);
    const yesterday = await usage("?range=yesterday");
    assert.equal(feature(yesterday.json, "meal_log").uses, 1);
    assert.equal(feature(yesterday.json, "post").uses, 1);
    const month = await usage("?range=30d");
    assert.equal(feature(month.json, "meal_log").uses, 3, "the 10-day-old meal is inside 30 days");
    assert.equal(month.json.series.length, 30);
    assert.equal(month.json.series.at(-1).key, today.json.range.to);
    assert.ok(month.json.series.at(-1).members >= 2, "both active members today");
    const thisMonth = await usage("?range=this_month");
    assert.equal(thisMonth.json.range.from.slice(-2), "01");
    const custom = await usage(`?range=custom&from=${yesterday.json.range.from}&to=${today.json.range.to}`);
    assert.equal(custom.json.range.days, 2);
    assert.equal(feature(custom.json, "meal_log").uses, 2);
  }));

  it("6. modules group their features; what isn't tracked is named, never shown as zero", run(async () => {
    const { json } = await usage();
    const nutrition = json.modules.find((m) => m.id === "nutrition");
    assert.ok(nutrition.features.includes("meal_log") && nutrition.features.includes("food_scan"));
    assert.equal(nutrition.uses, feature(json, "meal_log").uses + feature(json, "water_log").uses + feature(json, "food_scan").uses);
    assert.ok(!json.notTracked.some((n) => n.id === "screen_visits"), "the event tables exist here, so screen visits are tracked, not listed");
    assert.ok(json.notTracked.some((n) => n.id === "share"), "what the app has no action for stays listed");
    assert.ok(!json.notTracked.some((n) => n.id === "food_scan"), "ai_usage exists here, so AI features are counted");
  }));

  it("6b. sessions and screen visits come from the app's events, demo accounts left out", run(async () => {
    const { json } = await usage("?range=7d");
    assert.ok(json.engagement, "the event tables exist here, so engagement is reported");
    assert.equal(json.engagement.sessions.total, 2, "a's two sessions; the demo's doesn't count");
    assert.equal(json.engagement.sessions.perMember, 2);
    assert.equal(json.engagement.sessions.avgSeconds, 90, "(120 + 60) / 2");
    assert.deepEqual(json.engagement.screens, [{ screen: "home", visits: 2, members: 1 }, { screen: "macro", visits: 1, members: 1 }]);
    assert.ok(!json.notTracked.some((n) => n.id === "screen_visits"), "no longer listed as not tracked");
  }));

  it("7. bad ranges are refused with one friendly line and no 500", run(async () => {
    for (const q of ["?range=forever", "?range=custom", "?range=custom&from=2026-10-10&to=2026-10-01", "?range=custom&from='%20OR%201=1--&to=2026-10-01", "?range=custom&from=2020-01-01&to=2026-10-01"]) {
      const { status, json } = await usage(q);
      assert.equal(status, 400, q);
      assert.ok(typeof json.error === "string" && json.error.length > 0 && !/sql|syntax/i.test(json.error), q);
    }
  }));
});
