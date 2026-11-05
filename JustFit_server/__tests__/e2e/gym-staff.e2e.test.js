// Staff / Admin Login end to end: test accounts in justfit_test against the real Express server,
// with the fake SMS provider for the invite that joins at sign-in. A justFit admin makes a gym with
// two branches (and another gym) and links the gym admin; the gym admin adds a member as Staff
// (their role becomes gym_admin and the portal opens for them) and another as Trainer (role
// trainer, no portal), invites a number that has never signed in (it joins as a Trainer when that
// number verifies a code), cancels an invite, and removes people (back to a member from their last
// branch only; a trainer's PT members lose their trainer).
// Attack paths: no session, members, trainers and Staff on the team routes, adding a Super Admin
// or another gym's admin, a kind of 'owner', a gym id in the body, SQL in the phone and the path,
// removing yourself or the gym admin, another gym's people and invites, and refused adds that
// write nothing.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym staff e2e: Staff / Admin Login, invites and roles", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  // Numbers that have never signed in (accounts made from them are deleted afterwards)
  const freshPhone = () => "8" + String(crypto.randomInt(0, 1_000_000_000)).padStart(9, "0");
  const newcomer = freshPhone();
  const cancelled = freshPhone();

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const roleOf = async (userId) => (await connection.query("SELECT role FROM users WHERE id = ?", [userId]))[0][0]?.role;
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["otherOwner", "gym_admin"], ["staffer", "user"], ["coach", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Ravi Kumar' WHERE id = ?", [identities.coach.id]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.tumkur, state.kunigal, state.other].filter(Boolean);
        const [joined] = await connection.query("SELECT id FROM users WHERE phone IN (?)", [[newcomer, cancelled]]);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = [...Object.values(identities).map((i) => i.id), ...joined.map((u) => u.id)];
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?) OR target_id IN (?)", [all, gymIds.length ? gymIds.map(String) : ["-"]]);
        await connection.query("DELETE FROM auth_sessions WHERE user_id IN (?)", [all]);
        await connection.query("DELETE FROM otp_challenges WHERE phone IN (?)", [[newcomer, cancelled]]);
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

  it("1. a gym with two branches and another gym; each gym admin linked", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.tumkur = a.json.gym.id;
    const branch = await as("admin").post(`/api/admin/portal/gyms/${state.tumkur}/branches`, { branch: "Kunigal", area: "Main Road", city: "Kunigal" });
    assert.equal(branch.status, 201, JSON.stringify(branch.json));
    state.kunigal = (await connection.query("SELECT id FROM gyms WHERE name = 'Kunigal' AND brand_id = (SELECT brand_id FROM gyms WHERE id = ?)", [state.tumkur]))[0][0].id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Iron House", branch: "Main", area: "MG Road", city: "Bengaluru" });
    state.other = b.json.gym.id;
    for (const [gym, tag] of [[state.tumkur, "owner"], [state.kunigal, "owner"], [state.other, "otherOwner"]]) {
      assert.equal((await as("admin").post(`/api/admin/portal/gyms/${gym}/staff`, { phone: identities[tag].phone })).status, 201);
    }
    assert.equal((await as("owner").post("/api/gym/branch", { branchId: state.tumkur })).status, 200);
    const dash = await as("owner").get("/api/gym/dashboard");
    assert.equal(dash.json.gym.access, "owner", "the gym admin is the owner");
  }));

  it("2. only the gym admin sees the team; it starts with just them", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/gym/staff", token)).status, 401);
    for (const tag of ["member", "admin"]) assert.equal((await as(tag).get("/api/gym/staff")).status, 403, `${tag} is refused`);
    const list = await as("owner").get("/api/gym/staff");
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.team.length, 1);
    assert.deepEqual({ ...list.json.team[0], addedAt: undefined }, { id: identities.owner.id, name: null, phone: list.json.team[0].phone, kind: "owner", addedAt: undefined, you: true });
    assert.match(list.json.team[0].phone, /^\+91 ••••• ••\d{3}$/, "numbers are masked");
    assert.deepEqual(list.json.invites, []);
  }));

  it("3. adding a member as Staff makes them gym_admin and opens the portal for them, without the team", run(async () => {
    assert.equal((await as("staffer").get("/api/gym/dashboard")).status, 403, "a member has no portal yet");
    const added = await as("owner").post("/api/gym/staff", { phone: identities.staffer.phone, kind: "staff" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.result, "added");
    assert.equal(added.json.team.find((p) => p.id === identities.staffer.id).kind, "staff");
    assert.equal(await roleOf(identities.staffer.id), "gym_admin");

    // Their existing session switches at once: the server reads the role on every request
    assert.equal((await as("staffer").get("/api/auth/me")).json.user.role, "gym_admin");
    const dash = await as("staffer").get("/api/gym/dashboard");
    assert.equal(dash.status, 200, JSON.stringify(dash.json));
    assert.equal(dash.json.gym.access, "staff");
    assert.equal(dash.json.gym.branchCount, 1);
    for (const call of [as("staffer").get("/api/gym/staff"), as("staffer").post("/api/gym/staff", { phone: identities.member.phone, kind: "staff" }), as("staffer").del(`/api/gym/staff/${identities.coach.id}`)]) {
      assert.equal((await call).status, 403, "Staff can't manage the team");
    }
    assert.equal(await roleOf(identities.member.id), "user", "Staff's add was refused");
  }));

  it("4. adding a member as Trainer makes them a trainer, who has no portal", run(async () => {
    const added = await as("owner").post("/api/gym/staff", { phone: identities.coach.phone, kind: "trainer" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(await roleOf(identities.coach.id), "trainer");
    assert.deepEqual(added.json.team.map((p) => p.kind), ["owner", "staff", "trainer"], "the gym admin first, then Staff, then Trainers");
    assert.equal(added.json.team.find((p) => p.kind === "trainer").name, "Ravi Kumar");
    assert.equal((await as("coach").get("/api/auth/me")).json.user.role, "trainer");
    assert.equal((await as("coach").get("/api/gym/dashboard")).status, 403, "a trainer's link isn't a portal link");
    assert.equal((await as("coach").get("/api/gym/staff")).status, 403);
  }));

  it("5. refuses Super Admins, other gyms' people, repeats and bad requests, writing nothing", run(async () => {
    const rows = await count("gym_staff", "gym_id IN (?)", [[state.tumkur, state.kunigal]]);
    const cases = [
      [{ phone: identities.admin.phone, kind: "staff" }, 409, /can't be added/],
      [{ phone: identities.otherOwner.phone, kind: "staff" }, 409, /another gym/],
      [{ phone: identities.staffer.phone, kind: "staff" }, 409, /already on your team/],
      [{ phone: identities.coach.phone, kind: "staff" }, 409, /already on your team/],
      [{ phone: identities.owner.phone, kind: "trainer" }, 409, /already on your team/],
      [{ phone: identities.member.phone, kind: "owner" }, 400, /Staff or Trainer/],
      [{ phone: identities.member.phone, kind: "staff", gymId: state.other }, 400, /fields we don't use/],
      [{ phone: identities.member.phone, kind: "staff", role: "admin" }, 400, /fields we don't use/],
      [{ phone: "9876' OR '1'='1", kind: "staff" }, 400, /./],
      [{ kind: "staff" }, 400, /./],
    ];
    for (const [body, status, message] of cases) {
      const r = await as("owner").post("/api/gym/staff", body);
      assert.equal(r.status, status, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, message);
    }
    assert.equal(await count("gym_staff", "gym_id IN (?)", [[state.tumkur, state.kunigal]]), rows);
    assert.equal(await count("gym_staff_invites", "gym_id = ?", [state.tumkur]), 0);
    assert.equal(await roleOf(identities.admin.id), "admin");
    assert.equal(await roleOf(identities.member.id), "user");
  }));

  it("6. a number that never signed in is invited, then joins as a Trainer when it verifies a code", run(async () => {
    const invited = await as("owner").post("/api/gym/staff", { phone: newcomer, kind: "trainer" });
    assert.equal(invited.status, 202, JSON.stringify(invited.json));
    assert.equal(invited.json.result, "invited");
    assert.equal(invited.json.invites.length, 1);
    assert.equal(invited.json.invites[0].kind, "trainer");
    assert.equal(invited.json.invites[0].phone, `+91 ••••• ••${newcomer.slice(7)}`);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: newcomer, kind: "trainer" })).status, 409, "invited once per branch");
    assert.equal((await as("otherOwner").post("/api/gym/staff", { phone: newcomer, kind: "trainer" })).status, 409, "another gym can't invite them too");
    assert.equal(await count("users", "phone = ?", [newcomer]), 0, "inviting makes no account");

    assert.equal((await api("POST", "/api/auth/request-otp", null, { phone: newcomer })).status, 200);
    const signedIn = await api("POST", "/api/auth/verify-otp", null, { phone: newcomer, code: server.readCode(newcomer) });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
    assert.equal(signedIn.json.user.role, "trainer", "the invite applied in the sign-in");
    assert.equal(signedIn.json.user.isNew, true);
    const userId = signedIn.json.user.id;
    assert.equal(await count("gym_staff", "user_id = ? AND gym_id = ? AND kind = 'trainer'", [userId, state.tumkur]), 1);
    assert.equal(await count("gym_staff_invites", "phone = ?", [newcomer]), 0, "the invite is used up");
    assert.equal(await count("admin_audit_log", "action = 'gym.staff_join' AND target_id = ?", [String(state.tumkur)]), 1);
    assert.equal((await as("owner").get("/api/gym/staff")).json.invites.length, 0);
  }));

  it("7. cancelling an invite: only this branch's, once", run(async () => {
    const invited = await as("owner").post("/api/gym/staff", { phone: cancelled, kind: "staff" });
    assert.equal(invited.status, 202);
    const id = invited.json.invites[0].id;
    assert.equal((await as("otherOwner").del(`/api/gym/staff/invites/${id}`)).status, 404, "another gym's admin can't cancel it");
    assert.equal((await as("staffer").del(`/api/gym/staff/invites/${id}`)).status, 403);
    const gone = await as("owner").del(`/api/gym/staff/invites/${id}`);
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.deepEqual(gone.json.invites, []);
    assert.equal((await as("owner").del(`/api/gym/staff/invites/${id}`)).status, 404);
    assert.equal((await as("owner").del("/api/gym/staff/invites/1%20OR%201=1")).status, 400);

    // A cancelled invite doesn't apply: the number signs in as a member
    assert.equal((await api("POST", "/api/auth/request-otp", null, { phone: cancelled })).status, 200);
    const signedIn = await api("POST", "/api/auth/verify-otp", null, { phone: cancelled, code: server.readCode(cancelled) });
    assert.equal(signedIn.json.user.role, "user");
  }));

  it("8. removing: never yourself or the gym admin, only your own team, and the role follows the branches left", run(async () => {
    assert.match((await as("owner").del(`/api/gym/staff/${identities.owner.id}`)).json.error, /yourself/);
    assert.equal((await as("owner").del(`/api/gym/staff/${identities.otherOwner.id}`)).status, 404, "another gym's admin isn't on this team");
    assert.equal((await as("owner").del(`/api/gym/staff/${identities.member.id}`)).status, 404);
    assert.equal((await as("owner").del("/api/gym/staff/x%27%20OR%201%3D1")).status, 400);

    // Staff at both branches: leaving one keeps the portal, leaving the last makes them a member
    assert.equal((await as("owner").post("/api/gym/branch", { branchId: state.kunigal })).status, 200);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.staffer.phone, kind: "staff" })).status, 201);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.coach.phone, kind: "staff" })).status, 409, "a trainer can't be Staff elsewhere");
    assert.equal((await as("owner").post("/api/gym/branch", { branchId: state.tumkur })).status, 200);
    assert.equal((await as("staffer").get("/api/gym/dashboard")).json.gym.branchCount, 2);

    const fromTumkur = await as("owner").del(`/api/gym/staff/${identities.staffer.id}`);
    assert.equal(fromTumkur.status, 200, JSON.stringify(fromTumkur.json));
    assert.equal(await roleOf(identities.staffer.id), "gym_admin", "still Staff at Kunigal");
    const dash = await as("staffer").get("/api/gym/dashboard");
    assert.equal(dash.json.gym.branch, "Kunigal");

    assert.equal((await as("owner").post("/api/gym/branch", { branchId: state.kunigal })).status, 200);
    assert.equal((await as("owner").del(`/api/gym/staff/${identities.staffer.id}`)).status, 200);
    assert.equal(await roleOf(identities.staffer.id), "user", "no branch left: a member again");
    assert.equal((await as("staffer").get("/api/gym/dashboard")).status, 403);
    assert.equal((await as("staffer").get("/api/auth/me")).json.user.role, "user");
    assert.equal((await as("owner").post("/api/gym/branch", { branchId: state.tumkur })).status, 200);
  }));

  it("9. a trainer who leaves takes no PT members with them", run(async () => {
    const admitted = await as("owner").post("/api/gym/members", { name: "Arjun M", phone: "9123456780", unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    const memberId = admitted.json.member?.id ?? admitted.json.id;
    await connection.query("UPDATE gym_members SET pt_trainer_id = ? WHERE id = ?", [identities.coach.id, memberId]);

    const removed = await as("owner").del(`/api/gym/staff/${identities.coach.id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(await roleOf(identities.coach.id), "user");
    assert.equal((await connection.query("SELECT pt_trainer_id FROM gym_members WHERE id = ?", [memberId]))[0][0].pt_trainer_id, null);
    assert.deepEqual(removed.json.team.map((p) => p.kind), ["owner", "trainer"], "the invited trainer stays");
  }));

  it("10. every change is in the audit log; the Super Admin's gym page lists gym admins only", run(async () => {
    for (const action of ["gym.staff_add", "gym.staff_invite", "gym.staff_invite_cancel", "gym.staff_remove"]) {
      assert.ok(await count("admin_audit_log", "admin_id = ? AND action = ?", [identities.owner.id, action]) >= 1, action);
    }
    const detail = await as("admin").get(`/api/admin/portal/gyms/${state.tumkur}?date=${today}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.deepEqual(detail.json.staff.map((s) => s.id), [identities.owner.id]);
  }));
});
