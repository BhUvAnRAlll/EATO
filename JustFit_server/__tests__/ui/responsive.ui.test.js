// Responsive regression pass: every main screen of the member app, the gym portal and the Super
// Admin, opened in the real Expo web build at the seven logical phone widths (320, 360, 375, 390,
// 393, 412, 430). At each width the page must not scroll sideways and no visible element may
// cross the screen's left or right edge, unless it sits inside a row that scrolls sideways on
// purpose (chips, carousels). The accounts sign in with a minted session; the data is seeded
// through the real API with long names, so tight rows are stressed. Everything is removed after.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, SESSION_KEY, NAV_TIMEOUT } = require("./onboarding-steps.js");
const nutrition = require("../../../JustFit_client/src/lib/nutrition/index.ts");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [360, 740], [375, 667], [390, 844], [393, 852], [412, 915], [430, 932]];
const LONG = "Venkataramanappa Subramanyaswamy Krishnamurthy";

const inputs = { age: 30, gender: "female", heightCm: 165, weightKg: 60, activityLevel: "lightly_active", fitnessGoal: "maintenance", healthFlags: [] };
const birth = new Date(); birth.setFullYear(birth.getFullYear() - inputs.age);
const pad = (n) => String(n).padStart(2, "0");
const profile = {
  fullName: LONG, dob: `${pad(birth.getDate())}/${pad(birth.getMonth() + 1)}/${birth.getFullYear()}`, gender: "female", phone: "", email: "", goal: "maintenance",
  heightCm: "165", weightKg: "60", bodyFatPercent: "", age: "30", activity: "lightly_active", healthFlags: [], diet: "vegetarian",
  cuisines: ["South Indian"], dislikes: "", allergies: "", workoutFrequency: "3-4", workoutType: "home", workoutTime: "evening", mealsPerDay: "3",
};
const record = nutrition.createTargetRecord(inputs, nutrition.calculateTargets(inputs));

