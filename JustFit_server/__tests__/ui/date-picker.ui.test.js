// Regression tests for the web date picker on the personal-details step: the sheet must
// render a real HTML date input carrying the app's own limits, confirm only valid dates
// inside those limits, and keep the chosen date across navigation. The setup routes need
// a session, so one test account signs in first through the phone sign-in (and is deleted
// afterwards); nothing is submitted, and nothing is written beyond the account row sign-in makes.
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
const { helpers, dateOfBirth, signInAs } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const DATE_INPUT = "[aria-modal] input";

// The limits the app computes in lib/date.ts (ages 13 to 100), as the date input must carry them
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function expectedLimits(today = new Date()) {
  const maximumYear = today.getFullYear() - 13;
  const maximumDay = Math.min(today.getDate(), new Date(maximumYear, today.getMonth() + 1, 0).getDate());
  return {
    min: iso(new Date(today.getFullYear() - 100, today.getMonth(), today.getDate())),
    max: iso(new Date(maximumYear, today.getMonth(), maximumDay)),
  };
}

describe("ui date picker: real HTML date input with the app's limits", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const valid = dateOfBirth(30);

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const dateInput = () => page.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(DATE_INPUT)})].filter((e) => e.getClientRects().length > 0).pop(); if (!el) return null; return { type: el.type, min: el.min, max: el.max, value: el.value, rangeOverflow: el.validity.rangeOverflow, rangeUnderflow: el.validity.rangeUnderflow, valid: el.validity.valid }; })()`);
  const doneDisabled = () => page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === "Done" && e.getClientRects().length > 0).pop(); let el = t; for (let i = 0; i < 5 && el; i++) { if (el.getAttribute("aria-disabled") !== null) return el.getAttribute("aria-disabled"); el = el.parentElement; } return null; })()`);
  // The row's label is always rendered (its placeholder is replaced once a date is chosen)
  const openSheet = async () => { await page.clickText("Date of birth"); await h.expectText("Cancel"); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try { identities.a = await testAccounts.createIdentity(runId, "a"); } catch (error) { throw new Error(`could not create the test identity: ${JSON.stringify(describeIdentityError(error))}`); }
    await signInAs(page, h, identities.a);
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) await step(`cleanup identity ${tag} (${identities[tag]?.id})`, async () => { await db.deleteUsers(connection, [identities[tag].id]); await testAccounts.deleteUser(identities[tag].id); delete identities[tag]; });
    }
    await step("row counts unchanged", async () => {
      if (!connection) return;
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "rows changed during a UI test that never saves"); }
      finally { await connection.end(); }
    });
    await step("ports released", async () => {
      for (const port of [env ? Number(env.PORT) : 4100, EXPO_PORT]) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !(await portFree(port))) await new Promise((r) => setTimeout(r, 250));
        assert.ok(await portFree(port), `port ${port} was not released`);
      }
    });
    await step("profile removed", async () => { if (chrome) assert.ok(!fs.existsSync(chrome.profile), "temporary Chrome profile was not removed"); });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", Object.values(identities).map((i) => i.id).join(", ") || "none"); throw new Error("teardown problems: " + problems.join("; ")); }
  });

  it("1. the sheet renders an input of type date carrying the app's minimum and maximum", run("type-and-limits", async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await openSheet();
    const input = await dateInput();
    assert.ok(input, "no rendered input inside the sheet");
    assert.equal(input.type, "date");
    assert.deepEqual({ min: input.min, max: input.max }, expectedLimits());
  }));

  it("2. a valid date can be confirmed and the field then shows it", run("valid-date", async () => {
    await page.setInput(DATE_INPUT, valid.input);
    const input = await dateInput();
    assert.equal(input.value, valid.input);
    assert.equal(input.valid, true, "the browser must accept a date inside the limits");
    assert.notEqual(await doneDisabled(), "true", "Done must be enabled for a valid date");
    await page.clickText("Done");
    await h.expectNoText("Done");
    await h.expectText(valid.shown);
  }));

  it("3. dates outside the limits fail the browser constraint and cannot be confirmed", run("out-of-range", async () => {
    for (const [label, age, flag] of [["too young", 10, "rangeOverflow"], ["too old", 101, "rangeUnderflow"]]) {
      await openSheet();
      await page.setInput(DATE_INPUT, dateOfBirth(age).input);
      const input = await dateInput();
      assert.equal(input[flag], true, `${label}: the browser should report ${flag}`);
      assert.equal(await doneDisabled(), "true", `${label}: Done must be disabled`);
      await page.clickText("Done"); // disabled: nothing may happen
      await new Promise((r) => setTimeout(r, 500));
      assert.ok(await page.hasText("Done"), `${label}: the sheet must stay open`);
      await page.clickText("Cancel");
      await h.expectNoText("Done");
      await h.expectText(valid.shown); // the previously confirmed date is untouched
    }
  }));

  it("4. the date is kept when leaving the step and coming back, and the other fields still gate Next", run("navigation", async () => {
    await page.setInput(h.input("Your full name"), "Date Tester");
    assert.equal(await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === "Next" && e.getClientRects().length > 0).pop(); let el = t; for (let i = 0; i < 5 && el; i++) { if (el.getAttribute("aria-disabled") !== null) return el.getAttribute("aria-disabled"); el = el.parentElement; } return null; })()`), "true");
    await page.setInput(h.input("170"), "170");
    await page.setInput(h.input("70"), "60");
    await page.clickText("Next");
    await h.expectPath("/setup/body-composition");
    await page.clickLabel("Back");
    await h.expectPath("/setup/personal");
    await h.expectText(valid.shown);
    assert.equal(await page.inputValue(h.input("Your full name")), "Date Tester");
    await openSheet();
    assert.equal((await dateInput()).value, valid.input, "reopening the sheet shows the kept date");
    await page.clickText("Cancel");
    await h.expectNoText("Done");
  }));

  it("5. nothing was written", run("no-writes", async () => {
    assert.deepEqual(page.requests.filter((u) => /:4000\b/.test(u)), [], "no request to the development server");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 });
    assert.deepEqual(await db.rowCounts(connection), { ...countsBefore, users: countsBefore.users + 1 }, "only the account row sign-in made");
  }));
});
