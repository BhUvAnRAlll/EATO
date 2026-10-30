// Authenticated tests for Community Stories: test accounts in justfit_test against the
// real Express server and the isolated `justfit_test` database. Covers upload failures,
// audiences (Everyone, Followers, Close Friends) on public and private accounts, Close
// Friends management and its privacy, access revocation, concurrent views, reporting,
// deletion, expiry and the clean-up job, and direct media links after each of them.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const COMMUNITY_TABLES = ["community_reports", "community_story_views", "community_stories", "community_close_friends", "community_blocks",
  "community_follows", "community_profiles", "community_post_media", "community_posts", "community_media"];

describe("community stories e2e: audiences, close friends, views, reports, deletion and expiry", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, uploadDir;
  const ids = {};
  const tokens = {};
  const identities = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* an image */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag, role) => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const upload = async (token) => {
    const result = await api("POST", "/api/community/media", token, { data: TINY_PNG, mediaType: "image/png" });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.media.id;
  };
  const publish = async (token, extra) => {
    const result = await api("POST", "/api/community/stories", token, { mediaId: await upload(token), ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.story;
  };
  // The story ids a viewer can see, across every member in the row
  const visible = async (token) => {
    const result = await api("GET", "/api/community/stories", token);
    assert.equal(result.status, 200);
    return result.json.members.flatMap((group) => group.stories.map((story) => story.id));
  };
  const mediaStatus = async (story, token) => (await api("GET", story.imageUrl, token)).status;
  const setPrivate = async (isPrivate) => assert.equal((await api("PATCH", "/api/community/me", tokens.owner, { isPrivate })).status, 200);
  const storyCount = async () => (await connection.query("SELECT COUNT(*) AS n FROM community_stories"))[0][0].n;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-stories-uploads-"));
    server = await startTestServer({ ...env, UPLOAD_DIR: uploadDir });
    try {
      for (const tag of ["owner", "follower", "close", "stranger"]) await newIdentity(tag);
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, `Member ${tag}`, tag === "admin" ? "admin" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of COMMUNITY_TABLES) await connection.query("DELETE FROM `" + table + "`");
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try { await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {}); await testAccounts.deleteUser(identities[tag].id); } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. every story and Close Friends route needs a valid session", async () => {
    const someId = "11111111-2222-4333-8444-555555555555";
    for (const [method, route, body] of [
      ["GET", "/api/community/stories"], ["POST", "/api/community/stories", { mediaId: someId }], ["POST", `/api/community/stories/${someId}/view`],
      ["POST", `/api/community/stories/${someId}/report`, { reason: "x" }], ["DELETE", `/api/community/stories/${someId}`],
      ["GET", "/api/community/me/close-friends"], ["PUT", `/api/community/me/close-friends/${ids.close}`], ["DELETE", `/api/community/me/close-friends/${ids.close}`],
    ]) {
      assert.equal((await api(method, route, null, body)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, "not.a.token", body)).status, 401, `${method} ${route} bad token`);
    }
  });

  test("2. upload failures and bad input never create a story", async () => {
    assert.equal((await api("POST", "/api/community/media", tokens.owner, { data: "AAAAAAAAAAAAAAAAAAAA", mediaType: "image/png" })).status, 415, "bytes that aren't an image");
    assert.equal((await api("POST", "/api/community/media", tokens.owner, { data: TINY_PNG, mediaType: "image/jpeg" })).status, 415, "a label that doesn't match the bytes");
    assert.equal((await api("POST", "/api/community/media", tokens.owner, { data: "%%%", mediaType: "image/png" })).status, 400, "not base64");
    assert.equal((await api("POST", "/api/community/media", tokens.owner, { data: "JVBERi0xLjcK", mediaType: "application/pdf" })).status, 400, "a PDF is not a photo");
    const others = await upload(tokens.stranger);
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: others })).status, 400, "another member's upload");
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: "11111111-2222-4333-8444-555555555555" })).status, 400, "never uploaded");
    const unfinished = await upload(tokens.owner);
    fs.unlinkSync(path.join(uploadDir, `${unfinished}.png`));
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: unfinished })).status, 400, "an upload whose file never finished");
    const mine = await upload(tokens.owner);
    for (const body of [{ mediaId: mine, audience: "only_me" }, { mediaId: mine, audience: "everyone" }, { mediaId: mine, caption: "x".repeat(201) }, { mediaId: mine, userId: ids.stranger }, { mediaId: "1 OR 1=1" }]) {
      assert.equal((await api("POST", "/api/community/stories", tokens.owner, body)).status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(await storyCount(), 0);
  });

  test("3. Close Friends: only followers can be added, the list is only ever the owner's, adds are idempotent", async () => {
    for (const tag of ["follower", "close"]) {
      assert.equal((await api("POST", `/api/community/profiles/${ids.owner}/follow`, tokens[tag])).json.profile.followState, "following");
    }
    assert.equal((await api("PUT", `/api/community/me/close-friends/${ids.stranger}`, tokens.owner)).status, 400, "a non-follower can't be added");
    assert.equal((await api("PUT", `/api/community/me/close-friends/${ids.owner}`, tokens.owner)).status, 400, "not yourself");
    assert.equal((await api("PUT", "/api/community/me/close-friends/user_doesnotexist000", tokens.owner)).status, 404);
    assert.equal((await api("PUT", "/api/community/me/close-friends/1%20OR%201=1", tokens.owner)).status, 400);
    for (let i = 0; i < 2; i++) assert.deepEqual((await api("PUT", `/api/community/me/close-friends/${ids.close}`, tokens.owner)).json, { userId: ids.close, isCloseFriend: true });
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM community_close_friends WHERE owner_id = ?", [ids.owner]);
    assert.equal(n, 1);
    const list = await api("GET", "/api/community/me/close-friends", tokens.owner);
    assert.deepEqual(list.json.members.map((m) => [m.member.id, m.isCloseFriend]), [[ids.close, true], [ids.follower, false]]);
    // Other members only ever get their own (empty) list, and profiles don't carry it
    assert.deepEqual((await api("GET", "/api/community/me/close-friends", tokens.close)).json.members, []);
    const profile = await api("GET", `/api/community/profiles/${ids.owner}`, tokens.close);
    assert.ok(!JSON.stringify(profile.json).includes("lose"), "no close-friends field on a profile");
  });

  test("4. a public account's audiences: each viewer sees exactly what they're allowed to, photos included", async () => {
    state.everyone = await publish(tokens.owner, { audience: "public", caption: "Leg day" });
    state.followers = await publish(tokens.owner, { audience: "followers" });
    state.closeOnly = await publish(tokens.owner, { audience: "close_friends" });
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: await upload(tokens.owner) })).json.story.audience, "public", "Everyone is the default");
    await connection.query("UPDATE community_stories SET deleted_at = NOW() WHERE user_id = ? AND id NOT IN (?, ?, ?)", [ids.owner, state.everyone.id, state.followers.id, state.closeOnly.id]);
    const all = [state.everyone.id, state.followers.id, state.closeOnly.id];
    assert.deepEqual((await visible(tokens.owner)).sort(), [...all].sort());
    assert.deepEqual((await visible(tokens.close)).sort(), [...all].sort(), "a close friend who follows sees all three");
    assert.deepEqual((await visible(tokens.follower)).sort(), [state.everyone.id, state.followers.id].sort());
    assert.deepEqual(await visible(tokens.stranger), [state.everyone.id]);
    assert.equal(await mediaStatus(state.closeOnly, tokens.close), 200);
    for (const tag of ["follower", "stranger"]) assert.equal(await mediaStatus(state.closeOnly, tokens[tag]), 404, `${tag}: close-friends photo`);
    assert.equal(await mediaStatus(state.followers, tokens.stranger), 404);
    assert.equal(await mediaStatus(state.everyone, tokens.stranger), 200);
    assert.equal((await api("POST", `/api/community/stories/${state.followers.id}/view`, tokens.stranger)).status, 404);
    assert.equal((await api("POST", `/api/community/stories/${state.closeOnly.id}/view`, tokens.follower)).status, 404);
    const seenByOther = (await api("GET", "/api/community/stories", tokens.stranger)).json.members[0].stories[0];
    assert.equal(seenByOther.viewCount, null, "only the owner sees the view count");
    assert.equal(seenByOther.audience, "public");
  });

  test("5. access is revoked at once: removing a close friend, and blocking", async () => {
    assert.equal((await api("DELETE", `/api/community/me/close-friends/${ids.close}`, tokens.owner)).status, 200);
    assert.ok(!(await visible(tokens.close)).includes(state.closeOnly.id));
    assert.equal(await mediaStatus(state.closeOnly, tokens.close), 404, "the old photo link stops working");
    await api("PUT", `/api/community/me/close-friends/${ids.close}`, tokens.owner);
    assert.equal(await mediaStatus(state.closeOnly, tokens.close), 200);
    // Blocking ends the follow and the Close Friends entry in both directions
    assert.equal((await api("POST", `/api/community/profiles/${ids.close}/block`, tokens.owner)).status, 200);
    assert.deepEqual(await visible(tokens.close), []);
    assert.equal(await mediaStatus(state.everyone, tokens.close), 404);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM community_close_friends WHERE owner_id = ?", [ids.owner]))[0][0].n, 0);
    await api("DELETE", `/api/community/profiles/${ids.close}/block`, tokens.owner);
    assert.deepEqual(await visible(tokens.close), [state.everyone.id], "after unblocking: only what a stranger sees");
    await api("POST", `/api/community/profiles/${ids.owner}/follow`, tokens.close);
    assert.equal((await api("PUT", `/api/community/me/close-friends/${ids.close}`, tokens.owner)).status, 200);
  });

  test("6. a private account can't address Everyone, rechecked at publish time; older Everyone stories narrow to followers", async () => {
    await setPrivate(true);
    assert.ok(!(await visible(tokens.stranger)).includes(state.everyone.id), "a stranger loses the Everyone story");
    assert.ok((await visible(tokens.follower)).includes(state.everyone.id), "an accepted follower keeps it");
    assert.equal(await mediaStatus(state.everyone, tokens.stranger), 404);
    const refused = await api("POST", "/api/community/stories", tokens.owner, { mediaId: await upload(tokens.owner), audience: "public" });
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /account is private/);
    state.privateFollowers = await publish(tokens.owner, { audience: "followers" });
    state.privateClose = await publish(tokens.owner, { audience: "close_friends" });
    assert.ok((await visible(tokens.close)).includes(state.privateClose.id));
    assert.ok(!(await visible(tokens.follower)).includes(state.privateClose.id));
    assert.ok(!(await visible(tokens.stranger)).includes(state.privateFollowers.id));
    // The photo was uploaded while public; the account went private before Publish
    await setPrivate(false);
    const photo = await upload(tokens.owner);
    await setPrivate(true);
    const before = await storyCount();
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: photo, audience: "public" })).status, 409);
    assert.equal(await storyCount(), before, "a refused publish saves nothing");
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: photo, audience: "followers" })).status, 201);
    await setPrivate(false);
    await connection.query("UPDATE community_stories SET deleted_at = NOW() WHERE id IN (?, ?) OR (media_id = ?)", [state.privateFollowers.id, state.privateClose.id, photo]);
  });

  test("7. concurrent views count once per member; the owner's own views don't count", async () => {
    const story = state.everyone.id;
    const same = await Promise.all(Array.from({ length: 10 }, () => api("POST", `/api/community/stories/${story}/view`, tokens.follower)));
    assert.ok(same.every((r) => r.status === 200));
    const others = await Promise.all(["close", "stranger", "owner", "follower"].map((tag) => api("POST", `/api/community/stories/${story}/view`, tokens[tag])));
    assert.ok(others.every((r) => r.status === 200));
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM community_story_views WHERE story_id = ?", [story]);
    assert.equal(n, 3, "follower, close and stranger: one row each; none for the owner");
    const own = (await api("GET", "/api/community/stories", tokens.owner)).json.members[0];
    assert.equal(own.isOwn, true);
    assert.equal(own.stories.find((s) => s.id === story).viewCount, 3);
    const followerRow = (await api("GET", "/api/community/stories", tokens.follower)).json.members.find((g) => g.member.id === ids.owner);
    assert.equal(followerRow.stories.find((s) => s.id === story).viewed, true);
  });

  test("8. reporting: only a story you can see, never your own; admins see the story in the report", async () => {
    assert.equal((await api("POST", `/api/community/stories/${state.closeOnly.id}/report`, tokens.stranger, { reason: "Spam" })).status, 404, "a hidden story can't be reported");
    assert.equal((await api("POST", `/api/community/stories/${state.everyone.id}/report`, tokens.owner, { reason: "Spam" })).status, 400, "not your own");
    assert.equal((await api("POST", `/api/community/stories/${state.everyone.id}/report`, tokens.stranger, {})).status, 400, "a reason is required");
    assert.equal((await api("POST", `/api/community/stories/${state.everyone.id}/report`, tokens.stranger, { reason: "Inappropriate", storyId: "x" })).status, 400, "unknown fields");
    assert.equal((await api("POST", `/api/community/stories/${state.everyone.id}/report`, tokens.stranger, { reason: "Inappropriate" })).status, 201);
    assert.equal((await api("GET", "/api/community/reports", tokens.stranger)).status, 403, "members can't read reports");
    const reports = (await api("GET", "/api/community/reports", tokens.admin)).json.reports;
    const report = reports.find((r) => r.storyId === state.everyone.id);
    assert.ok(report, "the report lists the story");
    assert.equal(report.postId, null);
    state.reportId = report.id;
    const detail = (await api("GET", `/api/community/reports/${report.id}`, tokens.admin)).json.report;
    assert.equal(detail.target.type, "story");
    assert.equal(detail.target.body, "Leg day");
    assert.equal(detail.target.imageUrl, `/api/community/reports/${report.id}/media`, "the photo is linked through the admin evidence route");
    assert.equal((await api("GET", detail.target.imageUrl, tokens.admin)).status, 200);
    assert.equal(detail.target.author.id, ids.owner);
    assert.equal(detail.target.deleted, false);
  });

  test("9. deletion: owner only; afterwards the story and its photo are gone for everyone, owner included; admins keep the evidence", async () => {
    assert.equal((await api("DELETE", `/api/community/stories/${state.everyone.id}`, tokens.follower)).status, 403, "a visible story by someone else");
    assert.equal((await api("DELETE", `/api/community/stories/${state.closeOnly.id}`, tokens.stranger)).status, 404, "a hidden story doesn't exist to them");
    assert.equal((await api("DELETE", `/api/community/stories/${state.everyone.id}`, tokens.owner)).status, 200);
    assert.equal((await api("DELETE", `/api/community/stories/${state.everyone.id}`, tokens.owner)).status, 404, "a second delete is a 404");
    for (const tag of ["follower", "close", "stranger"]) {
      assert.ok(!(await visible(tokens[tag])).includes(state.everyone.id), `${tag}: gone from the row`);
      assert.equal(await mediaStatus(state.everyone, tokens[tag]), 404, `${tag}: old photo link`);
      assert.equal((await api("POST", `/api/community/stories/${state.everyone.id}/view`, tokens[tag])).status, 404);
    }
    assert.equal(await mediaStatus(state.everyone, tokens.owner), 404, "the owner loses the photo too: a deleted story isn't viewable by anyone");
    assert.ok(!(await visible(tokens.owner)).includes(state.everyone.id), "nor in the owner's own row");
    assert.equal(await mediaStatus(state.everyone, tokens.admin), 404, "the general media route serves deleted content to nobody, admins included");
    const evidenceUrl = `/api/community/reports/${state.reportId}/media`;
    assert.equal((await api("GET", evidenceUrl, tokens.admin)).status, 200, "an admin reviewing the report sees the photo through the evidence route");
    for (const tag of ["owner", "follower", "close", "stranger"]) assert.equal((await api("GET", evidenceUrl, tokens[tag])).status, 403, `${tag}: evidence is admin-only`);
    assert.equal((await api("GET", evidenceUrl, null)).status, 401, "no session");
    assert.equal((await api("GET", "/api/community/reports/11111111-2222-4333-8444-555555555555/media", tokens.admin)).status, 404, "an unknown report");
    assert.equal((await api("GET", "/api/community/reports/1%20OR%201=1/media", tokens.admin)).status, 400);
    assert.equal(await mediaStatus(state.everyone, tokens.stranger), 404, "reporting it gave the reporter no lasting access");
    // The owner's other uploads are unaffected: a live story's photo and a not-yet-used upload
    assert.equal(await mediaStatus(state.closeOnly, tokens.owner), 200);
    const spare = await upload(tokens.owner);
    assert.equal((await api("GET", `/api/media/${spare}`, tokens.owner)).status, 200, "an unattached upload still loads for its uploader");
    // A photo reused on a live post stays visible through the post, even after the story is deleted
    const reused = await upload(tokens.owner);
    const reusedStory = (await api("POST", "/api/community/stories", tokens.owner, { mediaId: reused, audience: "public" })).json.story;
    const post = await api("POST", "/api/community/posts", tokens.owner, { body: "Same photo on the feed", mediaIds: [reused] });
    assert.equal(post.status, 201, JSON.stringify(post.json));
    assert.equal((await api("DELETE", `/api/community/stories/${reusedStory.id}`, tokens.owner)).status, 200);
    for (const tag of ["owner", "stranger"]) assert.equal((await api("GET", `/api/media/${reused}`, tokens[tag])).status, 200, `${tag}: still on the live post`);
    assert.equal((await api("DELETE", `/api/community/posts/${post.json.post.id}`, tokens.owner)).status, 200);
    assert.equal((await api("GET", `/api/media/${reused}`, tokens.owner)).status, 404, "post and story both deleted: gone for the owner");
    assert.equal((await api("GET", `/api/media/${reused}`, tokens.admin)).status, 404, "and for admins: it was never reported, so there is no evidence route to it");
    const [[row]] = await connection.query("SELECT deleted_at FROM community_stories WHERE id = ?", [state.everyone.id]);
    assert.ok(row.deleted_at, "soft deleted");
    const evidence = (await api("GET", `/api/community/reports/${state.reportId}`, tokens.admin)).json.report.target;
    assert.equal(evidence.deleted, true);
    assert.equal(evidence.body, "Leg day", "the report keeps the caption");
    assert.equal(evidence.imageUrl, evidenceUrl, "and links the photo through the admin evidence route, not the general media URL");
    assert.equal((await api("GET", `/api/community/reports/${state.reportId}`, tokens.owner)).status, 403, "members can't read report evidence");
    // An admin may remove a member's story too
    assert.equal((await api("DELETE", `/api/community/stories/${state.followers.id}`, tokens.admin)).status, 200);
    assert.ok(!(await visible(tokens.follower)).includes(state.followers.id));
  });

  test("10. expiry: an expired story disappears from every read path; the clean-up job removes old unreported ones", async () => {
    await connection.query("UPDATE community_stories SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [state.closeOnly.id]);
    assert.ok(!(await visible(tokens.close)).includes(state.closeOnly.id));
    assert.ok(!(await visible(tokens.owner)).includes(state.closeOnly.id), "the owner's row drops it too");
    assert.equal(await mediaStatus(state.closeOnly, tokens.close), 404);
    assert.equal((await api("POST", `/api/community/stories/${state.closeOnly.id}/view`, tokens.close)).status, 404);
    assert.equal((await api("POST", `/api/community/stories/${state.closeOnly.id}/report`, tokens.close, { reason: "x" })).status, 404);
    assert.equal((await api("DELETE", `/api/community/stories/${state.closeOnly.id}`, tokens.owner)).status, 404);
    // A photo used by both a story and a live post: the story ends and is purged, the post stays
    state.shared = await upload(tokens.owner);
    assert.equal((await api("POST", "/api/community/stories", tokens.owner, { mediaId: state.shared, audience: "public" })).status, 201);
    assert.equal((await api("POST", "/api/community/posts", tokens.owner, { body: "Shared photo", mediaIds: [state.shared] })).status, 201);
    // Age every ended story past the 30-day window: the reported one stays, the rest go
    await connection.query("UPDATE community_stories SET expires_at = DATE_SUB(NOW(), INTERVAL 31 DAY), deleted_at = IF(deleted_at IS NULL, NULL, DATE_SUB(NOW(), INTERVAL 31 DAY)) WHERE user_id = ?", [ids.owner]);
    process.env.UPLOAD_DIR = uploadDir;
    delete require.cache[require.resolve("../../community/media.js")];
    const stories = require("../../community/stories.js");
    const media = require("../../community/media.js");
    const removed = await stories.purgeOldStories(connection);
    assert.ok(removed >= 3, `old stories removed (${removed})`);
    const [left] = await connection.query("SELECT id FROM community_stories WHERE user_id = ?", [ids.owner]);
    assert.deepEqual(left.map((r) => r.id), [state.everyone.id], "only the reported story is kept");
    await connection.query("UPDATE community_media SET created_at = DATE_SUB(NOW(), INTERVAL 2 DAY)");
    await media.removeOrphanedMedia(connection, 24);
    const file = (story) => path.join(uploadDir, `${story.imageUrl.split("/").pop()}.png`);
    assert.ok(!fs.existsSync(file(state.closeOnly)), "a purged story's photo file is deleted");
    assert.ok(fs.existsSync(file(state.everyone)), "the reported story keeps its photo");
    assert.equal((await api("GET", `/api/community/reports/${state.reportId}/media`, tokens.admin)).status, 200, "and the admin can still open it");
    assert.ok(fs.existsSync(file({ imageUrl: `/api/media/${state.shared}` })), "a photo also on a live post is never removed with the story");
    assert.equal((await api("GET", `/api/media/${state.shared}`, tokens.stranger)).status, 200, "and keeps loading through the post");
    // Running the clean-up again changes nothing
    const filesBefore = fs.readdirSync(uploadDir).sort();
    assert.equal(await stories.purgeOldStories(connection), 0, "a second purge removes nothing");
    assert.equal(await media.removeOrphanedMedia(connection, 24), 0, "a second sweep removes nothing");
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), filesBefore);
    assert.equal(await mediaStatus(state.closeOnly, tokens.owner), 404, "not even the owner can load a purged photo");
  });

  test("11. a member can have several active stories: the row lists them oldest first, in one group", async () => {
    const first = await publish(tokens.close, { caption: "Breakfast", audience: "public" });
    const second = await publish(tokens.close, { caption: "Lunch", audience: "public" });
    assert.notEqual(first.id, second.id);
    const ownRow = (await api("GET", "/api/community/stories", tokens.close)).json.members;
    assert.equal(ownRow[0].isOwn, true, "the member's own group comes first");
    assert.deepEqual(ownRow[0].stories.map((s) => s.id).slice(-2), [first.id, second.id], "oldest first, both kept");
    const strangerRow = (await api("GET", "/api/community/stories", tokens.stranger)).json.members;
    const group = strangerRow.find((g) => g.member.id === ids.close);
    assert.ok(group, "another member sees the group");
    assert.equal(strangerRow.filter((g) => g.member.id === ids.close).length, 1, "one group per member, not one per story");
    assert.deepEqual(group.stories.map((s) => s.id).slice(-2), [first.id, second.id]);
    assert.equal(group.allViewed, false);
    // Seeing only the first leaves the group unseen; seeing both marks it seen
    assert.equal((await api("POST", `/api/community/stories/${first.id}/view`, tokens.stranger)).status, 200);
    assert.equal((await api("GET", "/api/community/stories", tokens.stranger)).json.members.find((g) => g.member.id === ids.close).allViewed, false);
    for (const story of group.stories) assert.equal((await api("POST", `/api/community/stories/${story.id}/view`, tokens.stranger)).status, 200);
    assert.equal((await api("GET", "/api/community/stories", tokens.stranger)).json.members.find((g) => g.member.id === ids.close).allViewed, true);
    state.closeStories = [first, second];
  });

  test("12. publishing the same photo again (Retry after a lost response, double taps) never makes a second story", async () => {
    const photo = await upload(tokens.close);
    const before = await storyCount();
    const first = await api("POST", "/api/community/stories", tokens.close, { mediaId: photo, caption: "Dinner", audience: "public" });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const retry = await api("POST", "/api/community/stories", tokens.close, { mediaId: photo, caption: "Dinner", audience: "public" });
    assert.equal(retry.status, 200, "a repeat answers with the story already published");
    assert.equal(retry.json.story.id, first.json.story.id);
    assert.equal(await storyCount(), before + 1, "exactly one row for one photo");
    // Concurrent repeats of a fresh photo: still exactly one story
    const raced = await upload(tokens.close);
    const results = await Promise.all(Array.from({ length: 6 }, () => api("POST", "/api/community/stories", tokens.close, { mediaId: raced, audience: "public" })));
    assert.ok(results.every((r) => r.status === 201 || r.status === 200), results.map((r) => r.status).join(","));
    assert.equal(results.filter((r) => r.status === 201).length, 1, "only one request creates it");
    assert.equal(new Set(results.map((r) => r.json.story.id)).size, 1, "every request gets the same story");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM community_stories WHERE media_id = ?", [raced]);
    assert.equal(n, 1);
    // Another member can't claim the photo by re-publishing it
    assert.equal((await api("POST", "/api/community/stories", tokens.stranger, { mediaId: raced, audience: "public" })).status, 400);
    // A failed upload never reached the server: publishing without a photo creates nothing
    const count = await storyCount();
    assert.equal((await api("POST", "/api/community/stories", tokens.close, { audience: "public" })).status, 400);
    assert.equal(await storyCount(), count);
    // Once the story is deleted, the same photo can be shared again as a new story
    assert.equal((await api("DELETE", `/api/community/stories/${first.json.story.id}`, tokens.close)).status, 200);
    const again = await api("POST", "/api/community/stories", tokens.close, { mediaId: photo, audience: "public" });
    assert.equal(again.status, 201);
    assert.notEqual(again.json.story.id, first.json.story.id);
  });

});