// Visible elements crossing the viewport's side edges, ignoring anything inside a container that
// scrolls sideways (a chip row, a carousel) and anything wholly off-screen (a stacked screen, a
// closed drawer). Returns the page's own overflow and up to five offenders.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const inSideScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if ((s.overflowX === "auto" || s.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
      if (s.overflowX === "hidden" || s.overflowX === "clip") { const r = p.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) return true; }
    }
    return false;
  };
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.childElementCount > 0 && el.tagName !== "svg") continue;
    if (el.closest("svg") && el.tagName !== "svg") continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.left >= vw - 1 || r.right <= 1) continue; // wholly off-screen: a stacked screen or a closed panel
    if (r.right > vw + 1 || r.left < -1) {
      if (inSideScroller(el)) continue;
      offenders.push({ text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  return { vw, pageOverflow: document.documentElement.scrollWidth > vw + 1, offenders: offenders.slice(0, 5) };
})()`;

describe("ui responsive: every main screen fits at 320–430 px without sideways overflow", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
  const state = {};
  const failures = [];

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true }, page.sessionId);
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  // Signs the page in as a tag with its minted session (the sign-in flow has its own suites)
  const useSession = async (tag) => {
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`document.readyState === "complete"`, NAV_TIMEOUT, "the page");
    await page.evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(tokens[tag])})`);
  };
  // Opens a route, waits until it shows `text`, then checks it at every width
  const check = async (route, text) => {
    await page.navigate(`${expo.baseUrl}${route}`);
    try {
      await page.waitFor(`(document.body.innerText || "").toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`, NAV_TIMEOUT, `"${text}" on ${route}`);
    } catch (error) {
      // A web server that went away is named with the end of its log, not blamed on the screen
      const gone = await fetch(expo.baseUrl).then(() => false, () => true);
      failures.push(`${route}: never showed "${text}" (now on ${await page.path().catch(() => "?")})${gone ? `\n  the Expo web server stopped; its error:\n  ${expo.logs.filter((l) => /FATAL|Error|error:|ENOMEM|EMFILE|heap/i.test(l)).slice(0, 6).join("\n  ") || "(none printed)"}\n  its last lines:\n  ${expo.logs.slice(-6).join("\n  ")}` : ""}`);
      return;
    }
    await h.settle();
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await new Promise((r) => setTimeout(r, 450));
      const m = await page.evaluate(MEASURE);
      if (m.pageOverflow || m.offenders.length > 0) failures.push(`${route} at ${w}: ${m.pageOverflow ? "page scrolls sideways; " : ""}${m.offenders.map((o) => `"${o.text}" ${o.left}→${o.right}`).join(", ")}`);
    }
    // Screenshots only on request (JUSTFIT_SCREENSHOT_DIR), tall so most of a screen shows
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const name = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
      for (const w of [320, 430]) {
        await viewport(w, 1100);
        await new Promise((r) => setTimeout(r, 450));
        await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`));
      }
    }
    await viewport(390, 844);
  };
  const report = (scope) => {
    const mine = failures.splice(0);
    assert.deepEqual(mine, [], `${scope}: ${mine.length} layout problem(s):\n${mine.join("\n")}`);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["member", "user"], ["owner", "gym_admin"], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const saved = await apiAs("member", "POST", "/api/profile", { profile: { ...profile, phone: identities.member.phone }, nutrition: record });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));

    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma Fitness Studio", branch: "Tumkur Main Road", area: "SIT Road Extension", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    // The member is also a gym member (their verified phone), so Gym membership has a card
    const members = [
      { name: LONG, phone: identities.member.phone, duration: 3, fee: 45000, paid: 10000, method: "cash", dueBy: "2027-01-15" },
      { name: "Ravi Kumar", phone: "9123456780", duration: 1, fee: 1500, paid: 1500, method: "online" },
    ];
    for (const body of members) {
      const admitted = await apiAs("owner", "POST", "/api/gym/members", body);
      assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
      state.memberId ??= admitted.json.member.id;
    }
    const pays = await apiAs("owner", "GET", `/api/gym/members/${state.memberId}`);
    state.paymentId = pays.json?.payments?.[0]?.id ?? null;
    await apiAs("owner", "POST", "/api/gym/catalog", { kind: "plan", name: "Gold Annual Membership with Steam", duration: 12, price: 24999 });
    await apiAs("owner", "POST", "/api/gym/enquiries", { name: LONG, phone: "9988776655", interest: "pt", source: "walk_in" });
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("rows", async () => {
      if (!connection) return;
      if (state.gym) {
        const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
        for (const table of ["gym_activity_log", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
        await connection.query("DELETE FROM gyms WHERE id = ?", [state.gym]);
        await connection.query("DELETE FROM gym_brands WHERE id = ?", [brandId]);
      }
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. signed-out screens", run("signed-out", async () => {
    await check("/", "Get Started");
    await check("/sign-in", "Send code");
    await check("/sign-up", "Send code");
    report("signed out");
  }));

  it("2. the member app", run("member", async () => {
    await useSession("member");
    for (const [route, text] of [
      ["/home", "Today"],
      ["/macro", "Macro"],
      ["/macro/water", "Water"],
      ["/macro/adjust-targets", "Calories"],
      ["/macro/manual", "Save"],
      ["/macro/log", "Log"],
      ["/macro/favorites", "Favourite"],
      ["/macro/daily", "Daily"],
      ["/macro/calories-macros", "Calories"],
      ["/coach", "Coach"],
      ["/coach/intake/goal", "goal"],
      ["/workout", "Fitness"],
      ["/fitness/search", "At home"],
      ["/meals", "Meals"],
      ["/profile", "Profile"],
      ["/goals", "Goal"],
      ["/measurements", "Height & weight"],
      ["/notifications", "Notifications"],
      ["/membership", "Forma Fitness Studio"],
      ["/membership/pause", "Pause"],
      ["/attendance", "attendance"],
      ["/orders", "Orders"],
      ["/addresses", "Addresses"],
      ["/plans", "Plans"],
    ]) await check(route, text);
    report("member app");
  }));

  it("3. the gym portal", run("gym", async () => {
    await useSession("owner");
    const id = state.memberId;
    for (const [route, text] of [
      ["/gym", "Tumkur Main Road"],
      ["/gym/manage", "Ravi Kumar"],
      ["/gym/wallet", "This month"],
      ["/gym/members", "Ravi Kumar"],
      [`/gym/members/${id}`, "Venkataramanappa"],
      [`/gym/members/${id}/renew`, "Renew"],
      [`/gym/members/${id}/due`, "Due"],
      [`/gym/members/${id}/pt`, "PT"],
      ["/gym/sale", "Product"],
      ["/gym/service", "Service"],
      ["/gym/transactions", "Transactions"],
      ...(state.paymentId ? [[`/gym/invoice?paymentId=${state.paymentId}`, "Invoice"]] : []),
      ["/gym/catalog", "Gold Annual"],
      ["/gym/enquiries", "Venkataramanappa"],
      ["/gym/expenses", "Expenses"],
      ["/gym/attendance", "Attendance"],
      ["/gym/attendance/settings", "radius"],
      ["/gym/attendance/qr", "QR"],
      [`/gym/attendance/member/${id}?name=${encodeURIComponent(LONG)}`, "Venkataramanappa"],
      ["/gym/pauses", "Pause"],
      ["/gym/predictions/renewals", "Likely to leave"],
      ["/gym/staff", "Staff"],
      ["/gym/permissions", "Permission"],
      ["/gym/templates", "Reminder Templates"],
      ["/gym/settings", "Account"],
      ["/gym/branches", "Tumkur Main Road"],
      ["/gym/details", "Branch"],
    ]) await check(route, text);
    report("gym portal");
  }));

  it("4. the Super Admin", run("admin", async () => {
    await useSession("admin");
    for (const [route, text] of [
      ["/admin", "Overview"],
      ["/admin/users", "Users"],
      ["/admin/content", "Content"],
      ["/admin/gyms", "Forma Fitness Studio"],
      [`/admin/gyms/${state.gym}`, "Forma Fitness Studio"],
      ["/admin/gyms/new", "gym"],
      [`/admin/users/${identities.member.id}`, "Venkataramanappa"],
      ["/admin/profile", "Sign out"],
      ["/admin/ai-usage", "AI"],
      ["/admin/ai-usage/history", "AI"],
      ["/admin/ai-usage/budget", "Budget"],
      ["/admin/app-usage", "Usage"],
      ["/admin/programs", "Programs"],
      ["/admin/categories", "Categories"],
      ["/admin/exercises", "Exercises"],
      ["/admin/promotions", "Promotions"],
      ["/admin/home-content", "Home"],
    ]) await check(route, text);
    report("super admin");
  }));
});
