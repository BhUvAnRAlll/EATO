// The Community tab in the real Expo web build against the isolated test server and the
// eato_test database, as a signed-in member whose profile is complete. Covers: only Feed
// and Groups exist (no Leagues), the empty feed, creating a post with a photo (preview,
// then publish), editing it, liking, commenting, joining a group, opening messages,
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
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_reports", "community_story_views", "community_stories",
  "community_comments", "community_post_likes", "community_post_media", "community_posts", "community_group_members", "community_media", "community_profiles"];
// A 1×1 PNG, written to a file so the browser's file chooser can hand it to the picker
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("ui community: feed, groups and messages for a signed-in member", () => {
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
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
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
    await clickLabel("Choose from gallery");
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
    assert.equal(await db.resetSchema(connection), 35, "schema.sql should create 35 tables in eato_test");
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "eato-ui-uploads-"));
    photoFile = path.join(os.tmpdir(), `eato-ui-photo-${runId}.png`);
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

  it("1. Community opens from the tab bar with Feed and Groups only", run("open", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await h.expectText("Today's Nutrition");
    await clickTab("Community");
    await h.expectPath("/community");
    await h.expectText("TRAIN TOGETHER");
    await h.expectText("Feed");
    await h.expectText("Groups");
    assert.equal(await page.hasText("Leagues"), false, "there is no Leagues tab");
    assert.equal(await page.hasText("Leaderboard"), false);
    await h.expectText("Your story");
    await h.expectText("Share your progress...");
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

  it("3. a new post with a photo is previewed, published once, and appears at the top of the feed", run("post", async () => {
    await page.clickText("Share your progress...");
    await h.expectPath("/community/compose");
    await h.expectText("Create Post");
    await h.expectText("Posting to Everyone"); // the author row (the name shown comes from the Clerk account)
    await h.expectText("Who can see this");
    // Validation: nothing to publish yet
    await clickLabel("Preview");
    await h.expectText("Write a caption before publishing.");
    await page.setInput('[aria-label="Post text"]', "Week one of meal prep done. Four lunches boxed and ready.");
    await page.clickText("Meal");
    await clickLabel("Audience: Followers");
    await h.expectText("Members you've accepted as followers");
    await clickLabel("Audience: Everyone");
    await h.expectText("Anyone on EATO");
    await choosePhotoFromGallery(photoFile);
    await h.expectText("1/4");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove photo 1"]')`, NAV_TIMEOUT, "photo thumbnail");
    await noOverflow("compose");
    await snapshotAllWidths("community-compose");
    await clickLabel("Preview");
    await h.expectText("This is how your post will look.");
    await h.expectText("Visible to: Everyone · Meal · 1 photo");
    await h.expectText("Four lunches boxed and ready.");
    await snapshot("community-preview-390");
    await clickLabel("Publish");
    await h.expectPath("/community");
    await h.expectText("Four lunches boxed and ready.");
    const [posts] = await connection.query("SELECT id, user_id, category, media_id, client_key FROM community_posts WHERE user_id = ?", [identities.a.id]);
    assert.equal(posts.length, 1, "published exactly once");
    const row = posts[0];
    assert.equal(row.category, "meal");
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

  it("3b. the author edits the post: the caption changes and the photo stays", run("edit", async () => {
    await clickLabel("Post options", 0); // the member's own post is first
    await page.clickText("Edit post");
    await h.expectPath("/community/compose");
    await h.expectText("Edit Post");
    await h.expectText("1/4"); // the saved photo is listed
    await page.setInput('[aria-label="Post text"]', "Week one of meal prep done. Five lunches boxed and ready.");
    await snapshot("community-edit-390");
    await clickLabel("Save changes");
    await h.expectPath("/community");
    await h.expectText("Five lunches boxed and ready.");
    const [[row]] = await connection.query("SELECT body, media_id FROM community_posts WHERE user_id = ?", [identities.a.id]);
    assert.match(row.body, /Five lunches/);
    assert.ok(row.media_id, "the photo stayed on the post");
  }));

  it("4. comments open from a post, are saved, and the count follows", run("comments", async () => {
    await clickLabel("0 comments");
    await page.waitFor(`location.pathname.startsWith("/community/post/")`, NAV_TIMEOUT, "comments screen");
    await h.expectText("Comments");
    // The reply box occasionally misses the first synthetic input while the screen is still
    // mounting: type until the Send button is enabled (it stays disabled for an empty box)
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.setInput('[aria-label="Write a comment"]', "Huge lift, well done!");
      const enabled = await page.evaluate(`(() => { const el = document.querySelector('[aria-label="Send comment"]'); return !!el && el.getAttribute("aria-disabled") !== "true" && !el.disabled; })()`);
      if (enabled) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await clickLabel("Send comment");
    await h.expectText("Huge lift, well done!");
    await h.expectText("1 comment");
    await snapshot("community-comments-390");
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

  it("5. groups list the seeded groups, search filters them, and Join updates membership", run("groups", async () => {
    await page.clickText("Groups");
    await h.expectText("Healthy Eating");
    await h.expectText("Meal Prep");
    await noOverflow("groups");
    await snapshotAllWidths("community-groups");
    await page.setInput('[aria-label="Search groups"]', "protein");
    await h.expectText("High-Protein Meals");
    await h.expectNoText("Meal Prep");
    await clickLabel("Join High-Protein Meals");
    await page.waitFor(`!!document.querySelector('[aria-label="Leave High-Protein Meals"]')`, NAV_TIMEOUT, "joined state");
    await h.expectText("1 member");
    const [[membership]] = await connection.query("SELECT COUNT(*) AS n FROM community_group_members WHERE user_id = ?", [identities.a.id]);
    assert.equal(membership.n, 1);
    await page.clickText("High-Protein Meals");
    await page.waitFor(`location.pathname.startsWith("/community/group/")`, NAV_TIMEOUT, "group screen");
    await h.expectText("Start the conversation."); // the member joined a moment ago, so they may post
    await snapshot("community-group-390");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
  }));

  it("5a. a group post is written and then edited from the group screen, and stays off the main feed", run("group-edit", async () => {
    // Still on the Groups tab, filtered to the group joined in step 5
    await page.clickText("High-Protein Meals");
    await page.waitFor(`location.pathname.startsWith("/community/group/")`, NAV_TIMEOUT, "group screen");
    await page.clickText("Post"); // the header button shown to members
    await h.expectPath("/community/compose");
    await h.expectText("Posting in High-Protein Meals");
    await h.expectText("Shared with everyone in the group.");
    await h.expectNoText("Who can see this");
    await page.setInput('[aria-label="Post text"]', "Group check-in: 150 g protein today.");
    await clickLabel("Publish");
    await page.waitFor(`location.pathname.startsWith("/community/group/")`, NAV_TIMEOUT, "back on the group");
    await h.expectText("150 g protein today.");
    await clickLabel("Post options", 0);
    await page.clickText("Edit post");
    await h.expectPath("/community/compose");
    await h.expectText("Edit Post");
    await h.expectText("Shared with everyone in the group.");
    await page.setInput('[aria-label="Post text"]', "Group check-in: 160 g protein today.");
    await snapshot("community-group-edit-390");
    await clickLabel("Save changes");
    await page.waitFor(`location.pathname.startsWith("/community/group/")`, NAV_TIMEOUT, "back on the group after saving");
    await h.expectText("160 g protein today.");
    await h.expectNoText("150 g protein today.");
    const [[row]] = await connection.query("SELECT body, group_id, audience, user_id FROM community_posts WHERE body LIKE 'Group check-in%'");
    const [[group]] = await connection.query("SELECT id FROM community_groups WHERE slug = 'high-protein-meals'");
    assert.match(row.body, /160 g/);
    assert.equal(row.group_id, group.id, "the edit kept the post in its group");
    assert.equal(row.audience, "public");
    assert.equal(row.user_id, identities.a.id);
    await page.evaluate("history.back()");
    await h.expectPath("/community");
    await page.clickText("Feed");
    await h.expectText("Five lunches boxed and ready.");
    await h.expectNoText("160 g protein today."); // group posts live on the group screen only
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

  it("7. a story can be opened for the add flow, and nothing else was written", run("story-screen", async () => {
    await page.clickText("Feed");
    await clickLabel("Add a story");
    await h.expectPath("/community/story-new");
    await h.expectText("Add a photo");
    await snapshot("community-story-new-390");
    await page.evaluate("history.back()");
    await h.expectPath("/community");
    const [[stories]] = await connection.query("SELECT COUNT(*) AS n FROM community_stories");
    assert.equal(stories.n, 0);
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
    const [[groupPost]] = await connection.query("SELECT deleted_at FROM community_posts WHERE user_id = ? AND body LIKE 'Group check-in%'", [identities.a.id]);
    assert.equal(groupPost.deleted_at, null, "the group post is untouched");
  }));

  it("7c. a private account can't address everyone: the compose screen offers Followers and Only me", run("private-audience", async () => {
    await connection.query("INSERT INTO community_profiles (user_id, is_private) VALUES (?, TRUE) ON DUPLICATE KEY UPDATE is_private = TRUE", [identities.a.id]);
    await page.clickText("Share your progress...");
    await h.expectPath("/community/compose");
    await h.expectText("Your account is private, so posts can't be shared with everyone.");
    await h.expectText("Posting to Followers");
    await page.waitFor(`!document.querySelector('[aria-label="Audience: Everyone"]') && !!document.querySelector('[aria-label="Audience: Followers"]')`, NAV_TIMEOUT, "audience chips without Everyone");
    await snapshot("community-compose-private-390");
    await clickLabel("Back");
    await h.expectPath("/community");
    await connection.query("UPDATE community_profiles SET is_private = FALSE WHERE user_id = ?", [identities.a.id]);
  }));

  it("8. an admin reviews the report on the moderation screen, suspends the author and reinstates them", run("moderation", async () => {
    await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`);
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "member signed out");
    // The shared helper waits for a member's routes; an admin lands on /admin
    try { await signInAs(page, h, identities.admin); } catch (error) { if (!/route after|sign-in outcome/.test(error.message)) throw error; }
    await page.waitFor(`location.pathname === "/admin"`, 30000, "admin dashboard");
    await h.expectText("Community moderation");
    await page.clickText("Community moderation");
    await h.expectPath("/admin/moderation");
    await h.expectText("Open reports");
    await h.expectText("Reason: Reported from the feed");
    await h.expectText("Consistency pays.");
    await snapshot("admin-moderation-390");
    await page.clickText("Suspend author");
    await h.expectText("(suspended)");
    await h.expectText("Rohan Mehta");
    await h.expectText("Reinstate");
    const [[row]] = await connection.query("SELECT status FROM community_profiles WHERE user_id = ?", [identities.b.id]);
    assert.equal(row.status, "suspended");
    await page.clickText("Reinstate");
    await h.expectText("Nobody is suspended.");
    await page.clickText("Mark reviewed");
    await h.expectText("No open reports.");
    const [[reviewed]] = await connection.query("SELECT status FROM community_reports LIMIT 1");
    assert.equal(reviewed.status, "reviewed");
    await noOverflow("moderation");
  }));
});
