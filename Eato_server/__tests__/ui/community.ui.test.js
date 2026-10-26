// The Community tab in the real Expo web build against the isolated test server and the
// eato_test database, as a signed-in member whose profile is complete. Covers: the Feed,
// Friends and Gyms tabs (no Leagues, and Groups were removed), the empty feed, creating a post
// with a photo (preview, then publish), editing it, liking, commenting, opening messages,
// deleting a post behind a confirmation, the private-account audience rule, moderation,
// and screenshots at three widths.
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
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_reports", "community_story_views", "community_stories",
  "community_comments", "community_post_likes", "community_post_media", "community_posts", "community_media", "community_profiles"];
// A 1×1 PNG, written to a file so the browser's file chooser can hand it to the picker
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("ui community: feed, stories and messages for a signed-in member", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h, uploadDir, photoFile;
  const identities = {};

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
    if (!SCREENSHOT_DIR) return;
    for (const [w, hgt] of WIDTHS) { await viewport(w, hgt); await snapshot(`${name}-${w}`); }
    await viewport(390, 844);
  };
  // The tab bar is at the bottom: click the lowest leaf element with this text
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  // Clicks the nth rendered element with this accessible name (-1 = the last one)
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  // Likes update the screen before the server answers: wait for the row to catch up
  const waitForLikeCount = async (expected) => {
    const deadline = Date.now() + 10000;
    let count = null;
    while (Date.now() < deadline) {
      const [[row]] = await connection.query("SELECT like_count FROM community_posts WHERE user_id = ?", [identities.b.id]);
      count = row.like_count;
      if (count === expected) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(count, expected, "like_count on the server");
  };
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  // The gallery button opens the browser's file chooser; Chrome is told to hand it `file`
  const choosePhotoFromGallery = async (file) => {
    await client.send("DOM.enable", {}, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true }, page.sessionId);
    const opened = new Promise((resolve) => client.on((msg) => { if (msg.sessionId === page.sessionId && msg.method === "Page.fileChooserOpened") resolve(msg.params); }));
    // Create Post opens a sheet from its Add tile; the story screen has the gallery button itself
    const hasAddTile = await page.evaluate(`[...document.querySelectorAll('[aria-label="Add photos"]')].some((e) => e.getClientRects().length > 0)`);
    if (hasAddTile) {
      await clickLabel("Add photos");
      await page.clickText("Choose from gallery");
    } else {
      await clickLabel("Choose from gallery");
    }
    const chooser = await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error("the file chooser did not open")), NAV_TIMEOUT))]);
    await client.send("DOM.setFileInputFiles", { files: [file], backendNodeId: chooser.backendNodeId }, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false }, page.sessionId);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-ui-uploads-"));
    photoFile = path.join(os.tmpdir(), `justfit-ui-photo-${runId}.png`);
    fs.writeFileSync(photoFile, TINY_PNG);
    server = await startTestServer({ ...env, UPLOAD_DIR: uploadDir });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await clerk.createIdentity(runId, "a", { withPassword: true });
      identities.b = await clerk.createIdentity(runId, "b");
      identities.admin = await clerk.createIdentity(runId, "admin", { withPassword: true, role: "admin" });
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    // A finished profile (the account flag) and a name, as setup would have saved them
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    for (const tag of ["a", "b", "admin"]) {
      const name = { a: "Priya Sharma", b: "Rohan Mehta", admin: "Admin Tester" }[tag];
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, name, tag === "admin" ? "admin" : "user"]);
    }
    // One post from another member, so the feed has something to like and comment on
    await connection.query("INSERT INTO community_posts (id, user_id, category, body) VALUES (UUID(), ?, 'achievement', 'Hit a 140 kg deadlift PR this morning. Consistency pays.')", [identities.b.id]);
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
    await step("identities", async () => { if (clerk) for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id); });
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
    if (photoFile) fs.rmSync(photoFile, { force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. Community opens from the tab bar with Feed, Friends, Trainers and Gyms (no Leagues, no Groups, no Challenges)", run("open", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await h.expectText("Today's Macros");
    await clickTab("Community");
    await h.expectPath("/community");
    await h.expectText("TRAIN TOGETHER");
    await h.expectText("Feed");
    await h.expectText("Friends");
    await h.expectText("Trainers");
    await h.expectText("Gyms");
    assert.equal(await page.hasText("Groups"), false, "the Groups tab was removed");
    assert.equal(await page.hasText("Challenges"), false, "Challenges were dropped");
    assert.equal(await page.hasText("Leagues"), false, "there is no Leagues tab");
    assert.equal(await page.hasText("Leaderboard"), false);
    await h.expectText("Your story");
    // The quick post: a caption field (its placeholder isn't page text) and a Post button that waits for text
    await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Share your progress"]'); return !!el && el.placeholder === "Share your progress..."; })()`, NAV_TIMEOUT, "quick post caption");
    await page.waitFor(`document.querySelector('[aria-label="Post"]')?.getAttribute("aria-disabled") === "true"`, NAV_TIMEOUT, "Post disabled while empty");
    await h.expectText("Rohan Mehta");
    await h.expectText("Consistency pays.");
    await noOverflow("community feed");
    await snapshotAllWidths("community-feed");
  }));

  it("2. liking a post updates the count and persists on the server", run("like", async () => {
    await clickLabel("Like");
    await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Unlike"]'); return !!el; })()`, NAV_TIMEOUT, "liked state");
    await waitForLikeCount(1);
    await clickLabel("Unlike");
    await page.waitFor(`!!document.querySelector('[aria-label="Like"]')`, NAV_TIMEOUT, "unliked state");
    await waitForLikeCount(0);
  }));

  it("3. Create Post: a meal with its details, a photo, a location and an audience is published once, at the top of the feed", run("post", async () => {
    await clickLabel("Create post");
    await h.expectPath("/community/compose");
    await h.expectText("Create Post");
    await h.expectText("Posting to");
    await h.expectText("My JustFit feed");
    await h.expectText("Post type");
    await noOverflow("compose");
    await snapshotAllWidths("community-compose");
    // Validation: a photo post needs a photo, a meal needs its name
    await clickLabel("Post");
    await h.expectText("Add at least one photo.");
    await clickLabel("Post type: Meal");
    await h.expectText("Meal name");
    await clickLabel("Post");
    await h.expectText("Add the meal's name.");
    await page.setInput('[aria-label="Meal name"]', "Paneer tikka bowl");
    await page.setInput('[aria-label="Calories"]', "540");
    await page.setInput('[aria-label="Protein"]', "38");
    await page.setInput('[aria-label="Post text"]', "Week one of meal prep done. Four lunches boxed and ready.");
    // Audience: a sheet with the account's choices
    await clickLabel("Audience: Everyone");
    await h.expectText("Who can see this post?");
    await page.clickText("Followers");
    await h.expectText("Members you've accepted as followers");
    await clickLabel("Audience: Followers");
    await page.clickText("Everyone");
    await h.expectText("Anyone on JustFit");
    await clickLabel("Add location");
    await page.setInput('[aria-label="Location"]', "Cult, Indiranagar");
    await choosePhotoFromGallery(photoFile);
    await h.expectText("1/4");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove photo 1"]')`, NAV_TIMEOUT, "photo thumbnail");
    await noOverflow("compose meal");
    await snapshotAllWidths("community-compose-meal");
    await clickLabel("Post");
    await h.expectPath("/community");
    await h.expectText("Four lunches boxed and ready.");
    await h.expectText("Paneer tikka bowl");
    await h.expectText("540 kcal · 38 g protein");
    await h.expectText("Cult, Indiranagar");
    const [posts] = await connection.query("SELECT id, user_id, category, headline, meal_kcal, meal_protein_g, location, media_id, client_key FROM community_posts WHERE user_id = ?", [identities.a.id]);
    assert.equal(posts.length, 1, "published exactly once");
    const row = posts[0];
    assert.deepEqual([row.category, row.headline, row.meal_kcal, row.meal_protein_g, row.location], ["meal", "Paneer tikka bowl", 540, 38, "Cult, Indiranagar"]);
    assert.ok(row.client_key, "the draft's client key was saved");
    assert.ok(row.media_id, "the photo is attached");
    assert.ok(fs.existsSync(path.join(uploadDir, `${row.media_id}.png`)), "the photo's file was written");
    const [[media]] = await connection.query("SELECT user_id FROM community_media WHERE id = ?", [row.media_id]);
    assert.equal(media.user_id, identities.a.id, "uploaded by the signed-in member");
    const [[links]] = await connection.query("SELECT COUNT(*) AS n FROM community_post_media WHERE post_id = ?", [row.id]);
    assert.equal(links.n, 1);
    const order = await page.evaluate(`(() => { const t = document.body.innerText; return t.indexOf("Four lunches") < t.indexOf("Consistency pays"); })()`);
    assert.equal(order, true, "the newest post is first");
    await snapshotAllWidths("community-feed-with-post");
  }));

  it("3b. the author edits the post: the caption changes; the type, details and photo stay", run("edit", async () => {
    await clickLabel("Post options", 0); // the member's own post is first
    await page.clickText("Edit post");
    await h.expectPath("/community/compose");
    await h.expectText("Edit Post");
    await h.expectText("Post type: Meal");
    await h.expectText("1/4"); // the saved photo is listed
    await page.setInput('[aria-label="Post text"]', "Week one of meal prep done. Five lunches boxed and ready.");
    await snapshot("community-edit-390");
    await clickLabel("Save changes");
    await h.expectPath("/community");
    await h.expectText("Five lunches boxed and ready.");
    const [[row]] = await connection.query("SELECT body, category, headline, meal_kcal, media_id FROM community_posts WHERE user_id = ?", [identities.a.id]);
    assert.match(row.body, /Five lunches/);
    assert.deepEqual([row.category, row.headline, row.meal_kcal], ["meal", "Paneer tikka bowl", 540]);
    assert.ok(row.media_id, "the photo stayed on the post");
  }));

  it("4. comments open from a post, are saved, and the count follows; the post menu and a long press work there", run("comments", async () => {
    await clickLabel("0 comments");
    await page.waitFor(`location.pathname.startsWith("/community/post/")`, NAV_TIMEOUT, "comments screen");
    await h.expectText("Comments (0)");
    // The comment icon on the post focuses the comment box
    await clickLabel("0 comments", -1);
    await page.waitFor(`document.activeElement?.getAttribute("aria-label") === "Add a comment"`, NAV_TIMEOUT, "comment box focused");
    // The post's ⋯ works here too: the author's own post offers Edit and Delete
    await clickLabel("Post options", -1);
    await h.expectText("Edit post");
    await h.expectText("Delete post");
    await clickLabel("Close");
    await h.expectNoText("Edit post");
    // The reply box occasionally misses the first synthetic input while the screen is still
    // mounting: type until the Send button is enabled (it stays disabled for an empty box)
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.setInput('[aria-label="Add a comment"]', "Huge lift, well done!");
      const enabled = await page.evaluate(`(() => { const el = document.querySelector('[aria-label="Send comment"]'); return !!el && el.getAttribute("aria-disabled") !== "true" && !el.disabled; })()`);
      if (enabled) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await clickLabel("Send comment");
    await h.expectText("Huge lift, well done!");
    await h.expectText("Comments (1)");
    await noOverflow("post detail");
    await snapshotAllWidths("community-post-detail");
    // A long press on the comment opens its options (no ⋯ on the bubble). The bubble is measured
    // fresh on each try: the screenshots above just resized the window, so the layout may still move.
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      const bubble = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label$=": Huge lift, well done!"]')].find((e) => e.getClientRects().length > 0); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "comment bubble");
      await new Promise((r) => setTimeout(r, 300));
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: bubble.x, y: bubble.y }, page.sessionId);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: bubble.x, y: bubble.y, button: "left", clickCount: 1 }, page.sessionId);
      await new Promise((r) => setTimeout(r, 900));
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bubble.x, y: bubble.y, button: "left", clickCount: 1 }, page.sessionId);
      opened = await page.waitFor(`document.body.innerText.includes("Delete comment")`, 3000, "comment options").catch(() => false);
    }
    await h.expectText("Delete comment");
    await snapshot("community-comment-options-390");
    await clickLabel("Close");
    await h.expectNoText("Delete comment");
    // The post that was opened is in the URL (the newest post is first, so it is the member's own)
    const postId = (await page.path()).split("/").pop();
    const [[row]] = await connection.query("SELECT comment_count, user_id FROM community_posts WHERE id = ?", [postId]);
    assert.equal(row.comment_count, 1);
    const [[comment]] = await connection.query("SELECT user_id FROM community_comments WHERE post_id = ?", [postId]);
    assert.equal(comment.user_id, identities.a.id, "the comment's author is the signed-in member");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
    await h.expectText("Feed");
  }));

  it("5b. an author's avatar opens their profile; Follow changes the state and is saved", run("profile", async () => {
    await page.clickText("Feed");
    await clickLabel("Rohan Mehta");
    await page.waitFor(`location.pathname.startsWith("/community/profile/")`, NAV_TIMEOUT, "profile screen");
    await h.expectText("Followers");
    await h.expectText("Consistency pays.");
    await snapshotAllWidths("community-profile");
    await clickLabel("Follow");
    await page.waitFor(`!!document.querySelector('[aria-label="Following"]')`, NAV_TIMEOUT, "following state");
    const [[follow]] = await connection.query("SELECT status FROM community_follows WHERE follower_id = ? AND following_id = ?", [identities.a.id, identities.b.id]);
    assert.equal(follow.status, "accepted");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
    await clickLabel("Notifications");
    await h.expectPath("/community/notifications");
    await h.expectText("You're all caught up");
    await snapshot("community-notifications-390");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
  }));

  it("6. the chat icon opens Messages, which is empty for a new member", run("messages", async () => {
    await clickLabel("Messages");
    await h.expectPath("/messages");
    await h.expectText("No messages yet");
    await snapshot("community-messages-390");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
  }));

  it("6b. reporting a post from its menu records a report", run("report", async () => {
    // The member's own post is first; Rohan's (reportable) post is the last on the feed
    await clickLabel("Post options", -1);
    await h.expectText("Report post");
    await page.clickText("Report post");
    await h.expectText("Thanks, we'll review this post.");
    const [[report]] = await connection.query("SELECT reporter_id, post_id FROM community_reports WHERE status = 'open'");
    assert.equal(report.reporter_id, identities.a.id);
  }));

  it("7. a story: photo, preview, audience and caption; it shows in the row, the viewer and is deleted behind a confirmation", run("story", async () => {
    await page.clickText("Feed");
    await clickLabel("Add a story");
    await h.expectPath("/community/story-new");
    await h.expectText("Add a photo");
    await h.expectText("Who can see this");
    await snapshot("community-story-new-390");
    await choosePhotoFromGallery(photoFile);
    await h.expectText("Choose another"); // the preview is up
    await clickLabel("Audience: Close Friends");
    await h.expectText("Your list is empty, so only you will see this. Add people");
    await clickLabel("Audience: Followers");
    await h.expectText("Members you've accepted as followers");
    await page.setInput('[aria-label="Caption"]', "Morning run done");
    await noOverflow("story-new");
    await snapshotAllWidths("community-story-preview");
    await clickLabel("Share story");
    await h.expectPath("/community");
    const [[row]] = await connection.query("SELECT id, user_id, audience, caption, media_id, deleted_at, expires_at > NOW() AS active FROM community_stories WHERE user_id = ?", [identities.a.id]);
    assert.equal(row.audience, "followers");
    assert.equal(row.caption, "Morning run done");
    assert.equal(row.active, 1);
    assert.ok(fs.existsSync(path.join(uploadDir, `${row.media_id}.png`)), "the photo was stored");
    // Open it: the viewer pauses while the options sheet is open (the clock would move on otherwise)
    await clickLabel("Your story");
    await page.waitFor(`location.pathname.startsWith("/community/story/")`, NAV_TIMEOUT, "story viewer");
    await clickLabel("Story options");
    await h.expectText("Delete story");
    for (const text of ["Morning run done", "Your story", "Followers", "Seen by 0 people"]) assert.ok(await page.hasText(text), `viewer shows "${text}"`);
    await snapshot("community-story-viewer-390");
    await page.clickText("Delete story");
    await h.expectText("Delete this story?");
    await snapshot("community-story-delete-390");
    await clickLabel("Delete");
    await h.expectPath("/community");
    const [[deleted]] = await connection.query("SELECT deleted_at FROM community_stories WHERE id = ?", [row.id]);
    assert.ok(deleted.deleted_at, "soft deleted on the server");
    await page.waitFor(`!!document.querySelector('[aria-label="Add a story"]') && !document.querySelector('[aria-label="Your story"]')`, NAV_TIMEOUT, "the row no longer has the story");
    // Close Friends is reached from the member's own profile; nobody follows this member yet
    await clickLabel("Your community profile");
    await page.waitFor(`location.pathname.startsWith("/community/profile/")`, NAV_TIMEOUT, "own profile");
    await clickLabel("Close Friends");
    await h.expectPath("/community/close-friends");
    await h.expectText("Only you can see this list.");
    await h.expectText("No followers yet");
    await snapshot("community-close-friends-390");
    await page.evaluate("history.back()");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
  }));

  it("7a. stories: Retry and double taps never post twice, several stories play in order, rings on the row and the profile, privacy", run("stories-multi", async () => {
    // Rohan has two public stories (older first); their photos exist so the viewer can load them
    const seedStory = async (userId, caption, audience, minutesAgo) => {
      const [[{ id: mediaId }]] = await connection.query("SELECT UUID() AS id");
      fs.writeFileSync(path.join(uploadDir, `${mediaId}.png`), TINY_PNG);
      await connection.query("INSERT INTO community_media (id, user_id, media_type, byte_size) VALUES (?, ?, 'image/png', ?)", [mediaId, userId, TINY_PNG.length]);
      await connection.query("INSERT INTO community_stories (id, user_id, media_id, caption, audience, created_at, expires_at) VALUES (UUID(), ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE), DATE_ADD(NOW(), INTERVAL 20 HOUR))", [userId, mediaId, caption, audience, minutesAgo]);
    };
    await seedStory(identities.b.id, "Rohan one", "public", 30);
    await seedStory(identities.b.id, "Rohan two", "public", 20);
    const myStories = async () => (await connection.query("SELECT caption FROM community_stories WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, caption", [identities.a.id]))[0].map((r) => r.caption);
    const myMedia = async () => (await connection.query("SELECT COUNT(*) AS n FROM community_media WHERE user_id = ?", [identities.a.id]))[0][0].n;
    // The ring inside the visible element with this label (labels may contain apostrophes, so the selector is JSON-quoted)
    const ringIn = (label) => page.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].find((e) => e.getClientRects().length > 0); const ring = el && el.querySelector('[data-testid^="story-ring-"]'); return ring ? ring.getAttribute("data-testid") : null; })()`);
    // Pauses matching API calls in the browser so a test can drop or answer them itself
    const intercept = async (urlPattern, stage, handle) => {
      await client.send("Fetch.enable", { patterns: [{ urlPattern, requestStage: stage }] }, page.sessionId);
      // The CDP client can't remove a listener, so a stopped one must ignore every later
      // paused request: only the current intercept may continue or answer it
      let active = true;
      const listener = async (msg) => {
        if (!active || msg.sessionId !== page.sessionId || msg.method !== "Fetch.requestPaused") return;
        const { requestId, request } = msg.params;
        if (request.method === "POST" && !listener.done) { listener.done = true; await handle(requestId); return; }
        await client.send(stage === "Response" ? "Fetch.continueResponse" : "Fetch.continueRequest", { requestId }, page.sessionId).catch(() => {});
      };
      client.on(listener);
      return async () => { active = false; await client.send("Fetch.disable", {}, page.sessionId); };
    };
    const newStoryWithPhoto = async (caption) => {
      await clickLabel("Add a story");
      await h.expectPath("/community/story-new");
      await choosePhotoFromGallery(photoFile);
      await h.expectText("Choose another");
      await page.setInput('[aria-label="Caption"]', caption);
    };

    // 1. The server saves the story but the answer never arrives: the draft stays, Retry posts it once
    await newStoryWithPhoto("Story one");
    const stopDropping = await intercept("*/api/community/stories", "Response", (requestId) => client.send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }, page.sessionId));
    await clickLabel("Share story");
    await h.expectText("Couldn't reach the server");
    await stopDropping();
    await page.waitFor(`!!document.querySelector('[aria-label="Retry"]')`, NAV_TIMEOUT, "the button offers Retry");
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Caption"]').value`), "Story one", "the caption is kept");
    await h.expectText("Choose another"); // and the photo
    assert.deepEqual(await myStories(), ["Story one"], "saved once on the server before the Retry");
    await snapshot("community-story-retry-390");
    await clickLabel("Retry");
    await h.expectPath("/community");
    assert.deepEqual(await myStories(), ["Story one"], "the Retry returned the same story instead of a second one");
    assert.equal(await ringIn("Your story"), "story-ring-unseen", "your photo is ringed while your story is up");

    // 2. A second story while the first is still up, with a double tap on Share
    const mediaBefore = await myMedia();
    await newStoryWithPhoto("Story two");
    const share = await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Share story"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "Share story");
    await Promise.all([page.clickAt(share.x, share.y), page.clickAt(share.x, share.y)]);
    await h.expectPath("/community");
    assert.deepEqual(await myStories(), ["Story one", "Story two"], "two active stories, no duplicate");
    assert.equal(await myMedia(), mediaBefore + 1, "one upload for the double tap");
    assert.equal(await ringIn("Rohan Mehta's story"), "story-ring-unseen");
    await snapshot("community-stories-row-390");

    // 3. The viewer plays your two stories in order, then Rohan's two, then closes
    await clickLabel("Your story");
    await page.waitFor(`!!document.querySelector('[aria-label="Story 1 of 2"]')`, NAV_TIMEOUT, "own story 1 of 2");
    await h.expectText("Story one");
    await snapshot("community-story-viewer-multi-390");
    await clickLabel("Next story");
    await page.waitFor(`!!document.querySelector('[aria-label="Story 2 of 2"]') && document.body.innerText.includes("Story two")`, NAV_TIMEOUT, "own story 2 of 2");
    await clickLabel("Next story");
    await page.waitFor(`!!document.querySelector('[aria-label="Story 1 of 2"]') && document.body.innerText.includes("Rohan one")`, NAV_TIMEOUT, "Rohan's first story");
    await clickLabel("Next story");
    await page.waitFor(`!!document.querySelector('[aria-label="Story 2 of 2"]') && document.body.innerText.includes("Rohan two")`, NAV_TIMEOUT, "Rohan's second story");
    await clickLabel("Next story");
    await h.expectPath("/community");
    const [[{ n: views }]] = await connection.query("SELECT COUNT(*) AS n FROM community_story_views v JOIN community_stories s ON s.id = v.story_id WHERE v.user_id = ? AND s.user_id = ?", [identities.a.id, identities.b.id]);
    assert.equal(views, 2, "both of Rohan's stories recorded as seen");
    await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Rohan Mehta\\'s story"]'); const ring = el && el.querySelector('[data-testid^="story-ring-"]'); return !!ring && ring.getAttribute("data-testid") === "story-ring-seen"; })()`, NAV_TIMEOUT, "Rohan's ring turns to seen");

    // 4. The profile photo carries the same ring and opens that member's stories
    await h.goto(`/community/profile/${identities.b.id}`, "Rohan Mehta");
    await page.waitFor(`!!document.querySelector('[aria-label="Open Rohan Mehta\\'s story"]')`, NAV_TIMEOUT, "ring on Rohan's profile photo");
    assert.equal(await ringIn("Open Rohan Mehta's story"), "story-ring-seen");
    await snapshot("community-profile-story-ring-390");
    await clickLabel("Open Rohan Mehta's story");
    await page.waitFor(`location.pathname === "/community/story/${identities.b.id}"`, NAV_TIMEOUT, "Rohan's stories open");
    await h.expectText("Rohan one");
    await h.goto(`/community/profile/${identities.a.id}`, "Priya Sharma");
    await page.waitFor(`!!document.querySelector('[aria-label="Open your story"]')`, NAV_TIMEOUT, "ring on your own profile photo");
    assert.equal(await ringIn("Open your story"), "story-ring-unseen");

    // 5. Privacy: with only a Close Friends story Priya isn't allowed to see, there is no ring anywhere
    await connection.query("UPDATE community_stories SET deleted_at = NOW() WHERE user_id = ?", [identities.b.id]);
    await seedStory(identities.b.id, "Rohan close friends only", "close_friends", 5);
    await h.goto(`/community/profile/${identities.b.id}`, "Rohan Mehta");
    await h.settle();
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Open Rohan Mehta\\'s story"]')`), false, "no ring for a story Priya can't see");
    await h.goto("/community", "Your story");
    await h.settle();
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Rohan Mehta\\'s story"]')`), false, "Rohan left the row");

    // 6. An expired session and a network failure leave the screen usable, never stuck
    await newStoryWithPhoto("Story three");
    let stop = await intercept("*/api/community/media", "Request", (requestId) => client.send("Fetch.fulfillRequest", { requestId, responseCode: 401, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(JSON.stringify({ error: "Please sign in again." })).toString("base64") }, page.sessionId));
    await clickLabel("Share story");
    await h.expectText("Your session has expired. Please sign in again.");
    await page.waitFor(`!!document.querySelector('[aria-label="Sign in again"]') && !!document.querySelector('[aria-label="Retry"]')`, NAV_TIMEOUT, "sign-in offered, Retry still there");
    await snapshot("community-story-session-expired-390");
    await stop();
    stop = await intercept("*/api/community/media", "Request", (requestId) => client.send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" }, page.sessionId));
    await clickLabel("Retry");
    await h.expectText("Your photo couldn't be uploaded: Couldn't reach the server.");
    await h.expectNoText("Your session has expired.");
    await stop();
    await clickLabel("Retry");
    await h.expectPath("/community");
    assert.deepEqual(await myStories(), ["Story one", "Story two", "Story three"]);

    // Back to the state the later tests expect: no stories
    await connection.query("UPDATE community_stories SET deleted_at = NOW() WHERE user_id IN (?, ?)", [identities.a.id, identities.b.id]);
    await h.goto("/community", "Your story");
    await page.waitFor(`!!document.querySelector('[aria-label="Add a story"]') && !document.querySelector('[aria-label="Your story"]')`, NAV_TIMEOUT, "the row has no stories again");
  }));

  it("7b. deleting a post asks first: Cancel keeps it, Delete removes it for everyone", run("delete", async () => {
    await clickLabel("Post options", 0);
    await page.clickText("Delete post");
    await h.expectText("Delete this post?");
    await snapshot("community-delete-confirm-390");
    await clickLabel("Keep post");
    await h.expectNoText("Delete this post?");
    await h.expectText("Five lunches boxed and ready.");
    await clickLabel("Post options", 0);
    await page.clickText("Delete post");
    await h.expectText("Delete this post?");
    await clickLabel("Delete");
    await h.expectNoText("Five lunches boxed and ready.");
    const [[row]] = await connection.query("SELECT deleted_at FROM community_posts WHERE user_id = ? AND body LIKE 'Week one%'", [identities.a.id]);
    assert.ok(row.deleted_at, "soft deleted on the server");
  }));

  it("7c. a private account can't address everyone: the compose screen offers Followers and Only me", run("private-audience", async () => {
    await connection.query("INSERT INTO community_profiles (user_id, is_private) VALUES (?, TRUE) ON DUPLICATE KEY UPDATE is_private = TRUE", [identities.a.id]);
    await clickLabel("Create post");
    await h.expectPath("/community/compose");
    await h.expectText("Your account is private, so posts can't be shared with everyone.");
    await h.expectText("Audience: Followers");
    // Only rendered elements count: the feed's quick post stays mounted (hidden) under this screen
    const shown = (label) => `[...document.querySelectorAll('[aria-label="${label}"]')].some((e) => e.getClientRects().length > 0)`;
    await page.waitFor(`!${shown("Audience: Everyone")} && ${shown("Audience: Followers")}`, NAV_TIMEOUT, "the audience row is on Followers");
    // The audience menu offers Followers and Only me, never Everyone
    await clickLabel("Audience: Followers");
    await h.expectText("Who can see this post?");
    await h.expectText("Only me");
    await page.waitFor(`![...document.querySelectorAll("body *")].some((e) => e.childElementCount === 0 && e.textContent.trim() === "Everyone" && e.getClientRects().length > 0)`, NAV_TIMEOUT, "no Everyone option");
    await snapshot("community-compose-private-390");
    await clickLabel("Close");
    await h.expectNoText("Who can see this post?");
    await clickLabel("Back");
    await h.expectPath("/community");
    await connection.query("UPDATE community_profiles SET is_private = FALSE WHERE user_id = ?", [identities.a.id]);
  }));

  it("7d. the quick post publishes in place with its audience, and the Trainers tab opens", run("quick-post", async () => {
    const text = "Quick post from the feed: 10k steps before breakfast.";
    // 7c made the account public again after the feed was shown: leave and come back so the
    // quick post re-reads the account (it checks each time the tab is focused)
    await clickTab("Home");
    await clickTab("Community");
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Share your progress"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "quick post shown");
    await page.setInput('[aria-label="Share your progress"]', text);
    await page.waitFor(`document.querySelector('[aria-label="Post"]')?.getAttribute("aria-disabled") !== "true"`, NAV_TIMEOUT, "Post enabled with text");
    // The audience menu: 7c's private account may have left it on Followers (a choice is kept),
    // so start from whatever it shows, switch to Everyone, then to Followers
    const current = await page.evaluate(`[...document.querySelectorAll('[aria-label^="Audience: "]')].find((e) => e.getClientRects().length > 0)?.getAttribute("aria-label") ?? null`);
    assert.ok(current, "the quick post shows its audience");
    await clickLabel(current);
    await h.expectText("Who can see this post?");
    await page.clickText("Everyone");
    await clickLabel("Audience: Everyone");
    await h.expectText("Who can see this post?");
    await snapshot("community-quick-post-audience-390");
    await page.clickText("Followers");
    await page.waitFor(`!!document.querySelector('[aria-label="Audience: Followers"]')`, NAV_TIMEOUT, "audience is Followers");
    await clickLabel("Post");
    await h.expectText(text);
    await page.waitFor(`document.querySelector('[aria-label="Share your progress"]')?.value === ""`, NAV_TIMEOUT, "caption cleared after posting");
    const [rows] = await connection.query("SELECT audience, category, gym_id, deleted_at FROM community_posts WHERE user_id = ? AND body = ?", [identities.a.id, text]);
    assert.equal(rows.length, 1, "published exactly once");
    assert.deepEqual({ ...rows[0] }, { audience: "followers", category: "general", gym_id: null, deleted_at: null });
    await snapshot("community-quick-post-published-390");

    // A private account: the menu offers Followers and Only me, never Everyone
    await connection.query("INSERT INTO community_profiles (user_id, is_private) VALUES (?, TRUE) ON DUPLICATE KEY UPDATE is_private = TRUE", [identities.a.id]);
    try {
      await page.clickText("Friends");
      await page.clickText("Feed");
      await clickTab("Home");
      await clickTab("Community");
      await clickLabel("Audience: Followers");
      await h.expectText("Who can see this post?");
      await h.expectText("Only me");
      await page.waitFor(`![...document.querySelectorAll("body *")].some((e) => e.childElementCount === 0 && e.textContent.trim() === "Everyone" && e.getClientRects().length > 0)`, NAV_TIMEOUT, "no Everyone option");
      await page.clickText("Only me");
      await page.waitFor(`!!document.querySelector('[aria-label="Audience: Only me"]')`, NAV_TIMEOUT, "audience is Only me");
    } finally {
      await connection.query("UPDATE community_profiles SET is_private = FALSE WHERE user_id = ?", [identities.a.id]);
    }

    await page.clickText("Trainers");
    await h.expectText("My Trainer");
    await h.expectText("Find Trainers");
    await noOverflow("community trainers");
    await snapshotAllWidths("community-trainers");
    await page.clickText("Feed");
    await h.expectText(text);
  }));

  it("7e. Create Post: a progress post tagging a friend, and a poll the member votes on from the feed", run("post-types", async () => {
    // Rohan becomes a's friend for this test only (tags are for accepted friends)
    const [low, high] = [identities.a.id, identities.b.id].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
    await connection.query("INSERT INTO community_friendships (user_low, user_high, requester_id, status) VALUES (?, ?, ?, 'accepted')", [low, high, identities.a.id]);
    try {
      await clickLabel("Create post");
      await h.expectPath("/community/compose");
      await clickLabel("Post type: Progress");
      await page.setInput('[aria-label="Title"]', "Week 12 check-in");
      await page.setInput('[aria-label="Milestone"]', "-6 kg");
      await page.setInput('[aria-label="Date"]', "2026-10-01");
      await page.setInput('[aria-label="Post text"]', "Twelve weeks into my cut.");
      await clickLabel("Tag people");
      await h.expectText("Tag people");
      await clickLabel("Tag Rohan Mehta");
      await clickLabel("Done tagging");
      await h.expectText("with Rohan Mehta");
      await snapshotAllWidths("community-compose-progress");
      await clickLabel("Post");
      await h.expectPath("/community");
      await h.expectText("Week 12 check-in");
      await h.expectText("PROGRESS UPDATE"); // the box's kicker (innerText follows the uppercase style)
      const [[progress]] = await connection.query("SELECT id, headline, detail, DATE_FORMAT(detail_date, '%Y-%m-%d') AS d FROM community_posts WHERE user_id = ? AND category = 'progress'", [identities.a.id]);
      assert.deepEqual([progress.headline, progress.detail, progress.d], ["Week 12 check-in", "-6 kg", "2026-10-01"]);
      const [tags] = await connection.query("SELECT user_id FROM community_post_tags WHERE post_id = ?", [progress.id]);
      assert.deepEqual(tags.map((t) => t.user_id), [identities.b.id]);

      // A poll: two options are required, a third is added, then a vote from the feed
      await clickLabel("Create post");
      await h.expectPath("/community/compose");
      await clickLabel("Post type: Poll");
      await page.setInput('[aria-label="Post text"]', "Best leg day finisher?");
      await clickLabel("Post");
      await h.expectText("Fill in every poll option, or remove the empty ones.");
      await page.setInput('[aria-label="Option 1"]', "Walking lunges");
      await page.setInput('[aria-label="Option 2"]', "Wall sit");
      await clickLabel("Add option");
      await page.setInput('[aria-label="Option 3"]', "Sled push");
      await snapshotAllWidths("community-compose-poll");
      await clickLabel("Post");
      await h.expectPath("/community");
      await h.expectText("Best leg day finisher?");
      await clickLabel("Sled push, 0%");
      await page.waitFor(`!!document.querySelector('[aria-label="Sled push, 100%, your vote"]')`, NAV_TIMEOUT, "the vote is shown");
      await h.expectText("1 vote");
      await snapshotAllWidths("community-feed-poll");
      const [[poll]] = await connection.query("SELECT id FROM community_posts WHERE user_id = ? AND category = 'poll'", [identities.a.id]);
      const [votes] = await connection.query("SELECT o.label FROM community_poll_votes v JOIN community_poll_options o ON o.id = v.option_id WHERE v.post_id = ? AND v.user_id = ?", [poll.id, identities.a.id]);
      assert.deepEqual(votes.map((v) => v.label), ["Sled push"]);
    } finally {
      await connection.query("DELETE FROM community_friendships WHERE user_low = ? AND user_high = ?", [low, high]);
    }
  }));

  it("8. an admin reviews the report on the Reports tab, suspends and reinstates the author, then removes the post", run("moderation", async () => {
    await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`);
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "member signed out");
    // The shared helper waits for a member's routes; an admin lands on /admin
    try { await signInAs(page, h, identities.admin); } catch (error) { if (!/route after|sign-in outcome/.test(error.message)) throw error; }
    await page.waitFor(`location.pathname === "/admin"`, 30000, "admin overview");
    await h.expectText("Overview");
    // The Reports tab (badged with the open report groups) holds the queue, grouped by post
    const tab = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[role="tab"][aria-label^="Reports"]')].filter((e) => e.getClientRects().length > 0)[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, 30000, "the Reports tab");
    await page.clickAt(tab.x, tab.y);
    await h.expectPath("/admin/reports");
    await h.expectText("Open (1)");
    await h.expectText("Consistency pays.");
    await h.expectText("1 report: Reported from the feed");
    await snapshot("admin-moderation-390");
    const status = async () => (await connection.query("SELECT status FROM community_profiles WHERE user_id = ?", [identities.b.id]))[0][0]?.status;
    const poll = async (check, what) => {
      const deadline = Date.now() + 15000;
      while (!(await check()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert.ok(await check(), what);
    };
    await clickLabel("Suspend Rohan Mehta");
    await h.expectText("Suspend Rohan Mehta?");
    await clickLabel("Suspend");
    await poll(async () => (await status()) === "suspended", "the author is suspended");
    await h.expectText("Rohan is suspended · Reinstate");
    await clickLabel("Reinstate Rohan Mehta");
    await poll(async () => (await status()) === "active", "the author is reinstated");
    await clickLabel("Remove Rohan Mehta's post");
    await h.expectText("Remove this post?");
    await clickLabel("Remove"); // the sheet's button (the card's is labelled with the author)
    await h.expectText("No open reports");
    const [[reviewed]] = await connection.query("SELECT status FROM community_reports LIMIT 1");
    assert.equal(reviewed.status, "reviewed");
    await noOverflow("moderation");
  }));
});
