// Gym reviews end to end (Gym Profile phase 4, 2026-11-09): test accounts in justfit_test against
// the real Express server. Members of a branch (now or before) rate it, once each; members read the
// stars and the words the gym hasn't hidden; the gym replies and hides words but never a rating.
// Attack paths: no session, someone who was never a member, another branch's member, a stranger to
// the portal, Staff without the option, another gym's review id, a rating sent by the gym, bad
// input, SQL in a comment, a member's id or number leaking into the answers.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("gym reviews e2e: members rate the branch, the gym replies and hides words, never ratings", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { error.message += `\nserver log: ${(server?.logs ?? []).slice(-4).join(" | ")}`; throw error; }
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
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffSee", "user"], ["staffReply", "user"], ["member", "user"], ["past", "user"], ["memberB", "user"], ["stranger", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_reviews", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${error.message}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  // Nothing that identifies a reviewer beyond "Arjun M." may be in a member's answer
  const leaks = (json) => ["member", "past"].some((tag) => {
    const text = JSON.stringify(json);
    return text.includes(identities[tag].id) || text.includes(identities[tag].phone) || text.includes("Mehta");
  });

  it("1. two gyms; at gym A a member now, a member whose plan ended, and Staff with and without Reviews", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    // Members see approved, published gyms only (gym registration)
    await db.publishGyms(connection, [state.gymA, state.gymB]);
    for (const [tag, options] of [["staffSee", ["profile.view"]], ["staffReply", ["profile.view", "profile.reviews"]]]) {
      assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities[tag].phone, kind: "staff" })).status, 201);
      assert.equal((await api("PUT", `/api/gym/staff/${identities[tag].id}/permissions`, tokens.gymA, { options })).status, 200);
    }
    for (const [gym, tag, name] of [["gymA", "member", "Arjun Mehta"], ["gymA", "past", "Priya Rao"], ["gymB", "memberB", "Kiran S"]]) {
      const admitted = await api("POST", "/api/gym/members", tokens[gym], { name, phone: identities[tag].phone, duration: 3, fee: 4500, paid: 4500, method: "cash" });
      assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
      await connection.query("UPDATE users SET full_name = ? WHERE id = ?", [name, identities[tag].id]);
    }
    await connection.query("UPDATE gym_members SET expires_on = '2025-06-30' WHERE gym_id = ? AND phone = ?", [state.gymA, identities.past.phone]);
  }));

  it("2. members now and before review once each; nobody else can, and bad input is refused", run(async () => {
    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.deepEqual([page.json.reviews.summary.count, page.json.reviews.canReview, page.json.reviews.mine], [0, true, null]);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}`, tokens.stranger)).json.reviews.canReview, false);

    const written = await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.member, { rating: 5, comment: "Great trainers and clean showers." });
    assert.equal(written.status, 200, JSON.stringify(written.json));
    assert.deepEqual([written.json.summary.count, written.json.summary.average, written.json.mine.rating], [1, 5, 5]);
    assert.deepEqual([written.json.reviews[0].name, written.json.reviews[0].isYou], ["Arjun M.", true]);
    assert.equal(leaks(written.json), false, "no account id, number or surname");

    const sql = "Fine'); DROP TABLE gym_reviews; --";
    assert.equal((await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.past, { rating: 2, comment: sql })).status, 200, "a member whose plan ended can review");
    const [[stored]] = await connection.query("SELECT comment FROM gym_reviews WHERE gym_id = ? AND user_id = ?", [state.gymA, identities.past.id]);
    assert.equal(stored.comment, sql, "stored as text");

    assert.equal((await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.stranger, { rating: 1, comment: "Never been there." })).status, 403);
    assert.equal((await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.memberB, { rating: 1 })).status, 403, "a member of another gym");
    assert.equal((await api("PUT", `/api/gyms/${state.gymA}/review`, null, { rating: 5 })).status, 401);
    assert.equal((await api("PUT", "/api/gyms/999999/review", tokens.member, { rating: 5 })).status, 404);
    assert.equal((await api("PUT", "/api/gyms/1 OR 1=1/review", tokens.member, { rating: 5 })).status, 400);
    for (const payload of [{ rating: 0 }, { rating: 6 }, { rating: "5" }, { rating: 4, comment: "x".repeat(501) }, { rating: 4, userId: identities.stranger.id }, { rating: 4, gymId: state.gymB }]) {
      assert.equal((await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.member, payload)).status, 400, JSON.stringify(payload));
    }

    const changed = await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.member, { rating: 4, comment: "Great trainers and clean showers." });
    assert.equal(changed.status, 200);
    assert.deepEqual([changed.json.summary.count, changed.json.summary.average, changed.json.summary.counts[4], changed.json.summary.counts[2]], [2, 3, 1, 1], "still one review each");
  }));

  it("3. the gym's page, Discover and the review list carry the rating; the other gym has none", run(async () => {
    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.stranger);
    assert.deepEqual([page.json.reviews.summary.average, page.json.reviews.summary.count, page.json.reviews.reviews.length], [3, 2, 2]);
    assert.equal(leaks(page.json), false);
    const list = await api("GET", `/api/gyms/${state.gymA}/reviews?page=1`, tokens.stranger);
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.reviews.map((r) => r.rating).sort(), [2, 4]);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/reviews?page=0`, tokens.stranger)).status, 400);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/reviews?sort=rating`, tokens.stranger)).status, 400);
    const found = await api("GET", "/api/gyms?search=Forma", tokens.stranger);
    assert.deepEqual(found.json.gyms.find((g) => g.id === state.gymA).rating, { average: 3, count: 2 });
    assert.equal((await api("GET", `/api/gyms/${state.gymB}`, tokens.stranger)).json.reviews.summary.count, 0);
    const preview = await api("GET", "/api/gym/profile/preview", tokens.gymA);
    assert.deepEqual([preview.json.reviews.summary.count, preview.json.reviews.mine, preview.json.reviews.canReview], [2, null, false]);
  }));

  it("4. the gym lists, replies and hides words; Staff without Reviews, members and another gym can't", run(async () => {
    const list = await api("GET", "/api/gym/reviews", tokens.gymA);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.counts, { all: 2, unreplied: 2, hidden: 0 });
    state.memberReview = list.json.reviews.find((r) => r.rating === 4).id;
    state.pastReview = list.json.reviews.find((r) => r.rating === 2).id;
    assert.equal((await api("GET", "/api/gym/reviews", tokens.staffSee)).status, 200);
    assert.equal((await api("GET", "/api/gym/reviews", tokens.gymB)).json.counts.all, 0);
    assert.equal((await api("GET", "/api/gym/reviews", tokens.member)).status, 403);
    assert.equal((await api("GET", "/api/gym/reviews", null)).status, 401);
    assert.equal((await api("GET", "/api/gym/reviews?view=deleted", tokens.gymA)).status, 400);

    assert.equal((await api("PUT", `/api/gym/reviews/${state.memberReview}/reply`, tokens.staffSee, { text: "Thanks!" })).status, 403, "Staff without Reviews");
    assert.equal((await api("PUT", `/api/gym/reviews/${state.memberReview}/reply`, tokens.gymB, { text: "Thanks!" })).status, 404, "another gym's review");
    assert.equal((await api("PUT", `/api/gym/reviews/${state.memberReview}/reply`, tokens.staffReply, { text: "Thanks!", rating: 5 })).status, 400, "no rating from the gym");
    const replied = await api("PUT", `/api/gym/reviews/${state.memberReview}/reply`, tokens.staffReply, { text: "Thank you, Arjun!" });
    assert.equal(replied.status, 200, JSON.stringify(replied.json));
    assert.equal(replied.json.review.reply.text, "Thank you, Arjun!");

    // No route lets the gym touch a rating (an unmapped portal route is refused before it could match: 403)
    for (const [method, route] of [["PUT", `/api/gym/reviews/${state.pastReview}`], ["PATCH", `/api/gym/reviews/${state.pastReview}`], ["DELETE", `/api/gym/reviews/${state.pastReview}`]]) {
      const status = (await api(method, route, tokens.gymA, { rating: 5 })).status;
      assert.ok([403, 404].includes(status), `${method} ${route}: ${status}`);
    }
    assert.equal((await api("POST", `/api/gym/reviews/${state.pastReview}/hide`, tokens.gymA, { reason: "bad_rating" })).status, 400);
    assert.equal((await api("POST", `/api/gym/reviews/${state.pastReview}/hide`, tokens.staffSee, { reason: "spam" })).status, 403);
    const hidden = await api("POST", `/api/gym/reviews/${state.pastReview}/hide`, tokens.gymA, { reason: "spam" });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
    assert.deepEqual([hidden.json.review.hiddenReason, hidden.json.review.rating], ["spam", 2]);
    assert.deepEqual((await api("GET", "/api/gym/reviews", tokens.gymA)).json.counts, { all: 2, unreplied: 1, hidden: 1 });
  }));

  it("5. hidden words leave the member pages but the stars still count; new words show again", run(async () => {
    const seen = await api("GET", `/api/gyms/${state.gymA}/reviews`, tokens.stranger);
    const past = seen.json.reviews.find((r) => r.id === state.pastReview);
    assert.deepEqual([past.comment, past.rating], [null, 2]);
    assert.deepEqual([seen.json.summary.average, seen.json.summary.count], [3, 2], "the rating still counts");
    assert.equal(seen.json.reviews.find((r) => r.id === state.memberReview).reply.text, "Thank you, Arjun!");
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/reviews`, tokens.past)).json.mine.hiddenReason, "spam", "the reviewer is told");

    const same = await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.past, { rating: 3, comment: "Fine'); DROP TABLE gym_reviews; --" });
    assert.equal(same.json.mine.hiddenReason, "spam", "the same words stay hidden");
    const reworded = await api("PUT", `/api/gyms/${state.gymA}/review`, tokens.past, { rating: 3, comment: "Crowded in the evenings." });
    assert.equal(reworded.json.mine.hiddenReason, null);
    assert.equal(reworded.json.reviews.find((r) => r.id === state.pastReview).comment, "Crowded in the evenings.");

    assert.equal((await api("POST", `/api/gym/reviews/${state.pastReview}/hide`, tokens.staffReply, { reason: "other" })).status, 200);
    assert.equal((await api("POST", `/api/gym/reviews/${state.pastReview}/show`, tokens.staffReply)).json.review.hiddenReason, null);
    assert.equal((await api("DELETE", `/api/gym/reviews/${state.memberReview}/reply`, tokens.gymA)).json.review.reply, null);
  }));

  it("6. a member deletes their own review; the changes are on Activity and audited", run(async () => {
    const gone = await api("DELETE", `/api/gyms/${state.gymA}/review`, tokens.member);
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.deepEqual([gone.json.mine, gone.json.summary.count], [null, 1]);
    assert.equal((await api("DELETE", `/api/gyms/${state.gymA}/review`, tokens.member)).status, 404);
    assert.equal((await api("DELETE", `/api/gyms/${state.gymA}/review`, tokens.stranger)).status, 404);
    const [[logged]] = await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND target_label = 'Review'", [state.gymA]);
    assert.ok(logged.n >= 5, `Activity rows: ${logged.n}`);
    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id IN (?) AND summary LIKE '%review%'", [[identities.gymA.id, identities.staffReply.id]]);
    assert.ok(audited.n >= 5, `audit rows: ${audited.n}`);
  }));
});
