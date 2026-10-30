// Direct messages in the real Expo web build against the isolated test server and the
// justfit_test database, as a signed-in member. Another member (driven through the API) has
// sent 35 messages. Covers: the inbox with its unread count, opening the conversation
// (which marks it read), fetching the older page with a cursor (30 per page), replying,
// a reply from the other member appearing without a reload, a send that fails offline and
// is retried without a duplicate, a send whose reply is lost (settled by Retry or by the
// next poll, never shown or stored twice), a block attempt whose session token can't be
// refreshed, and blocking from the conversation menu.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
//   JUSTFIT_SCREENSHOT_DIR=<dir> saves screenshots of each screen at three widths
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
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_blocks", "community_profiles"];
const SEEDED = 35; // messages from the other member before the screen opens (more than one page)
const POLL_WAIT = 25000; // the screen polls every 10 s; allow two ticks

describe("ui messages: inbox, conversation, polling, retry and block for a signed-in member", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const state = {};

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
  const snapshot = async (name) => {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await h.settle();
    await page.screenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
  };
  const snapshotAllWidths = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await snapshot(`${name}-${w}`);
      await noOverflow(`${name} at ${w}`);
    }
    await viewport(390, 844);
  };
  // Clicks the nth rendered element with this accessible name (-1 = the last one)
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  // The tab bar is at the bottom: click the lowest leaf element with this text
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  // Lets requests reach the server but throws away chosen replies (a response lost on a
  // flaky network). Only this conversation's message URLs are intercepted, at the response
  // stage, so the server has already handled each request. dropMode: "off", "gets" (poll
  // replies) or "post+gets" (also the next send's reply). CORS preflights always pass.
  let dropMode = "off";
  let listening = false;
  let intercepting = false;
  const release = (requestId) => client.send("Fetch.continueRequest", { requestId }, page.sessionId)
    .catch(() => client.send("Fetch.continueResponse", { requestId }, page.sessionId))
    .catch(() => {}); // already released (for example by Fetch.disable)
  const dropReplies = async (mode) => {
    dropMode = mode;
    if (!listening) {
      listening = true;
      client.on((msg) => {
        if (msg.sessionId !== page.sessionId || msg.method !== "Fetch.requestPaused") return;
        const { requestId, request } = msg.params;
        const dropGet = request.method === "GET" && dropMode !== "off";
        const dropPost = request.method === "POST" && dropMode === "post+gets";
        if (dropPost) dropMode = "gets"; // only the next send's reply
        if (dropGet || dropPost) client.send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }, page.sessionId).catch(() => release(requestId));
        else release(requestId);
      });
    }
    if (!intercepting) {
      await client.send("Fetch.enable", { patterns: [{ urlPattern: `*/conversations/${state.conversation}/messages*`, requestStage: "Response" }] }, page.sessionId);
      intercepting = true;
    }
  };
  // Turning interception off also lets go of anything still paused
  const stopDroppingReplies = async () => {
    dropMode = "off";
    if (intercepting) await client.send("Fetch.disable", {}, page.sessionId).catch(() => {});
    intercepting = false;
  };
  const timesShown = (text) => page.evaluate(`(document.body.innerText || "").split(${JSON.stringify(text)}).length - 1`);
  // Chrome's emulated offline mode. Switching it off returns once the page can reach the test
  // server again, so a Retry right after isn't sent into a network that is still coming back.
  const setOffline = async (offline) => {
    await client.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, page.sessionId);
    if (offline) return;
    await page.waitFor(`fetch(${JSON.stringify(server.baseUrl + "/api/health")}).then((r) => r.ok).catch(() => false)`, NAV_TIMEOUT, "the network back");
  };
  // The other member, through the API with their own session token
  const api = async (method, route, body) => {
    const headers = { Authorization: `Bearer ${state.tokenB}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const rowCount = async (body) => (await connection.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND body = ?", [state.conversation, body]))[0][0].n;
  // The screen updates before the server commits: wait for the row to catch up
  const waitForRows = async (body, expected) => {
    const deadline = Date.now() + 10000;
    let n = null;
    while (Date.now() < deadline) {
      n = await rowCount(body);
      if (n === expected) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(n, expected, `rows with body "${body}"`);
  };
  const unreadForA = async () => (await connection.query(
    "SELECT COUNT(*) AS n FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = ? WHERE m.conversation_id = ? AND m.sender_id <> ? AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)",
    [identities.a.id, state.conversation, identities.a.id],
  ))[0][0].n;
  // The inverted list is flipped with a transform, so its oldest messages sit at the
  // scroll container's far end: scroll there until the screen asks for the older page
  const scrollToNewest = () => page.evaluate(`(() => {
    const els = [...document.querySelectorAll("body *")].filter((e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    for (const el of els) el.scrollTop = 0;
    return els.length;
  })()`);
  const scrollToOldest = () => page.evaluate(`(() => {
    const els = [...document.querySelectorAll("body *")].filter((e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    for (const el of els) { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll", { bubbles: true })); }
    return els.length;
  })()`);

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
    try {
      identities.a = await testAccounts.createIdentity(runId, "a");
      identities.b = await testAccounts.createIdentity(runId, "b");
      const minted = await testAccounts.mintToken(identities.b.id);
      state.tokenB = minted.jwt;
      state.sessionB = minted.sessionId;
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await testAccounts.setProfileComplete(identities.a.id, true);
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities[tag].id, identities[tag].emailAddress, { a: "Priya Sharma", b: "Rohan Mehta" }[tag]]);
    }
    await db.befriend(connection, identities.a.id, identities.b.id); // messaging is for friends
    // Rohan opens the conversation and sends more than one page before Priya looks
    const open = await api("POST", "/api/community/conversations", { userId: identities.a.id });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    state.conversation = open.json.conversation.id;
    for (let i = 1; i <= SEEDED; i++) {
      const sent = await api("POST", `/api/community/conversations/${state.conversation}/messages`, { body: `Message ${i}` });
      assert.equal(sent.status, 201, JSON.stringify(sent.json));
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
      for (const table of COMMUNITY_TABLES) await connection.query("DELETE FROM `" + table + "`");
      await db.deleteUsers(connection, Object.values(identities).map((i) => i.id));
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      if (state.sessionB) await testAccounts.revokeSession(state.sessionB).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the inbox lists the conversation with the unread count and the last message", run("inbox", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    // A cold load of /messages is routed to home like any deep link; go the way a member does
    await clickTab("Community");
    await h.expectPath("/community");
    await clickLabel(`Messages, ${SEEDED} unread`); // the chat icon carries the unread count
    await h.expectPath("/messages");
    await h.expectText("Rohan Mehta");
    await h.expectText(`Message ${SEEDED}`);
    await page.waitFor(`!!document.querySelector('[aria-label="Conversation with Rohan Mehta, ${SEEDED} unread"]')`, NAV_TIMEOUT, "the unread badge");
    assert.equal(await unreadForA(), SEEDED, "nothing is read yet");
    await snapshotAllWidths("messages-inbox");
  }));

  it("2. opening the conversation loads the newest page, marks it read, and fetches the older page with a cursor", run("conversation", async () => {
    // What the screen asks the server for, so paging is checked by its requests rather
    // than by how far the list happens to have rendered (it renders in batches)
    const firstRequest = page.requests.length;
    const messageRequests = () => page.requests.slice(firstRequest).filter((url) => url.includes(`/conversations/${state.conversation}/messages`)).map((url) => new URL(url));
    await clickLabel(`Conversation with Rohan Mehta, ${SEEDED} unread`);
    await page.waitFor(`location.pathname.startsWith("/messages/")`, NAV_TIMEOUT, "the conversation screen");
    await h.expectText(`Message ${SEEDED}`);
    const opening = messageRequests()[0];
    assert.ok(opening, "the screen asked for the messages");
    assert.equal(opening.searchParams.get("cursor"), null, "the first request is the newest page");
    assert.equal(opening.searchParams.get("limit"), "30", "30 messages per page, so 35 messages need two pages");
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (await unreadForA()) !== 0) await new Promise((r) => setTimeout(r, 250));
    assert.equal(await unreadForA(), 0, "opening the conversation marks it read");
    await snapshotAllWidths("messages-conversation");

    // Scroll to the oldest end until the older page has arrived and is rendered
    const lines = `(document.body.innerText || "").split("\\n")`;
    for (let attempt = 0; attempt < 20 && !(await page.evaluate(`${lines}.includes("Message 1")`)); attempt++) {
      assert.ok((await scrollToOldest()) > 0, "there is a scrollable list");
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(await page.evaluate(`${lines}.includes("Message 1")`), "the oldest message arrived");
    const paged = messageRequests().filter((url) => url.searchParams.get("cursor"));
    assert.ok(paged.length >= 1, "the older page was requested with a cursor");
    assert.ok(paged.every((url) => /^\d+_[0-9a-f-]{36}$/i.test(url.searchParams.get("cursor"))), "the cursor is the server's own");
    const texts = await page.evaluate(`${lines}.filter((t) => /^Message \\d+$/.test(t)).map((t) => Number(t.slice(8)))`);
    assert.equal(new Set(texts).size, texts.length, "no message is shown twice");
    assert.equal(texts.length, SEEDED, "every message is on screen once");
  }));

  it("3. a reply is sent, appears in the conversation and is stored once", run("reply", async () => {
    await page.setInput('textarea[placeholder="Message"]', "Thanks Rohan, see you at 6!");
    await clickLabel("Send message");
    await h.expectText("Thanks Rohan, see you at 6!");
    await waitForRows("Thanks Rohan, see you at 6!", 1);
    await h.expectNoText("Sending…");
    const [[row]] = await connection.query("SELECT sender_id FROM messages WHERE conversation_id = ? AND body = ?", [state.conversation, "Thanks Rohan, see you at 6!"]);
    assert.equal(row.sender_id, identities.a.id, "the sender is the signed-in member");
    assert.equal(await page.evaluate(`document.querySelector('textarea[placeholder="Message"]').value`), "", "the box is cleared");
  }));

  it("4. a message from the other member appears without a reload", run("poll", async () => {
    await page.evaluate(`window.__justfitNoReload = ${JSON.stringify(runId)}`);
    const sent = await api("POST", `/api/community/conversations/${state.conversation}/messages`, { body: "Are you bringing the resistance bands?" });
    assert.equal(sent.status, 201);
    await page.waitFor(`(document.body.innerText || "").includes("Are you bringing the resistance bands?")`, POLL_WAIT, "the new message, by polling");
    assert.equal(await page.evaluate("window.__justfitNoReload"), runId, "the page did not reload");
    assert.equal(await unreadForA(), 0, "a message that arrived while the chat is open counts as read");
  }));

  it("5. a send that can't reach the server stays on screen and is retried without a duplicate", run("retry", async () => {
    await setOffline(true);
    try {
      await page.setInput('textarea[placeholder="Message"]', "Sent after a retry");
      await clickLabel("Send message");
      await h.expectText("Not sent");
      await page.waitFor(`!!document.querySelector('[aria-label="Retry sending"]')`, NAV_TIMEOUT, "the Retry action");
      await h.expectText("Sent after a retry");
      assert.equal(await rowCount("Sent after a retry"), 0, "nothing reached the server");
      await scrollToNewest(); // the failed send sits at the bottom, under the older page loaded earlier
      await snapshotAllWidths("messages-not-sent");
    } finally {
      await setOffline(false);
    }
    await clickLabel("Retry sending");
    await h.expectNoText("Not sent");
    await waitForRows("Sent after a retry", 1);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await rowCount("Sent after a retry"), 1, "still one copy after the retry settled");
    assert.equal(await page.evaluate(`(document.body.innerText || "").split("Sent after a retry").length - 1`), 1, "shown once");
  }));

  it("5b. a send whose reply is lost is stored once; Retry or the next poll settles it without a duplicate", run("lost-reply", async () => {
    try {
      // The server stores the message but the reply never arrives; polls fail too, so the
      // bubble stays "Not sent" until Retry
      await dropReplies("post+gets");
      await page.setInput('textarea[placeholder="Message"]', "Reply lost, then retried");
      await clickLabel("Send message");
      await h.expectText("Not sent");
      await waitForRows("Reply lost, then retried", 1);
      await dropReplies("gets");
      await clickLabel("Retry sending");
      await h.expectNoText("Not sent");
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(await rowCount("Reply lost, then retried"), 1, "the retry returned the stored message instead of a second one");
      assert.equal(await timesShown("Reply lost, then retried"), 1, "shown once after the retry");

      // Lost again, and this time the member doesn't retry: the next poll brings the stored
      // message and the "Not sent" copy goes away
      await dropReplies("post+gets");
      await page.setInput('textarea[placeholder="Message"]', "Reply lost, then polled");
      await clickLabel("Send message");
      await h.expectText("Not sent");
      await waitForRows("Reply lost, then polled", 1);
      await stopDroppingReplies();
      await h.expectNoText("Not sent");
      assert.equal(await timesShown("Reply lost, then polled"), 1, "the polled message replaces the unconfirmed copy");
      assert.equal(await rowCount("Reply lost, then polled"), 1);
    } finally {
      await stopDroppingReplies();
    }
  }));

  it("6a. offline when blocking: the block sheet closes with an error and nothing is blocked", run("block-offline", async () => {
    // The block request never reaches the server (offline): the sheet must not spin forever
    const patched = await page.evaluate(`(() => { if (window.__justfitFetch) return false; window.__justfitFetch = window.fetch; window.fetch = (input, init) => { const url = typeof input === "string" ? input : input.url; return /\\/block$/.test(url) ? Promise.reject(new TypeError("Failed to fetch")) : window.__justfitFetch(input, init); }; return true; })()`);
    assert.equal(patched, true, "the page's fetch is patched for the block request only");
    try {
      await clickLabel("Conversation options");
      await page.clickText("Block Rohan Mehta");
      await h.expectText("Block Rohan Mehta?");
      await clickLabel("Confirm block");
      await h.expectNoText("Block Rohan Mehta?");
      await h.expectText("Couldn't reach the server");
      assert.ok((await page.path()).startsWith("/messages/"), "still in the conversation");
      const [[block]] = await connection.query("SELECT COUNT(*) AS n FROM community_blocks WHERE blocker_id = ? AND blocked_id = ?", [identities.a.id, identities.b.id]);
      assert.equal(block.n, 0, "nothing was blocked");
    } finally {
      await page.evaluate(`(() => { if (window.__justfitFetch) { window.fetch = window.__justfitFetch; delete window.__justfitFetch; } })()`);
    }
  }));

  it("6. Block from the conversation menu hides the conversation", run("block", async () => {
    // The menu is usable again after the failed attempt above
    await clickLabel("Conversation options");
    await page.clickText("Block Rohan Mehta");
    await h.expectText("Block Rohan Mehta?");
    await snapshot("messages-block-confirm-390");
    await clickLabel("Confirm block");
    await h.expectPath("/messages");
    await h.expectText("No messages yet");
    const [[block]] = await connection.query("SELECT COUNT(*) AS n FROM community_blocks WHERE blocker_id = ? AND blocked_id = ?", [identities.a.id, identities.b.id]);
    assert.equal(block.n, 1, "the block is stored");
    assert.equal((await api("POST", `/api/community/conversations/${state.conversation}/messages`, { body: "still there?" })).status, 403, "the blocked member can't write");
  }));
});
