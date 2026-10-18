// The Community Friends tab in the real Expo web build against the isolated test server and
// the eato_test database. Priya is signed in; Rohan and Chitra act through the API with their
// own session tokens (the real other side of a request, not a demo button). Covers: the empty
// state, sending a request (Requested + locked messaging), the other member accepting,
// messaging a friend, accepting a received request, removing a friend behind a confirmation
// (the chat keeps its history but locks the composer), the profile's friend button, and
// screenshots at three widths.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
//   EATO_SCREENSHOT_DIR=<dir> saves screenshots of each screen at three widths
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { clerkFor, describeClerkError } = require("../e2e/clerk-identities.js");
const { pairOf } = require("../../community/friendRules.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const CLEANUP_TABLES = ["messages", "conversation_members", "conversations", "community_friendships"];

describe("ui friends: requests between real accounts and the messaging lock", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const sessions = {};
  const tokens = {};

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
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true }, page.sessionId);
  const snapshotAllWidths = async (name) => {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`));
    }
    await viewport(390, 844);
  };
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const hasLabel = (label) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].some((e) => e.getClientRects().length > 0)`);
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  // Another member, through the API with their own session token
  const apiAs = async (tag, method, route) => {
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers: { Authorization: `Bearer ${tokens[tag]}` } });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const pairStatus = async (a, b) => {
    const [low, high] = pairOf(identities[a].id, identities[b].id);
    const [rows] = await connection.query("SELECT status FROM community_friendships WHERE user_low = ? AND user_high = ?", [low, high]);
    return rows[0]?.status ?? null;
  };
  // The screen updates as the server answers: wait for the row to catch up
  const waitForPair = async (a, b, expected) => {
    const deadline = Date.now() + 10000;
    let status = null;
    while (Date.now() < deadline) {
      status = await pairStatus(a, b);
      if (status === expected) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(status, expected, `friendship ${a}–${b} on the server`);
  };
  // Filter chips are clicked by their accessible name ("Friends" is also the tab's text).
  // Re-selecting the open chip doesn't reload, so hop through another filter.
  // The filter chips carry live counts ("Friends (1)"), so they're found by the start of their label
  const clickChip = async (prefix) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[role="tab"][aria-label^=${JSON.stringify(prefix)}]')].find((e) => e.getClientRects().length > 0); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `chip ${prefix}`);
    await page.clickAt(pos.x, pos.y);
  };
  const showFilter = async (label, via) => {
    await clickChip(via);
    await h.settle();
    await clickChip(label);
    await h.settle();
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await clerk.createIdentity(runId, "a", { withPassword: true });
      for (const tag of ["b", "c"]) {
        identities[tag] = await clerk.createIdentity(runId, tag);
        const minted = await clerk.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    const names = { a: "Priya Sharma", b: "Rohan Mehta", c: "Chitra Iyer" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [identities[tag].id, identities[tag].emailAddress, names[tag]]);
    }
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
      for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
      await db.deleteUsers(connection, Object.values(identities).map((i) => i.id));
      await connection.end();
    });
    await step("identities", async () => {
      if (!clerk) return;
      for (const sessionId of Object.values(sessions)) await clerk.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Friends tab opens on suggestions; the Friends list starts empty", run("empty", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Community");
    await h.expectPath("/community");
    await page.clickText("Friends");
    await h.expectText("Rohan Mehta");
    await h.expectText("Chitra Iyer");
    assert.equal(await hasLabel("Messaging Rohan is locked until you're friends"), true, "a lock beside everyone who isn't a friend");
    await noOverflow("friends suggested");
    await snapshotAllWidths("friends-suggested");
    await h.expectText("Friends (0)");
    await h.expectText("Requests sent (0)");
    await clickChip("Friends (");
    await h.expectText("No friends yet");
    await snapshotAllWidths("friends-empty");
    await page.clickText("Find friends");
    await h.expectText("Rohan Mehta");
    assert.equal(await page.hasText("Priya Sharma"), false, "you aren't suggested to yourself");
  }));

  it("2. Add Friend sends a request: Requested, messaging locked, nothing accepted yet", run("request", async () => {
    await clickLabel("Add Rohan Mehta as a friend");
    await waitForPair("a", "b", "pending");
    await page.waitFor(`!!document.querySelector('[aria-label="Cancel your request to Rohan Mehta"]')`, NAV_TIMEOUT, "Requested button");
    assert.equal(await hasLabel("Messaging Rohan Mehta unlocks when they accept"), true, "the lock shows beside the request");
    await snapshotAllWidths("friends-requested");
    await h.expectText("Requests sent (1)");
    await clickChip("Requests sent");
    await h.expectText("Request sent");
  }));

  it("3. when Rohan accepts from his own account, he is a friend and can be messaged", run("accepted", async () => {
    const accepted = await apiAs("b", "POST", `/api/community/friends/${identities.a.id}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    await showFilter("Friends", "Suggested");
    await h.expectText("Rohan Mehta");
    await h.expectText("Friends since");
    await snapshotAllWidths("friends-list");
    await clickLabel("Message Rohan Mehta");
    await page.waitFor(`location.pathname.startsWith("/messages/")`, NAV_TIMEOUT, "the conversation");
    await h.expectText("Say hello to Rohan Mehta.");
    assert.equal(await hasLabel("Send message"), true, "the composer is there for a friend");
  }));

  it("4. a received request shows Accept when you find that member (it also arrives in Notifications)", run("incoming", async () => {
    const sent = await apiAs("c", "POST", `/api/community/friends/${identities.a.id}/request`);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    await h.goto("/community", "TRAIN TOGETHER");
    await page.clickText("Friends");
    await page.setInput('[aria-label="Search members"]', "Chitra");
    await h.expectText("Wants to be friends");
    await snapshotAllWidths("friends-requests");
    await clickLabel("Accept Chitra Iyer's request");
    await waitForPair("a", "c", "accepted");
    await h.expectNoText("Wants to be friends");
  }));

  it("5. removing a friend asks first; the chat keeps its history but locks the composer", run("remove", async () => {
    await page.setInput('[aria-label="Search members"]', ""); // test 4 left a search in the box, which hides the chips
    await showFilter("Friends", "Suggested");
    await clickLabel("Remove Rohan Mehta as a friend");
    await h.expectText("Remove Rohan as a friend?");
    await snapshotAllWidths("friends-remove-confirm");
    await clickLabel("Remove friend");
    await waitForPair("a", "b", "removed");
    await h.expectNoText("Rohan Mehta");
    const [[conversation]] = await connection.query(
      "SELECT a.conversation_id AS id FROM conversation_members a JOIN conversation_members b ON b.conversation_id = a.conversation_id WHERE a.user_id = ? AND b.user_id = ?",
      [identities.a.id, identities.b.id],
    );
    await h.goto(`/messages/${conversation.id}`, "Rohan Mehta");
    await h.expectText("Add Rohan as a friend to message them.");
    assert.equal(await hasLabel("Send message"), false, "no composer once the friendship ends");
    await snapshotAllWidths("friends-chat-locked");
  }));

  it("6. a friend's profile shows Friends and an unlocked Message; a stranger's shows the lock", run("profile", async () => {
    await h.goto(`/community/profile/${identities.c.id}`, "Chitra Iyer");
    await page.waitFor(`!!document.querySelector('[aria-label="Friends"]')`, NAV_TIMEOUT, "Friends button");
    assert.equal(await hasLabel("Message"), true);
    await snapshotAllWidths("friends-profile");
    await h.goto(`/community/profile/${identities.b.id}`, "Rohan Mehta");
    await h.expectText("Add Rohan as a friend to message them.");
    assert.equal(await hasLabel("Message, locked"), true);
    await clickLabel("Add Friend");
    await waitForPair("a", "b", "pending");
    await h.expectText("Messaging unlocks when Rohan accepts your friend request.");
  }));
});
