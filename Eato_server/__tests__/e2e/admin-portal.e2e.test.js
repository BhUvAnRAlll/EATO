// The Super Admin portal end to end: real Clerk development identities against the real Express
// server and the isolated eato_test database. Covers the Overview's counts, its to-do list and
// the audit log that admin actions write (suspend, reinstate, dismiss a report, publish a
// promotion), Users (list, filters, search, detail, the Verified trainer switch, suspension
// guards, suspended trainers leaving search), and the attack paths: no or forged session, a
// member or trainer calling admin routes, malformed ids, SQL and wildcards in a search, unexpected
// fields, and a failed action leaving no log line.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

describe("admin portal e2e: the Overview, users and the admin audit log", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = { gyms: [], posts: [], promotions: [] };

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const overview = (token) => api("GET", "/api/admin/portal/overview", token);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("admin", "admin");
      // A second admin for the Reports tests: the admin routes allow 60 requests a minute per
      // admin, and this file sends more than that from one account
      await newIdentity("moderator", "admin");
      await newIdentity("trainer", "trainer");
      await newIdentity("member");
      await newIdentity("rohan");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    const names = { admin: "Maya Ortiz", moderator: "Sam Rivera", trainer: "Marcus Johnson", member: "Priya Patel", rohan: "Rohan Verma" };
    for (const tag of Object.keys(names)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, names[tag], tag === "admin" || tag === "moderator" ? "admin" : tag === "trainer" ? "trainer" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?) OR target_id IN (?)", [all, [...all, ...state.gyms, ...state.posts, ...state.promotions]]);
        if (state.promotions.length) await connection.query("DELETE FROM promotions WHERE id IN (?)", [state.promotions]);
        if (state.posts.length) {
          await connection.query("DELETE r FROM community_reports r JOIN community_comments c ON c.id = r.comment_id WHERE c.post_id IN (?)", [state.posts]);
          await connection.query("DELETE FROM community_comments WHERE post_id IN (?)", [state.posts]);
          await connection.query("DELETE FROM community_reports WHERE post_id IN (?)", [state.posts]);
          await connection.query("DELETE FROM community_posts WHERE id IN (?)", [state.posts]);
        }
        if (state.gyms.length) {
          for (const table of ["gym_members", "whatsapp_agent_settings", "whatsapp_connections"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [state.gyms]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [state.gyms]);
        }
        for (const table of ["trainer_profiles", "community_profiles"]) await connection.query(`DELETE FROM \`${table}\` WHERE user_id IN (?)`, [all]);
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
    }
    if (clerk) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await clerk.revokeSession(identities[tag].sessionId).catch(() => {});
        await clerk.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. the overview needs a valid session and the admin role", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) assert.equal((await overview(token)).status, 401);
    for (const tag of ["member", "trainer"]) {
      const r = await overview(tokens[tag]);
      assert.equal(r.status, 403, `${tag} is refused`);
      assert.equal(typeof r.json.error, "string");
    }
    assert.equal((await overview(tokens.admin)).status, 200);
  }));

  it("2. the counts and the to-do list come from real rows", run(async () => {
    const before = (await overview(tokens.admin)).json;
    // A gym on a trial with two active members, and a suspended one
    const [[{ id: gymId }]] = await connection.query("SELECT UUID() AS id");
    state.gyms.push(gymId);
    await connection.query("INSERT INTO gyms (id, name, invite_code, status, trial_ends_at, created_by) VALUES (?, ?, ?, 'trial', DATE_ADD(CURDATE(), INTERVAL 10 DAY), ?)", [gymId, `Velocity Fitness ${runId}`, `V${runId.slice(0, 7).toUpperCase()}`, ids.admin]);
    await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', NOW()), (?, ?, 'member', 'active', NOW())", [gymId, ids.member, gymId, ids.rohan]);
    // Two reports on one post count as one report group
    const [[{ id: postId }]] = await connection.query("SELECT UUID() AS id");
    state.posts.push(postId);
    await connection.query("INSERT INTO community_posts (id, user_id, body) VALUES (?, ?, 'Spam spam spam')", [postId, ids.rohan]);
    await connection.query("INSERT INTO community_reports (reporter_id, post_id, reason) VALUES (?, ?, 'Spam'), (?, ?, 'Misleading')", [ids.member, postId, ids.admin, postId]);
    // An unverified trainer with two qualifications
    await connection.query("INSERT INTO trainer_profiles (user_id, title, specialties, bio, qualifications) VALUES (?, 'HIIT & Fat-Loss Coach', JSON_ARRAY('weight_loss'), 'Fast, fun sessions', JSON_ARRAY('ACE CPT', 'CPR'))", [ids.trainer]);

    const r = await overview(tokens.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const { counts, todo } = r.json;
    assert.equal(counts.gyms, before.counts.gyms + 1);
    assert.equal(counts.gymMembers, before.counts.gymMembers + 2);
    assert.equal(counts.openReports, before.counts.openReports + 1, "two reports on one post are one group");
    assert.equal(counts.unverifiedTrainers, before.counts.unverifiedTrainers + 1);
    assert.equal(counts.users, before.counts.users);
    assert.ok(todo.trainersToVerify.some((t) => t.userId === ids.trainer && t.name === "Marcus Johnson" && t.qualifications === 2));
    const trial = todo.gymsOnTrial.find((g) => g.id === gymId);
    assert.ok(trial && /^\d{4}-\d{2}-\d{2}$/.test(trial.trialEndsOn));
    assert.equal(todo.reportedPosts, counts.openReports);

    // A verified trainer drops off the list
    await connection.query("UPDATE trainer_profiles SET verified_at = NOW(), verified_by = ? WHERE user_id = ?", [ids.admin, ids.trainer]);
    const after = (await overview(tokens.admin)).json;
    assert.equal(after.counts.unverifiedTrainers, counts.unverifiedTrainers - 1);
    assert.ok(!after.todo.trainersToVerify.some((t) => t.userId === ids.trainer));
  }));

  it("3. admin actions write the audit log, newest first, with who did them", run(async () => {
    const logBefore = await count("admin_audit_log", "admin_id = ?", [ids.admin]);
    assert.equal((await api("POST", `/api/community/admin/members/${ids.rohan}/suspend`, tokens.admin)).status, 200);
    assert.equal((await overview(tokens.admin)).json.counts.suspended >= 1, true);
    assert.equal((await api("DELETE", `/api/community/admin/members/${ids.rohan}/suspend`, tokens.admin)).status, 200);
    const [[report]] = await connection.query("SELECT id FROM community_reports WHERE post_id = ? LIMIT 1", [state.posts[0]]);
    assert.equal((await api("POST", `/api/community/reports/${report.id}/resolve`, tokens.admin, { status: "dismissed" })).status, 200);
    const promo = await api("POST", "/api/admin/promotions", tokens.admin, {
      title: "Train with a coach", eyebrow: "NEW", headline: "Train with a coach", description: "One-to-one sessions with JustFit trainers", imageUrl: "asset:hero-meals", ctaLabel: "Find a trainer", ctaDestination: "explore", status: "published",
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.json));
    state.promotions.push(promo.json.promotion.id);

    assert.equal(await count("admin_audit_log", "admin_id = ?", [ids.admin]), logBefore + 4);
    const { activity } = (await overview(tokens.admin)).json;
    const summaries = activity.slice(0, 4).map((a) => a.summary);
    assert.deepEqual(summaries.slice(1), ["Dismissed a report", "Reinstated Rohan Verma", "Suspended Rohan Verma"], "newest first");
    assert.equal(summaries[0], "Published promotion “Train with a coach”");
    assert.ok(activity.slice(0, 4).every((a) => a.by === "Maya Ortiz" && a.at));
    assert.equal(activity.find((a) => a.summary === "Suspended Rohan Verma").targetId, ids.rohan);
  }));

  it("4. a refused or failed action leaves no log line", run(async () => {
    const before = await count("admin_audit_log", "1 = ?", [1]);
    // A member can't suspend anyone, and resolving a report that isn't open fails
    assert.equal((await api("POST", `/api/community/admin/members/${ids.rohan}/suspend`, tokens.member)).status, 403);
    const [[report]] = await connection.query("SELECT id FROM community_reports WHERE post_id = ? AND status = 'dismissed' LIMIT 1", [state.posts[0]]);
    assert.equal((await api("POST", `/api/community/reports/${report.id}/resolve`, tokens.admin, { status: "dismissed" })).status, 404);
    assert.equal((await api("POST", `/api/community/reports/${report.id}/resolve`, tokens.admin, { status: "deleted' OR '1'='1" })).status, 400);
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before);
  }));

  it("5. users: every route needs the admin role", run(async () => {
    for (const token of [null, "not-a-jwt"]) assert.equal((await api("GET", "/api/admin/portal/users", token)).status, 401);
    for (const tag of ["member", "trainer"]) {
      assert.equal((await api("GET", "/api/admin/portal/users", tokens[tag])).status, 403);
      assert.equal((await api("GET", `/api/admin/portal/users/${ids.member}`, tokens[tag])).status, 403);
      assert.equal((await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens[tag], { verified: true })).status, 403);
    }
  }));

  it("6. the users list: kinds, filters and search by name or email", run(async () => {
    const all = await api("GET", "/api/admin/portal/users", tokens.admin);
    assert.equal(all.status, 200, JSON.stringify(all.json));
    const byId = Object.fromEntries(all.json.users.map((u) => [u.id, u]));
    assert.equal(byId[ids.admin].kind, "admin");
    assert.equal(byId[ids.trainer].kind, "trainer");
    assert.equal(byId[ids.member].kind, "owner", "the member owns the trial gym");
    assert.equal(byId[ids.rohan].kind, "member");
    const kinds = async (filter) => (await api("GET", `/api/admin/portal/users?filter=${filter}`, tokens.admin)).json.users.map((u) => u.id);
    assert.ok((await kinds("trainers")).includes(ids.trainer) && !(await kinds("trainers")).includes(ids.rohan));
    assert.deepEqual((await kinds("owners")).filter((id) => Object.values(ids).includes(id)), [ids.member]);
    assert.ok((await kinds("members")).includes(ids.rohan));
    const search = async (text) => (await api("GET", `/api/admin/portal/users?search=${encodeURIComponent(text)}`, tokens.admin)).json.users.map((u) => u.id);
    assert.deepEqual(await search("Rohan Ver"), [ids.rohan]);
    assert.ok((await search(identities.rohan.emailAddress)).includes(ids.rohan), "search by email");
    assert.deepEqual(await search("%"), [], "a percent sign is matched literally, not as a wildcard");
    assert.deepEqual(await search("' OR '1'='1"), []);
    assert.equal((await api("GET", "/api/admin/portal/users?filter=everyone", tokens.admin)).status, 400);
    assert.equal((await api("GET", `/api/admin/portal/users?search=${"x".repeat(81)}`, tokens.admin)).status, 400);
  }));

  it("7. a user's page: counts, gyms and, for a trainer, the profile", run(async () => {
    const member = await api("GET", `/api/admin/portal/users/${ids.rohan}`, tokens.admin);
    assert.equal(member.status, 200, JSON.stringify(member.json));
    assert.deepEqual({ name: member.json.user.name, kind: member.json.user.kind, trainer: member.json.user.trainer }, { name: "Rohan Verma", kind: "member", trainer: null });
    assert.deepEqual(member.json.user.counts, { posts: 1, reported: 2, removed: 0 });
    assert.deepEqual(member.json.user.gyms.map((g) => g.role), ["member"]);
    const trainer = (await api("GET", `/api/admin/portal/users/${ids.trainer}`, tokens.admin)).json.user;
    assert.deepEqual(
      { title: trainer.trainer.title, quals: trainer.trainer.qualifications, clients: trainer.trainer.activeClients },
      { title: "HIIT & Fat-Loss Coach", quals: ["ACE CPT", "CPR"], clients: 0 },
    );
    assert.equal((await api("GET", "/api/admin/portal/users/user_doesnotexist", tokens.admin)).status, 404);
    assert.equal((await api("GET", `/api/admin/portal/users/${encodeURIComponent("x' OR '1'='1")}`, tokens.admin)).status, 404);
  }));

  it("8. the Verified switch: only trainers, logged, and shown on the public profile", run(async () => {
    const off = await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens.admin, { verified: false });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal((await api("GET", `/api/trainers/${ids.trainer}`, tokens.member)).json.trainer.verified, false);
    const on = await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens.admin, { verified: true });
    assert.equal(on.status, 200);
    const [[row]] = await connection.query("SELECT verified_by FROM trainer_profiles WHERE user_id = ?", [ids.trainer]);
    assert.equal(row.verified_by, ids.admin);
    assert.equal((await api("GET", `/api/trainers/${ids.trainer}`, tokens.member)).json.trainer.verified, true, "the public profile shows it");
    const log = (await overview(tokens.admin)).json.activity.map((a) => a.summary);
    assert.equal(log[0], "Verified Marcus Johnson");
    assert.equal(log[1], "Removed verification from Marcus Johnson");
    // Setting it to what it already is writes nothing
    const before = await count("admin_audit_log", "1 = ?", [1]);
    assert.equal((await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens.admin, { verified: true })).status, 200);
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before);
    const refused = await api("PUT", `/api/admin/portal/users/${ids.rohan}/verified`, tokens.admin, { verified: true });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, "Only a trainer with a profile can be verified.");
    assert.equal((await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens.admin, { verified: "yes" })).status, 400);
    assert.equal((await api("PUT", `/api/admin/portal/users/${ids.trainer}/verified`, tokens.admin, { verified: true, by: ids.member })).status, 400);
  }));

  it("9. suspension: never yourself or an admin, and a suspended trainer leaves search", run(async () => {
    const self = await api("POST", `/api/community/admin/members/${ids.admin}/suspend`, tokens.admin);
    assert.equal(self.status, 400);
    assert.equal(self.json.error, "You can't suspend your own account.");
    await connection.query("UPDATE users SET role = 'admin' WHERE id = ?", [ids.rohan]);
    try {
      const other = await api("POST", `/api/community/admin/members/${ids.rohan}/suspend`, tokens.admin);
      assert.equal(other.status, 400);
      assert.equal(other.json.error, "An admin account can't be suspended.");
    } finally {
      await connection.query("UPDATE users SET role = 'user' WHERE id = ?", [ids.rohan]);
    }
    const listed = async () => (await api("GET", "/api/trainers", tokens.member)).json.trainers.map((t) => t.member.id);
    assert.ok((await listed()).includes(ids.trainer));
    assert.equal((await api("POST", `/api/community/admin/members/${ids.trainer}/suspend`, tokens.admin)).status, 200);
    assert.ok(!(await listed()).includes(ids.trainer), "a suspended trainer drops out of search");
    assert.equal((await api("GET", `/api/admin/portal/users/${ids.trainer}`, tokens.admin)).json.user.suspended, true);
    assert.ok((await api("GET", "/api/admin/portal/users?filter=suspended", tokens.admin)).json.users.some((u) => u.id === ids.trainer));
    assert.equal((await api("DELETE", `/api/community/admin/members/${ids.trainer}/suspend`, tokens.admin)).status, 200);
    assert.ok((await listed()).includes(ids.trainer), "reinstated, back in search");
  }));

  it("10. gyms: the list and one gym's page, for admins only", run(async () => {
    for (const tag of ["member", "trainer"]) assert.equal((await api("GET", "/api/admin/portal/gyms", tokens[tag])).status, 403);
    const list = await api("GET", "/api/admin/portal/gyms", tokens.admin);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const trial = list.json.gyms.find((g) => g.id === state.gyms[0]);
    assert.deepEqual({ status: trial.status, owner: trial.owner?.name, plan: trial.plan }, { status: "trial", owner: "Priya Patel", plan: "starter" });
    assert.ok((await api("GET", `/api/admin/portal/gyms?search=${encodeURIComponent("Velocity")}`, tokens.admin)).json.gyms.some((g) => g.id === state.gyms[0]));
    assert.deepEqual((await api("GET", `/api/admin/portal/gyms?search=${encodeURIComponent("%")}`, tokens.admin)).json.gyms, []);
    const detail = (await api("GET", `/api/admin/portal/gyms/${state.gyms[0]}`, tokens.admin)).json.gym;
    assert.deepEqual(detail.counts, { members: 2, staff: 1, posts: 0, upcomingEvents: 0, openReports: 0, joinRequests: 0 });
    assert.equal(detail.owner.id, ids.member);
    assert.equal((await api("GET", "/api/admin/portal/gyms/00000000-0000-4000-8000-000000000000", tokens.admin)).status, 404);
    assert.equal((await api("GET", "/api/admin/portal/gyms/not-a-gym", tokens.admin)).status, 404);
  }));

  it("11. creating a gym starts a 14-day trial with the chosen owner, logged", run(async () => {
    const body = { name: `Muscle Club ${runId}`, tagline: "Lift together", location: "Koramangala", address: "4th Block", ownerId: ids.rohan, visibility: "public", memberApproval: true, plan: "pro" };
    for (const tag of ["member", "trainer"]) assert.equal((await api("POST", "/api/admin/portal/gyms", tokens[tag], body)).status, 403);
    const created = await api("POST", "/api/admin/portal/gyms", tokens.admin, body);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const gym = created.json.gym;
    state.gyms.push(gym.id);
    state.created = gym.id;
    assert.deepEqual({ status: gym.status, plan: gym.plan, owner: gym.owner.id, approval: gym.memberApproval }, { status: "trial", plan: "pro", owner: ids.rohan, approval: true });
    const [[row]] = await connection.query("SELECT DATEDIFF(trial_ends_at, CURDATE()) AS days, created_by FROM gyms WHERE id = ?", [gym.id]);
    assert.deepEqual({ ...row }, { days: 14, created_by: ids.admin });
    assert.equal(await count("whatsapp_connections", "gym_id = ?", [gym.id]), 1, "its agent rows are provisioned");
    assert.equal(await count("whatsapp_agent_settings", "gym_id = ?", [gym.id]), 1);
    assert.match((await overview(tokens.admin)).json.activity[0].summary, /^Created gym Muscle Club .* \(14-day trial, owner Rohan Verma\)$/);

    const refused = async (change, status, pattern) => {
      const r = await api("POST", "/api/admin/portal/gyms", tokens.admin, { ...body, name: `Other ${runId}`, ...change });
      assert.equal(r.status, status, JSON.stringify(r.json));
      if (pattern) assert.match(r.json.error, pattern);
    };
    await refused({ ownerId: undefined }, 400, /Pick the gym's owner/);
    await refused({ ownerId: "user_nobody123456" }, 400, /doesn't have an JustFit account/);
    await refused({ ownerId: "x' OR '1'='1" }, 400, /Pick the gym's owner/);
    await refused({ plan: "platinum" }, 400, /Pick a plan/);
    await refused({ visibility: "secret" }, 400, /public, private or hidden/);
    await refused({ location: "" }, 400, /Area/);
    await refused({ status: "active" }, 400, /unexpected field: status/);
    await refused({ name: body.name }, 400, /already exists/);
    assert.equal(await count("gyms", "name = ?", [`Other ${runId}`]), 0, "no refusal made a gym");
  }));

  it("12. the plan is a recorded label: changing it is logged, repeating it is not", run(async () => {
    const changed = await api("PUT", `/api/admin/portal/gyms/${state.created}/plan`, tokens.admin, { plan: "elite" });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal((await api("GET", `/api/admin/portal/gyms/${state.created}`, tokens.admin)).json.gym.plan, "elite");
    assert.match((await overview(tokens.admin)).json.activity[0].summary, /to the Elite plan$/);
    const before = await count("admin_audit_log", "1 = ?", [1]);
    assert.equal((await api("PUT", `/api/admin/portal/gyms/${state.created}/plan`, tokens.admin, { plan: "elite" })).status, 200);
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before);
    assert.equal((await api("PUT", `/api/admin/portal/gyms/${state.created}/plan`, tokens.admin, { plan: "gold" })).status, 400);
    assert.equal((await api("PUT", `/api/admin/portal/gyms/${state.created}/plan`, tokens.member, { plan: "starter" })).status, 403);
  }));

  it("13. suspending a gym hides it from Explore and its posts from everyone; reinstating restores the trial", run(async () => {
    // Rohan owns the new gym and posts in it; the member (not in it) sees the gym and the post
    const post = await api("POST", `/api/gyms/${state.created}/posts`, tokens.rohan, { body: `Leg day at the club ${runId}` });
    assert.equal(post.status, 201, JSON.stringify(post.json));
    state.posts.push(post.json.post.id);
    const explore = async (token) => (await api("GET", "/api/gyms", token)).json.explore.map((g) => g.id);
    // The gym's own feed (gym posts never reach the main feed); a hidden post just isn't listed
    const sees = async (token) => {
      const r = await api("GET", `/api/gyms/${state.created}/posts`, token);
      return r.status === 200 && r.json.posts.some((p) => p.id === post.json.post.id);
    };
    assert.ok((await explore(tokens.trainer)).includes(state.created));
    assert.equal(await sees(tokens.trainer), true);

    const suspended = await api("POST", `/api/admin/portal/gyms/${state.created}/suspend`, tokens.admin);
    assert.equal(suspended.status, 200, JSON.stringify(suspended.json));
    assert.equal(suspended.json.status, "suspended");
    assert.ok(!(await explore(tokens.trainer)).includes(state.created), "gone from Explore");
    assert.equal(await sees(tokens.trainer), false, "its posts are hidden");
    assert.ok((await api("GET", "/api/gyms", tokens.rohan)).json.mine.some((g) => g.id === state.created), "its own members still see it");
    assert.equal((await overview(tokens.admin)).json.activity[0].summary, `Suspended gym Muscle Club ${runId}`);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.created}/suspend`, tokens.member)).status, 403);

    const back = await api("DELETE", `/api/admin/portal/gyms/${state.created}/suspend`, tokens.admin);
    assert.equal(back.json.status, "trial", "the trial still has days left");
    assert.ok((await explore(tokens.trainer)).includes(state.created));
    assert.equal(await sees(tokens.trainer), true);
  }));

  it("14. reports are grouped by what they're about, with every reason and reporter", run(async () => {
    const [[{ id: postId }]] = await connection.query("SELECT UUID() AS id");
    state.posts.push(postId);
    state.reportedPost = postId;
    await connection.query("INSERT INTO community_posts (id, user_id, body, comment_count) VALUES (?, ?, 'Fat-burner gummies, DM me', 1)", [postId, ids.rohan]);
    await connection.query("INSERT INTO community_reports (reporter_id, post_id, reason) VALUES (?, ?, 'Spam or selling'), (?, ?, 'Harmful health advice')", [ids.member, postId, ids.trainer, postId]);
    const [[{ id: commentId }]] = await connection.query("SELECT UUID() AS id");
    state.reportedComment = commentId;
    await connection.query("INSERT INTO community_comments (id, post_id, user_id, body) VALUES (?, ?, ?, 'Buy now!!')", [commentId, postId, ids.rohan]);
    await connection.query("INSERT INTO community_reports (reporter_id, comment_id, reason) VALUES (?, ?, 'Spam')", [ids.member, commentId]);

    for (const tag of ["member", "trainer"]) assert.equal((await api("GET", "/api/admin/portal/reports", tokens[tag])).status, 403);
    const open = await api("GET", "/api/admin/portal/reports", tokens.moderator);
    assert.equal(open.status, 200, JSON.stringify(open.json));
    const post = open.json.groups.find((g) => g.id === postId);
    assert.deepEqual({ type: post.type, count: post.count, where: post.where, author: post.author.name, outcome: post.outcome }, { type: "post", count: 2, where: "Main feed", author: "Rohan Verma", outcome: null });
    assert.deepEqual(post.reports.map((r) => `${r.reason} (${r.reporter})`).sort(), ["Harmful health advice (Marcus Johnson)", "Spam or selling (Priya Patel)"]);
    const comment = open.json.groups.find((g) => g.id === commentId);
    assert.deepEqual({ type: comment.type, count: comment.count, where: comment.where }, { type: "comment", count: 1, where: "A comment" });
    assert.equal(open.json.counts.open, open.json.groups.length);
    assert.equal((await api("GET", "/api/admin/portal/reports?status=everything", tokens.moderator)).status, 400);
  }));

  it("15. dismiss closes every report on the post and keeps it; it then shows as resolved", run(async () => {
    const r = await api("POST", "/api/admin/portal/reports/resolve", tokens.moderator, { type: "post", id: state.reportedPost, action: "dismiss" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.resolved, 2);
    assert.equal(await count("community_reports", "post_id = ? AND status = 'dismissed'", [state.reportedPost]), 2);
    assert.equal(await count("community_posts", "id = ? AND deleted_at IS NULL", [state.reportedPost]), 1, "the post stays");
    assert.equal((await overview(tokens.moderator)).json.activity[0].summary, "Dismissed 2 reports on Rohan Verma's post");
    const resolved = (await api("GET", "/api/admin/portal/reports?status=resolved", tokens.moderator)).json.groups.find((g) => g.id === state.reportedPost);
    assert.equal(resolved.outcome, "dismissed");
    const again = await api("POST", "/api/admin/portal/reports/resolve", tokens.moderator, { type: "post", id: state.reportedPost, action: "remove" });
    assert.equal(again.status, 404, "nothing open is left to resolve");
    assert.equal(await count("community_posts", "id = ? AND deleted_at IS NULL", [state.reportedPost]), 1, "and a 404 deletes nothing");
  }));

  it("16. remove deletes the content (a comment's count follows) and closes its reports as reviewed", run(async () => {
    const r = await api("POST", "/api/admin/portal/reports/resolve", tokens.moderator, { type: "comment", id: state.reportedComment, action: "remove" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await count("community_comments", "id = ? AND deleted_at IS NOT NULL", [state.reportedComment]), 1);
    const [[post]] = await connection.query("SELECT comment_count FROM community_posts WHERE id = ?", [state.reportedPost]);
    assert.equal(post.comment_count, 0);
    assert.equal(await count("community_reports", "comment_id = ? AND status = 'reviewed'", [state.reportedComment]), 1);
    assert.equal((await overview(tokens.moderator)).json.activity[0].summary, "Removed Rohan Verma's comment (1 report)");
    const resolved = (await api("GET", "/api/admin/portal/reports?status=resolved", tokens.moderator)).json.groups.find((g) => g.id === state.reportedComment);
    assert.equal(resolved.outcome, "removed");
  }));

  it("17. a resolution is checked: the kind, the id, the action, no extra fields, admins only", run(async () => {
    const before = await count("admin_audit_log", "1 = ?", [1]);
    const bad = async (body, status, pattern) => {
      const r = await api("POST", "/api/admin/portal/reports/resolve", tokens.moderator, body);
      assert.equal(r.status, status, JSON.stringify(r.json));
      if (pattern) assert.match(r.json.error, pattern);
    };
    await bad({ type: "user", id: state.reportedPost, action: "remove" }, 400, /post, comment or story/);
    await bad({ type: "post", id: state.reportedPost, action: "delete" }, 400, /remove or dismiss/);
    await bad({ type: "post", id: "x' OR '1'='1", action: "remove" }, 400, /isn't valid/);
    await bad({ type: "post", id: state.reportedPost, action: "remove", status: "reviewed" }, 400, /unexpected field: status/);
    await bad({ type: "story", id: "00000000-0000-4000-8000-000000000000", action: "remove" }, 404);
    assert.equal((await api("POST", "/api/admin/portal/reports/resolve", tokens.member, { type: "post", id: state.reportedPost, action: "remove" })).status, 403);
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before, "no refusal was logged");
    assert.equal(await count("community_posts", "id = ? AND deleted_at IS NULL", [state.reportedPost]), 1, "and nothing was deleted");
  }));
});

