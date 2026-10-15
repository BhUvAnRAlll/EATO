// Authenticated tests for the admin-managed home screen content: real Clerk development
// identities with the admin, trainer and member roles, calling the real Express server
// (index.js) over HTTP against the isolated `eato_test` database, which schema.sql seeds
// with three published promotions and the default home content.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const promotionBody = (overrides = {}) => ({
  title: "Weekend special",
  eyebrow: "THIS WEEKEND",
  headline: "Two bowls, one price",
  description: "Order any two bowls on Saturday and pay for one.",
  imageUrl: "asset:hero-meals",
  ctaLabel: "Order Now",
  ctaDestination: "explore",
  ...overrides,
});

describe("home promotions e2e: admin edits → members see published content", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {}; // tag → { id, emailAddress, sessionId }
  const tokens = {}; // tag → session JWT (never logged)
  const created = []; // promotion ids made by these tests

  const api = async (method, path, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* non-JSON body */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag];
    if (!identity) return;
    if (identity.sessionId) await clerk.revokeSession(identity.sessionId).catch(() => {});
    await clerk.deleteUser(identity.id);
    delete identities[tag];
    delete tokens[tag];
  };
  const activeIds = async (token = tokens.member) => {
    const { status, json } = await api("GET", "/api/promotions/active", token);
    assert.equal(status, 200);
    return json.promotions.map((p) => p.id);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try {
      connection = await db.connect(env);
    } catch (error) {
      skipReason = `test database unreachable (${error?.code ?? "refused"})`;
      return;
    }
    assert.equal(await db.resetSchema(connection), 35, "schema.sql should create 35 tables in eato_test");
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("admin", "admin");
      await newIdentity("trainer", "trainer");
      await newIdentity("member");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection && created.length > 0) {
      try { await connection.query("DELETE FROM promotions WHERE id IN (?)", [created]); } catch (error) { problems.push(`promotions: ${error.code}`); }
    }
    if (clerk) {
      for (const tag of Object.keys(identities)) {
        try { await cleanupIdentity(tag); } catch (error) { problems.push(`${tag}: ${identities[tag]?.id} (${JSON.stringify(describeClerkError(error))})`); }
      }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) {
      console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", problems.join("; "));
      throw new Error("cleanup incomplete");
    }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. members read the seeded published promotions in display order, and the home content", async () => {
    const { status, json } = await api("GET", "/api/promotions/active", tokens.member);
    assert.equal(status, 200);
    assert.equal(json.promotions.length, 3);
    assert.deepEqual(json.promotions.map((p) => p.displayOrder), [1, 2, 3]);
    assert.equal(json.promotions[0].eyebrow, "CHEF-PREPARED");
    assert.equal(json.promotions[0].effectiveStatus, "published");
    const content = await api("GET", "/api/home-content", tokens.member);
    assert.equal(content.status, 200);
    assert.equal(content.json.content.nutritionHeading, "Today's Nutrition");
    assert.equal(content.json.content.quickActions.length, 4);
    assert.deepEqual(content.json.content.popularMeals.map((m) => m.id), ["grilled-chicken-bowl", "paneer-tikka-bowl", "salmon-bowl"]);
  });

  test("2. the member routes need a valid session", async () => {
    assert.equal((await api("GET", "/api/promotions/active", null)).status, 401);
    assert.equal((await api("GET", "/api/home-content", "not.a.token")).status, 401);
  });

  test("3. members and trainers cannot use any admin route", async () => {
    for (const token of [tokens.member, tokens.trainer]) {
      assert.equal((await api("GET", "/api/admin/promotions", token)).status, 403);
      assert.equal((await api("POST", "/api/admin/promotions", token, promotionBody())).status, 403);
      assert.equal((await api("PATCH", "/api/admin/promotions/1", token, { title: "Hacked" })).status, 403);
      assert.equal((await api("DELETE", "/api/admin/promotions/1", token)).status, 403);
      assert.equal((await api("POST", "/api/admin/promotions/1/disable", token)).status, 403);
      assert.equal((await api("POST", "/api/admin/promotions/reorder", token, { ids: [3, 2, 1] })).status, 403);
      assert.equal((await api("PUT", "/api/admin/home-content", token, {})).status, 403);
      assert.equal((await api("GET", "/api/admin/meals", token)).status, 403);
    }
    assert.equal((await api("GET", "/api/admin/promotions", null)).status, 401);
    // Nothing changed for members
    assert.deepEqual(await activeIds(), [1, 2, 3]);
    const [[row]] = await connection.query("SELECT title FROM promotions WHERE id = 1");
    assert.equal(row.title, "Chef-prepared meals");
  });

  test("4. an admin creates a draft: listed for admins, invisible to members until published", async () => {
    const create = await api("POST", "/api/admin/promotions", tokens.admin, promotionBody());
    assert.equal(create.status, 201, JSON.stringify(create.json));
    const promotion = create.json.promotion;
    created.push(promotion.id);
    assert.equal(promotion.status, "draft");
    assert.equal(promotion.displayOrder, 4);
    assert.equal(promotion.createdBy, identities.admin.id);
    assert.equal(promotion.rotationIntervalSeconds, 2);
    assert.ok(!(await activeIds()).includes(promotion.id));
    const list = await api("GET", "/api/admin/promotions", tokens.admin);
    assert.equal(list.status, 200);
    assert.ok(list.json.promotions.some((p) => p.id === promotion.id));

    const publish = await api("POST", `/api/admin/promotions/${promotion.id}/publish`, tokens.admin);
    assert.equal(publish.status, 200);
    assert.equal(publish.json.promotion.status, "published");
    assert.deepEqual(await activeIds(), [1, 2, 3, promotion.id]);
  });

  test("5. invalid input is rejected with a 400 and nothing is written", async () => {
    const before = (await api("GET", "/api/admin/promotions", tokens.admin)).json.promotions.length;
    const bad = [
      promotionBody({ ctaDestination: "https://evil.example" }),
      promotionBody({ imageUrl: "http://insecure.example/a.jpg" }),
      promotionBody({ rotationIntervalSeconds: 0 }),
      promotionBody({ title: "" }),
      promotionBody({ displayOrder: 1 }),
      promotionBody({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }),
      "just a string",
    ];
    for (const body of bad) {
      const { status } = await api("POST", "/api/admin/promotions", tokens.admin, body);
      assert.equal(status, 400, JSON.stringify(body));
    }
    assert.equal((await api("GET", "/api/admin/promotions", tokens.admin)).json.promotions.length, before);
    // Route ids are validated before any query runs
    for (const id of ["1 OR 1=1", "1;DROP TABLE promotions", "abc"]) {
      assert.equal((await api("GET", `/api/admin/promotions/${encodeURIComponent(id)}`, tokens.admin)).status, 400);
      assert.equal((await api("DELETE", `/api/admin/promotions/${encodeURIComponent(id)}`, tokens.admin)).status, 400);
    }
    assert.equal((await api("GET", "/api/admin/promotions/999999", tokens.admin)).status, 404);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM promotions");
    assert.equal(n, before);
  });

  test("6. a patch keeps the rest of the promotion and re-validates the whole", async () => {
    const id = created[0];
    const ok = await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { headline: "Two bowls, one price (updated)", rotationIntervalSeconds: 4 });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.promotion.headline, "Two bowls, one price (updated)");
    assert.equal(ok.json.promotion.rotationIntervalSeconds, 4);
    assert.equal(ok.json.promotion.ctaLabel, "Order Now");
    assert.equal(ok.json.promotion.status, "published");
    assert.equal(ok.json.promotion.updatedBy, identities.admin.id);
    assert.equal((await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { ctaDestination: "nowhere" })).status, 400);
    assert.equal((await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { id: 1 })).status, 400);
    assert.equal((await api("GET", `/api/admin/promotions/${id}`, tokens.admin)).json.promotion.ctaDestination, "explore");
  });

  test("7. scheduling: a future window hides a published promotion until it opens", async () => {
    const id = created[0];
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { startsAt: future, endsAt: null });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.json.promotion.effectiveStatus, "scheduled");
    assert.ok(!(await activeIds()).includes(id));

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ended = await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { startsAt: null, endsAt: past });
    assert.equal(ended.status, 200);
    assert.equal(ended.json.promotion.effectiveStatus, "ended");
    assert.ok(!(await activeIds()).includes(id));

    const open = await api("PATCH", `/api/admin/promotions/${id}`, tokens.admin, { startsAt: past, endsAt: future });
    assert.equal(open.status, 200);
    assert.equal(open.json.promotion.effectiveStatus, "published");
    assert.ok((await activeIds()).includes(id));
  });

  test("8. reordering changes what members see; a partial or duplicate list is refused", async () => {
    const id = created[0];
    const reorder = await api("POST", "/api/admin/promotions/reorder", tokens.admin, { ids: [id, 3, 2, 1] });
    assert.equal(reorder.status, 200, JSON.stringify(reorder.json));
    assert.deepEqual(reorder.json.promotions.map((p) => p.id), [id, 3, 2, 1]);
    assert.deepEqual(await activeIds(), [id, 3, 2, 1]);
    assert.equal((await api("POST", "/api/admin/promotions/reorder", tokens.admin, { ids: [1, 2] })).status, 400);
    assert.equal((await api("POST", "/api/admin/promotions/reorder", tokens.admin, { ids: [1, 1, 2, 3] })).status, 400);
    assert.equal((await api("POST", "/api/admin/promotions/reorder", tokens.admin, { ids: "1,2,3" })).status, 400);
    assert.deepEqual(await activeIds(), [id, 3, 2, 1]);
    // Put the seeded ones back first
    assert.equal((await api("POST", "/api/admin/promotions/reorder", tokens.admin, { ids: [1, 2, 3, id] })).status, 200);
  });

  test("9. disabling and deleting remove a promotion from the carousel", async () => {
    const id = created[0];
    const disable = await api("POST", `/api/admin/promotions/${id}/disable`, tokens.admin);
    assert.equal(disable.status, 200);
    assert.equal(disable.json.promotion.status, "disabled");
    assert.ok(!(await activeIds()).includes(id));
    const remove = await api("DELETE", `/api/admin/promotions/${id}`, tokens.admin);
    assert.equal(remove.status, 200);
    assert.deepEqual(remove.json, { deleted: true });
    assert.equal((await api("GET", `/api/admin/promotions/${id}`, tokens.admin)).status, 404);
    assert.equal((await api("DELETE", `/api/admin/promotions/${id}`, tokens.admin)).status, 404);
    created.length = 0;
    assert.deepEqual(await activeIds(), [1, 2, 3]);
  });

  test("10. home content: an admin changes labels, quick actions and popular meals; bad input is refused", async () => {
    const current = (await api("GET", "/api/admin/home-content", tokens.admin)).json.content;
    const changed = {
      nutritionHeading: "Your day so far",
      nutritionActionLabel: current.nutritionActionLabel,
      popularHeading: current.popularHeading,
      popularActionLabel: "See menu",
      todayHeading: current.todayHeading,
      todayActionLabel: current.todayActionLabel,
      showTodaySection: false,
      quickActions: current.quickActions.slice(0, 3),
      popularMealIds: ["salmon-bowl", "grilled-chicken-bowl"],
    };
    const save = await api("PUT", "/api/admin/home-content", tokens.admin, changed);
    assert.equal(save.status, 200, JSON.stringify(save.json));
    assert.equal(save.json.content.nutritionHeading, "Your day so far");
    assert.deepEqual(save.json.content.popularMeals.map((m) => m.id), ["salmon-bowl", "grilled-chicken-bowl"]);
    const seen = (await api("GET", "/api/home-content", tokens.member)).json.content;
    assert.equal(seen.popularActionLabel, "See menu");
    assert.equal(seen.showTodaySection, false);
    assert.equal(seen.quickActions.length, 3);

    assert.equal((await api("PUT", "/api/admin/home-content", tokens.admin, { ...changed, popularMealIds: ["no-such-meal"] })).status, 400);
    assert.equal((await api("PUT", "/api/admin/home-content", tokens.admin, { ...changed, quickActions: [{ id: "x", title: "X", subtitle: "Y", icon: "meals", destination: "https://evil.example" }] })).status, 400);
    assert.equal((await api("PUT", "/api/admin/home-content", tokens.admin, { ...changed, caloriesTarget: 1200 })).status, 400);
    assert.equal((await api("GET", "/api/home-content", tokens.member)).json.content.nutritionHeading, "Your day so far");

    // Restore the seeded content for the next suite
    const restore = await api("PUT", "/api/admin/home-content", tokens.admin, {
      nutritionHeading: current.nutritionHeading, nutritionActionLabel: current.nutritionActionLabel,
      popularHeading: current.popularHeading, popularActionLabel: current.popularActionLabel,
      todayHeading: current.todayHeading, todayActionLabel: current.todayActionLabel, showTodaySection: current.showTodaySection,
      quickActions: current.quickActions, popularMealIds: current.popularMealIds,
    });
    assert.equal(restore.status, 200);
  });

  test("11. the admin's meal list is read-only menu data", async () => {
    const { status, json } = await api("GET", "/api/admin/meals", tokens.admin);
    assert.equal(status, 200);
    assert.ok(json.meals.length >= 4);
    assert.ok(json.meals.every((m) => typeof m.id === "string" && typeof m.calories === "number"));
  });
});
