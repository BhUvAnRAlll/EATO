// Authenticated tests for creating, editing and deleting posts with photos: real Clerk
// development identities against the real Express server and the isolated `eato_test`
// database. Covers ordered photos, the audience rule for private accounts (rechecked at
// publish time), idempotent publishing, invalid or incomplete uploads, who may edit or
// delete, and that nothing deleted stays reachable through an old link.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

// A 1×1 PNG, as the app would send it
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const COMMUNITY_TABLES = ["community_reports", "community_comments", "community_post_likes", "community_post_media", "community_posts",
  "community_group_members", "community_media", "community_follows", "community_profiles"];

describe("community posts e2e: publish, edit and delete with photos", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk, uploadDir;
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
    try { json = await response.json(); } catch { /* an image or empty */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const upload = async (token) => {
    const result = await api("POST", "/api/community/media", token, { data: TINY_PNG, mediaType: "image/png" });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.media.id;
  };
  const fileOf = (mediaId) => path.join(uploadDir, `${mediaId}.png`);
  const publish = async (token, body, extra = {}) => {
    const result = await api("POST", "/api/community/posts", token, { body, ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.post;
  };
  const feedIds = async (token) => (await api("GET", "/api/community/feed?limit=50", token)).json.posts.map((p) => p.id);
  const mediaStatus = async (mediaId, token) => (await api("GET", `/api/media/${mediaId}`, token)).status;
  const setPrivate = async (token, isPrivate) => assert.equal((await api("PATCH", "/api/community/me", token, { isPrivate })).status, 200);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), 29, "schema.sql should create 29 tables in eato_test");
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "eato-posts-uploads-"));
    server = await startTestServer({ ...env, UPLOAD_DIR: uploadDir });
    try {
      await newIdentity("author");
      await newIdentity("follower");
      await newIdentity("stranger");
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, `Member ${tag}`, tag === "admin" ? "admin" : "user"]);
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
    if (clerk) for (const tag of Object.keys(identities)) {
      try { await clerk.revokeSession(identities[tag].sessionId).catch(() => {}); await clerk.deleteUser(identities[tag].id); } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. a post is saved with its photos in order, in one transaction; the first is the cover", async () => {
    state.m = [await upload(tokens.author), await upload(tokens.author), await upload(tokens.author)];
    state.key = crypto.randomUUID();
    const post = await publish(tokens.author, "Leg day, three angles", { category: "workout", mediaIds: state.m, clientKey: state.key });
    state.post = post.id;
    assert.equal(post.category, "workout");
    assert.deepEqual(post.media.map((m) => m.id), state.m, "photos come back in the order they were sent");
    assert.deepEqual(post.media.map((m) => m.url), state.m.map((id) => `/api/media/${id}`));
    assert.equal(post.imageUrl, `/api/media/${state.m[0]}`, "the cover is the first photo");
    const [rows] = await connection.query("SELECT media_id, position FROM community_post_media WHERE post_id = ? ORDER BY position", [post.id]);
    assert.deepEqual(rows.map((r) => [r.media_id, r.position]), state.m.map((id, i) => [id, i]));
    const [[row]] = await connection.query("SELECT media_id, client_key FROM community_posts WHERE id = ?", [post.id]);
    assert.equal(row.media_id, state.m[0]);
    assert.equal(row.client_key, state.key);
    const feed = await api("GET", "/api/community/feed", tokens.stranger);
    assert.deepEqual(feed.json.posts[0].media.map((m) => m.id), state.m, "the feed carries the full list");
    for (const id of state.m) assert.equal(await mediaStatus(id, tokens.stranger), 200, "a public post's photos are open to members");
  });

  test("2. a repeated Publish with the same client key saves one post, even when the taps race", async () => {
    const again = await api("POST", "/api/community/posts", tokens.author, { body: "Leg day, three angles", category: "workout", mediaIds: state.m, clientKey: state.key });
    assert.equal(again.status, 201);
    assert.equal(again.json.post.id, state.post, "the post saved the first time comes back");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ?", [ids.author]);
    assert.equal(n, 1);
    // Two requests in flight at once with a fresh key
    const key = crypto.randomUUID();
    const body = { body: "Double tap", clientKey: key };
    const [first, second] = await Promise.all([api("POST", "/api/community/posts", tokens.author, body), api("POST", "/api/community/posts", tokens.author, body)]);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(second.status, 201, JSON.stringify(second.json));
    assert.equal(first.json.post.id, second.json.post.id);
    const [[dup]] = await connection.query("SELECT COUNT(*) AS n FROM community_posts WHERE client_key = ?", [key]);
    assert.equal(dup.n, 1);
    // A different member can't collide with that key (it's scoped to the author)
    const other = await api("POST", "/api/community/posts", tokens.stranger, body);
    assert.equal(other.status, 201);
    assert.notEqual(other.json.post.id, first.json.post.id);
    state.racePost = first.json.post.id;
  });

  test("3. photos must be the author's own, finished uploads: anything else is refused before saving", async () => {
    const before = (await connection.query("SELECT COUNT(*) AS n FROM community_posts"))[0][0].n;
    const stolen = await api("POST", "/api/community/posts", tokens.follower, { body: "Not mine", mediaIds: [state.m[0]] });
    assert.equal(stolen.status, 400, "another member's upload");
    assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "x", mediaIds: ["11111111-2222-4333-8444-555555555555"] })).status, 400, "an id that was never uploaded");
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => upload(tokens.author)));
    assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "x", mediaIds: five })).status, 400, "too many photos");
    assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "x", mediaIds: [five[0], five[0]] })).status, 400, "the same photo twice");
    // An upload whose file never finished (or was removed) is not a usable photo
    fs.unlinkSync(fileOf(five[1]));
    const gone = await api("POST", "/api/community/posts", tokens.author, { body: "x", mediaIds: [five[1]] });
    assert.equal(gone.status, 400, JSON.stringify(gone.json));
    assert.match(gone.json.error, /upload it again/);
    // Bad bytes never become an upload at all
    assert.equal((await api("POST", "/api/community/media", tokens.author, { data: "AAAAAAAAAAAAAAAAAAAAAAAAAAAA", mediaType: "image/png" })).status, 415);
    assert.equal((await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/jpeg" })).status, 415, "the label must match the bytes");
    assert.equal((await api("POST", "/api/community/media", tokens.author, { data: "%%%", mediaType: "image/png" })).status, 400);
    const after = (await connection.query("SELECT COUNT(*) AS n FROM community_posts"))[0][0].n;
    assert.equal(after, before, "nothing was saved");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM community_post_media WHERE media_id IN (?)", [five]))[0][0].n, 0);
  });

  test("4. audience rules come from the account's privacy on the server, rechecked at publish time", async () => {
    await setPrivate(tokens.author, true);
    const everyone = await api("POST", "/api/community/posts", tokens.author, { body: "Everyone?", audience: "public" });
    assert.equal(everyone.status, 409, JSON.stringify(everyone.json));
    assert.match(everyone.json.error, /account is private/);
    assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "Default audience" })).status, 409, "the default audience is Everyone, so it's refused too");
    state.privateFollowers = (await publish(tokens.author, "Private, followers", { audience: "followers" })).id;
    state.privateOnlyMe = (await publish(tokens.author, "Private, only me", { audience: "only_me" })).id;
    // A group post is shared with the group, whatever the account's privacy
    const [[group]] = await connection.query("SELECT id FROM community_groups WHERE slug = 'fat-loss'");
    assert.equal((await api("POST", `/api/community/groups/${group.id}/join`, tokens.author)).status, 200);
    assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "In the group", groupId: group.id })).status, 201);
    // Privacy changes while a draft is open: the photo was uploaded while public, the
    // account went private, so publishing to Everyone fails and a valid audience succeeds
    await setPrivate(tokens.author, false);
    const photo = await upload(tokens.author);
    await setPrivate(tokens.author, true);
    const key = crypto.randomUUID();
    const refused = await api("POST", "/api/community/posts", tokens.author, { body: "Mid-draft", audience: "public", mediaIds: [photo], clientKey: key });
    assert.equal(refused.status, 409);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM community_posts WHERE client_key = ?", [key]))[0][0].n, 0, "a refused publish saves nothing");
    const saved = await api("POST", "/api/community/posts", tokens.author, { body: "Mid-draft", audience: "followers", mediaIds: [photo], clientKey: key });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.post.media.map((m) => m.id), [photo]);
    state.midDraft = saved.json.post.id;
    // Editing follows the same rule: the audience a post ends up with must be allowed
    assert.equal((await api("PATCH", `/api/community/posts/${state.privateFollowers}`, tokens.author, { audience: "public" })).status, 409);
    assert.equal((await api("PATCH", `/api/community/posts/${state.privateFollowers}`, tokens.author, { body: "Still followers" })).status, 200);
    // The old public post (from when the account was public) can't be re-saved as Everyone either
    assert.equal((await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { body: "Edited while private" })).status, 409, "an Everyone post needs a valid audience before it can be edited");
    assert.equal((await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { body: "Edited while private", audience: "followers" })).status, 200);
    await setPrivate(tokens.author, false);
    assert.equal((await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { audience: "public" })).status, 200);
  });

  test("5. the saved post shows only to eligible viewers, photos included", async () => {
    // author is public again; follower follows (accepted at once)
    assert.equal((await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.follower)).json.profile.followState, "following");
    const followerFeed = await feedIds(tokens.follower);
    const strangerFeed = await feedIds(tokens.stranger);
    assert.ok(followerFeed.includes(state.post) && strangerFeed.includes(state.post), "Everyone: both see it");
    assert.ok(followerFeed.includes(state.privateFollowers) && !strangerFeed.includes(state.privateFollowers), "Followers: the follower only");
    assert.ok(followerFeed.includes(state.midDraft) && !strangerFeed.includes(state.midDraft));
    assert.ok(!followerFeed.includes(state.privateOnlyMe) && !strangerFeed.includes(state.privateOnlyMe), "Only me: nobody else");
    assert.ok((await feedIds(tokens.author)).includes(state.privateOnlyMe), "the author sees their own");
    const [[mid]] = await connection.query("SELECT media_id FROM community_posts WHERE id = ?", [state.midDraft]);
    assert.equal(await mediaStatus(mid.media_id, tokens.follower), 200);
    assert.equal(await mediaStatus(mid.media_id, tokens.stranger), 404, "a photo on a followers post is hidden from strangers");
    assert.equal((await api("GET", `/api/community/posts/${state.privateOnlyMe}`, tokens.follower)).status, 404);
  });

  test("6. only the author edits; photos can be reordered and removed, and a removed photo's file goes", async () => {
    assert.equal((await api("PATCH", `/api/community/posts/${state.post}`, tokens.stranger, { body: "hijack" })).status, 403, "a visible post by someone else");
    assert.equal((await api("PATCH", `/api/community/posts/${state.privateOnlyMe}`, tokens.stranger, { body: "hijack" })).status, 404, "a hidden post doesn't even exist to them");
    const [m1, m2, m3] = state.m;
    const reordered = await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { mediaIds: [m3, m1] });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.json));
    assert.deepEqual(reordered.json.post.media.map((m) => m.id), [m3, m1]);
    assert.equal(reordered.json.post.imageUrl, `/api/media/${m3}`, "the cover follows the new first photo");
    const [rows] = await connection.query("SELECT media_id, position FROM community_post_media WHERE post_id = ? ORDER BY position", [state.post]);
    assert.deepEqual(rows.map((r) => [r.media_id, r.position]), [[m3, 0], [m1, 1]]);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM community_media WHERE id = ?", [m2]))[0][0].n, 0, "the removed photo's row is gone");
    assert.ok(!fs.existsSync(fileOf(m2)), "and its file");
    assert.equal(await mediaStatus(m2, tokens.author), 404, "even its uploader can't fetch it any more");
    // The stranger can't attach the author's photos to their own post, and can't reorder someone else's
    assert.equal((await api("PATCH", `/api/community/posts/${state.racePost}`, tokens.stranger, { mediaIds: [m1] })).status, 403);
    assert.equal((await api("POST", "/api/community/posts", tokens.stranger, { body: "x", mediaIds: [m1] })).status, 400);
    // Text and category edits keep the photos
    const text = await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { body: "Leg day, two angles", category: "progress" });
    assert.deepEqual(text.json.post.media.map((m) => m.id), [m3, m1]);
    assert.equal(text.json.post.category, "progress");
    // Removing every photo clears the cover too
    const none = await api("PATCH", `/api/community/posts/${state.racePost}`, tokens.author, { mediaIds: [] });
    assert.equal(none.status, 200);
    assert.equal(none.json.post.imageUrl, null);
  });

  test("7. only the author deletes; afterwards neither the post nor its photos are reachable, and the report stays", async () => {
    const [m3, m1] = [state.m[2], state.m[0]];
    assert.equal((await api("POST", `/api/community/posts/${state.post}/report`, tokens.stranger, { reason: "Checking moderation context" })).status, 201);
    assert.equal((await api("DELETE", `/api/community/posts/${state.post}`, tokens.stranger)).status, 403);
    assert.equal((await api("DELETE", `/api/community/posts/${state.privateOnlyMe}`, tokens.stranger)).status, 404);
    assert.equal((await api("DELETE", `/api/community/posts/${state.post}`, tokens.author)).status, 200);
    assert.equal((await api("GET", `/api/community/posts/${state.post}`, tokens.author)).status, 404, "gone for the author too");
    assert.equal((await api("PATCH", `/api/community/posts/${state.post}`, tokens.author, { body: "undelete?" })).status, 404);
    assert.equal((await api("DELETE", `/api/community/posts/${state.post}`, tokens.author)).status, 404, "a second delete is a 404, not an error");
    assert.ok(!(await feedIds(tokens.follower)).includes(state.post));
    for (const id of [m3, m1]) {
      assert.equal(await mediaStatus(id, tokens.follower), 404, "old photo links die for members");
      assert.equal(await mediaStatus(id, tokens.stranger), 404);
      assert.equal(await mediaStatus(id, tokens.author), 200, "the uploader can still see their own file for now");
      assert.equal(await mediaStatus(id, tokens.admin), 200, "an admin reviewing the report can still see the photo");
    }
    const detail = await api("GET", `/api/community/reports/${(await api("GET", "/api/community/reports", tokens.admin)).json.reports[0].id}`, tokens.admin);
    assert.equal(detail.json.report.target.deleted, true);
    assert.equal(detail.json.report.target.imageUrl, `/api/media/${m3}`, "the report still points at the cover");
    const [[row]] = await connection.query("SELECT deleted_at FROM community_posts WHERE id = ?", [state.post]);
    assert.ok(row.deleted_at, "soft deleted, so the report keeps its context");
    const [[report]] = await connection.query("SELECT post_id, status FROM community_reports WHERE post_id = ?", [state.post]);
    assert.equal(report.status, "open");
    // The sweep keeps a deleted post's photos for a while (moderation), then removes them
    process.env.UPLOAD_DIR = uploadDir;
    delete require.cache[require.resolve("../../community/media.js")];
    const sweeper = require("../../community/media.js");
    await connection.query("UPDATE community_media SET created_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id IN (?)", [[m3, m1]]);
    assert.equal(await sweeper.removeOrphanedMedia(connection, 24), 0, "recently deleted: kept");
    await connection.query("UPDATE community_posts SET deleted_at = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id = ?", [state.post]);
    assert.equal(await sweeper.removeOrphanedMedia(connection, 24), 2, "deleted long ago: both photos removed");
    assert.ok(!fs.existsSync(fileOf(m3)) && !fs.existsSync(fileOf(m1)));
    assert.equal(await mediaStatus(m1, tokens.author), 404);
    assert.equal(await mediaStatus(m1, tokens.admin), 404, "nothing is kept past the retention window");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM community_reports WHERE post_id = ?", [state.post]))[0][0].n, 1, "the report row survives");
  });

  test("8. post fields are validated, never trusted: author, client key and photo list shapes", async () => {
    const bad = [
      [{ body: "x", clientKey: "draft-1" }, /client key/],
      [{ body: "x", mediaIds: "abc" }, /list of images/],
      [{ body: "x", mediaIds: [state.m[0]], mediaId: state.m[0] }, /either mediaId or mediaIds/],
      [{ body: "x", category: "league" }, /Category/],
      [{ body: "x", audience: "everyone" }, /Audience/],
      [{ body: "x", userId: ids.stranger }, /unexpected field/],
      [{ body: "x", isPrivate: false }, /unexpected field/],
    ];
    for (const [body, pattern] of bad) {
      const result = await api("POST", "/api/community/posts", tokens.author, body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.match(result.json.error, pattern);
    }
    assert.equal((await api("PATCH", `/api/community/posts/${state.racePost}`, tokens.author, { clientKey: crypto.randomUUID() })).status, 400);
    assert.equal((await api("PATCH", `/api/community/posts/${state.racePost}`, tokens.author, {})).status, 400);
  });
});
