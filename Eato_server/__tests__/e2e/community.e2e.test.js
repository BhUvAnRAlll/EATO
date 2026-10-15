// Authenticated tests for the community API: real Clerk development identities (two
// members and an admin) against the real Express server and the isolated `eato_test`
// database. Covers posts, likes, comments, stories, groups, reports and direct messages,
// and the attack paths: spoofed authors, other members' content, private conversations.
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
const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_reports", "community_story_views", "community_stories",
  "community_comments", "community_post_likes", "community_posts", "community_group_members", "community_media"];

describe("community e2e: posts, stories, groups and messages with real sessions", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk, uploadDir;
  const identities = {};
  const tokens = {};
  const state = {}; // ids created along the way

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* not JSON (an image) */ }
    return { status: response.status, json, headers: response.headers };
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
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), 35, "schema.sql should create 35 tables in eato_test");
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "eato-test-uploads-"));
    server = await startTestServer({ ...env, UPLOAD_DIR: uploadDir });
    try {
      await newIdentity("a");
      await newIdentity("b");
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    // Members get a name the way a profile save gives them one
    for (const tag of ["a", "b", "admin"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, `Member ${tag.toUpperCase()}`, tag === "admin" ? "admin" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of COMMUNITY_TABLES) await connection.query("DELETE FROM `" + table + "`");
        await db.deleteUsers(connection, Object.values(identities).map((i) => i.id));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (clerk) for (const tag of Object.keys(identities)) {
      try { await cleanupIdentity(tag); } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. every community route needs a valid session", async () => {
    for (const [method, route] of [["GET", "/api/community/feed"], ["POST", "/api/community/posts"], ["GET", "/api/community/stories"], ["GET", "/api/community/groups"], ["GET", "/api/community/conversations"], ["GET", "/api/media/11111111-2222-4333-8444-555555555555"]]) {
      assert.equal((await api(method, route, null, method === "POST" ? { body: "x" } : undefined)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, "not.a.token", method === "POST" ? { body: "x" } : undefined)).status, 401, `${method} ${route} bad token`);
    }
  });

  test("2. the feed starts empty and the seeded groups are listed", async () => {
    const feed = await api("GET", "/api/community/feed", tokens.a);
    assert.equal(feed.status, 200);
    assert.deepEqual(feed.json, { posts: [], nextCursor: null });
    const groups = await api("GET", "/api/community/groups", tokens.a);
    assert.equal(groups.status, 200);
    assert.deepEqual(groups.json.groups.map((g) => g.slug), ["healthy-eating", "fat-loss", "muscle-gain", "high-protein-meals", "meal-prep"]);
    assert.ok(groups.json.groups.every((g) => g.memberCount === 0 && g.joined === false));
    const search = await api("GET", "/api/community/groups?search=protein", tokens.a);
    assert.deepEqual(search.json.groups.map((g) => g.slug), ["high-protein-meals"]);
    assert.equal((await api("GET", "/api/community/groups?search=%25", tokens.a)).json.groups.length, 0, "a wildcard is matched literally");
  });

  test("3. a member uploads an image and posts; the author comes from the session, never the body", async () => {
    const upload = await api("POST", "/api/community/media", tokens.a, { data: TINY_PNG, mediaType: "image/png" });
    assert.equal(upload.status, 201, JSON.stringify(upload.json));
    state.mediaA = upload.json.media.id;
    assert.ok(fs.existsSync(path.join(uploadDir, `${state.mediaA}.png`)), "the image is written to the upload folder");
    assert.equal((await api("POST", "/api/community/media", tokens.a, { data: TINY_PNG, mediaType: "image/jpeg" })).status, 415, "a mislabelled type is refused");
    assert.equal((await api("POST", "/api/community/media", tokens.a, { data: "JVBERi0xLjcK", mediaType: "application/pdf" })).status, 400, "a PDF is not an image");

    const spoof = await api("POST", "/api/community/posts", tokens.a, { body: "Hello", userId: identities.b.id });
    assert.equal(spoof.status, 400);
    const stolen = await api("POST", "/api/community/posts", tokens.b, { body: "Not my image", mediaId: state.mediaA });
    assert.equal(stolen.status, 400, "another member's upload can't be attached");

    const post = await api("POST", "/api/community/posts", tokens.a, { body: "Hit a 140 kg deadlift PR 🔥", category: "achievement", mediaId: state.mediaA });
    assert.equal(post.status, 201, JSON.stringify(post.json));
    state.postA = post.json.post.id;
    assert.equal(post.json.post.author.id, identities.a.id);
    assert.equal(post.json.post.author.name, "Member A");
    assert.equal(post.json.post.imageUrl, `/api/media/${state.mediaA}`);
    assert.equal(post.json.post.isOwn, true);
    assert.equal(post.json.post.likeCount, 0);
    const [[row]] = await connection.query("SELECT user_id FROM community_posts WHERE id = ?", [state.postA]);
    assert.equal(row.user_id, identities.a.id);

    const image = await api("GET", `/api/media/${state.mediaA}`, tokens.b);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal((await api("GET", `/api/media/${state.mediaA}`, null)).status, 401, "images are never public");
    assert.equal((await api("GET", "/api/media/..%2F..%2Fpackage.json", tokens.b)).status, 404);
  });

  test("4. the feed pages newest first with a cursor and never repeats a post", async () => {
    for (let i = 1; i <= 3; i++) assert.equal((await api("POST", "/api/community/posts", tokens.b, { body: `B post ${i}` })).status, 201);
    const first = await api("GET", "/api/community/feed?limit=2", tokens.a);
    assert.equal(first.status, 200);
    assert.equal(first.json.posts.length, 2);
    assert.ok(first.json.nextCursor);
    const second = await api("GET", `/api/community/feed?limit=2&cursor=${encodeURIComponent(first.json.nextCursor)}`, tokens.a);
    assert.equal(second.status, 200);
    const ids = [...first.json.posts, ...second.json.posts].map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "no post appears twice");
    assert.equal(ids.length, 4);
    assert.equal(ids[3], state.postA, "the oldest post is last");
    assert.equal(second.json.nextCursor, null);
    assert.equal((await api("GET", "/api/community/feed?limit=0", tokens.a)).status, 400);
    assert.equal((await api("GET", "/api/community/feed?cursor=bad", tokens.a)).status, 400);
    assert.equal(first.json.posts[0].isOwn, false, "B's post isn't A's");
  });

  test("5. likes toggle, count once, and a repeat can't double count", async () => {
    const like = await api("POST", `/api/community/posts/${state.postA}/like`, tokens.b);
    assert.equal(like.status, 200);
    assert.deepEqual(like.json, { liked: true, likeCount: 1 });
    assert.deepEqual((await api("POST", `/api/community/posts/${state.postA}/like`, tokens.b)).json, { liked: true, likeCount: 1 }, "repeat like is a no-op");
    assert.equal((await api("GET", `/api/community/posts/${state.postA}`, tokens.b)).json.post.liked, true);
    assert.equal((await api("GET", `/api/community/posts/${state.postA}`, tokens.a)).json.post.liked, false);
    const [[likes]] = await connection.query("SELECT COUNT(*) AS n FROM community_post_likes WHERE post_id = ?", [state.postA]);
    assert.equal(likes.n, 1);
    assert.deepEqual((await api("DELETE", `/api/community/posts/${state.postA}/like`, tokens.b)).json, { liked: false, likeCount: 0 });
    assert.deepEqual((await api("DELETE", `/api/community/posts/${state.postA}/like`, tokens.b)).json, { liked: false, likeCount: 0 });
  });

  test("6. comments page oldest first and the count follows creation and deletion", async () => {
    const c1 = await api("POST", `/api/community/posts/${state.postA}/comments`, tokens.b, { body: "Huge!" });
    assert.equal(c1.status, 201, JSON.stringify(c1.json));
    assert.equal(c1.json.commentCount, 1);
    const c2 = await api("POST", `/api/community/posts/${state.postA}/comments`, tokens.a, { body: "Thanks" });
    assert.equal(c2.json.commentCount, 2);
    const list = await api("GET", `/api/community/posts/${state.postA}/comments?limit=1`, tokens.a);
    assert.equal(list.json.comments[0].body, "Huge!");
    const next = await api("GET", `/api/community/posts/${state.postA}/comments?limit=1&cursor=${encodeURIComponent(list.json.nextCursor)}`, tokens.a);
    assert.equal(next.json.comments[0].body, "Thanks");
    assert.equal(next.json.nextCursor, null);
    assert.equal((await api("POST", `/api/community/posts/${state.postA}/comments`, tokens.b, { body: "" })).status, 400);
    // B can't delete A's comment; A (the post's author) can delete B's
    assert.equal((await api("DELETE", `/api/community/comments/${c2.json.comment.id}`, tokens.b)).status, 403);
    const removed = await api("DELETE", `/api/community/comments/${c1.json.comment.id}`, tokens.a);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.commentCount, 1);
    assert.equal((await api("GET", `/api/community/posts/${state.postA}`, tokens.a)).json.post.commentCount, 1);
  });

  test("7. only the author edits; the author or an admin deletes; reports reach admins", async () => {
    assert.equal((await api("PATCH", `/api/community/posts/${state.postA}`, tokens.b, { body: "hijacked" })).status, 403);
    assert.equal((await api("DELETE", `/api/community/posts/${state.postA}`, tokens.b)).status, 403);
    const edit = await api("PATCH", `/api/community/posts/${state.postA}`, tokens.a, { body: "Edited PR post" });
    assert.equal(edit.status, 200);
    assert.equal(edit.json.post.body, "Edited PR post");
    const report = await api("POST", `/api/community/posts/${state.postA}/report`, tokens.b, { reason: "Looks like spam" });
    assert.equal(report.status, 201);
    assert.equal((await api("GET", "/api/community/reports", tokens.b)).status, 403, "members can't read reports");
    const reports = await api("GET", "/api/community/reports", tokens.admin);
    assert.equal(reports.status, 200);
    assert.equal(reports.json.reports.length, 1);
    assert.equal(reports.json.reports[0].postId, state.postA);
    assert.equal((await api("POST", `/api/community/reports/${reports.json.reports[0].id}/resolve`, tokens.admin, { status: "reviewed" })).status, 200);
    assert.equal((await api("GET", "/api/community/reports", tokens.admin)).json.reports.length, 0);
    // An admin may delete a member's post; it then disappears from the feed but the row stays (soft delete)
    const bPost = (await api("GET", "/api/community/feed", tokens.a)).json.posts.find((p) => p.author.id === identities.b.id);
    assert.equal((await api("DELETE", `/api/community/posts/${bPost.id}`, tokens.admin)).status, 200);
    assert.equal((await api("GET", `/api/community/posts/${bPost.id}`, tokens.a)).status, 404);
    const [[row]] = await connection.query("SELECT deleted_at FROM community_posts WHERE id = ?", [bPost.id]);
    assert.ok(row.deleted_at);
  });

  test("8. stories: active ones are grouped by member, views are idempotent, expired ones vanish", async () => {
    const upload = await api("POST", "/api/community/media", tokens.b, { data: TINY_PNG, mediaType: "image/png" });
    const story = await api("POST", "/api/community/stories", tokens.b, { mediaId: upload.json.media.id, caption: "Leg day" });
    assert.equal(story.status, 201, JSON.stringify(story.json));
    state.story = story.json.story.id;
    assert.equal((await api("POST", "/api/community/stories", tokens.a, { mediaId: upload.json.media.id })).status, 400, "another member's image can't be used");
    const list = await api("GET", "/api/community/stories", tokens.a);
    assert.equal(list.status, 200);
    assert.equal(list.json.members.length, 1);
    assert.equal(list.json.members[0].member.id, identities.b.id);
    assert.equal(list.json.members[0].allViewed, false);
    assert.equal(list.json.members[0].stories[0].viewed, false);
    assert.deepEqual((await api("POST", `/api/community/stories/${state.story}/view`, tokens.a)).json, { viewed: true });
    assert.deepEqual((await api("POST", `/api/community/stories/${state.story}/view`, tokens.a)).json, { viewed: true });
    const [[views]] = await connection.query("SELECT COUNT(*) AS n FROM community_story_views WHERE story_id = ?", [state.story]);
    assert.equal(views.n, 1);
    assert.equal((await api("GET", "/api/community/stories", tokens.a)).json.members[0].allViewed, true);
    assert.equal((await api("DELETE", `/api/community/stories/${state.story}`, tokens.a)).status, 403, "only the owner deletes");
    // Expire it directly in the database: it must disappear and refuse views
    await connection.query("UPDATE community_stories SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [state.story]);
    assert.equal((await api("GET", "/api/community/stories", tokens.a)).json.members.length, 0);
    assert.equal((await api("POST", `/api/community/stories/${state.story}/view`, tokens.a)).status, 404);
    assert.equal((await api("DELETE", `/api/community/stories/${state.story}`, tokens.b)).status, 200);
    assert.ok(!fs.existsSync(path.join(uploadDir, `${upload.json.media.id}.png`)), "the story's image is removed with it");
  });

  test("9. groups: join once, post inside, leave; private groups stay hidden; only admins create", async () => {
    const groups = (await api("GET", "/api/community/groups", tokens.a)).json.groups;
    const fatLoss = groups.find((g) => g.slug === "fat-loss");
    const join = await api("POST", `/api/community/groups/${fatLoss.id}/join`, tokens.a);
    assert.equal(join.status, 200);
    assert.equal(join.json.group.joined, true);
    assert.equal(join.json.group.memberCount, 1);
    assert.equal((await api("POST", `/api/community/groups/${fatLoss.id}/join`, tokens.a)).json.group.memberCount, 1, "a repeat join doesn't double count");
    assert.equal((await api("POST", "/api/community/posts", tokens.b, { body: "not a member", groupId: fatLoss.id })).status, 403);
    const groupPost = await api("POST", "/api/community/posts", tokens.a, { body: "Week 1 check-in", groupId: fatLoss.id });
    assert.equal(groupPost.status, 201);
    assert.equal((await api("GET", "/api/community/feed", tokens.b)).json.posts.some((p) => p.id === groupPost.json.post.id), false, "group posts stay out of the main feed");
    assert.equal((await api("GET", `/api/community/groups/${fatLoss.id}/posts`, tokens.b)).json.posts.length, 1, "public group posts are readable by everyone");
    const leave = await api("DELETE", `/api/community/groups/${fatLoss.id}/join`, tokens.a);
    assert.equal(leave.json.group.joined, false);
    assert.equal(leave.json.group.memberCount, 0);

    assert.equal((await api("POST", "/api/community/groups", tokens.a, { name: "My group", topic: "t", description: "d" })).status, 403);
    const created = await api("POST", "/api/community/groups", tokens.admin, { name: "Coaches Only", topic: "Private", description: "Invite only.", isPrivate: true });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.privateGroup = created.json.group.id;
    assert.equal(created.json.group.memberCount, 1);
    assert.equal((await api("GET", "/api/community/groups", tokens.a)).json.groups.some((g) => g.id === state.privateGroup), false, "a private group is hidden from non-members");
    assert.equal((await api("GET", `/api/community/groups/${state.privateGroup}`, tokens.a)).status, 403);
    assert.equal((await api("GET", `/api/community/groups/${state.privateGroup}/posts`, tokens.a)).status, 403);
    assert.equal((await api("POST", `/api/community/groups/${state.privateGroup}/join`, tokens.a)).status, 403);
    assert.equal((await api("GET", `/api/community/groups/${state.privateGroup}`, tokens.admin)).status, 200);
    assert.equal((await api("POST", "/api/community/groups", tokens.admin, { name: "Coaches Only", topic: "t", description: "d" })).status, 400, "names stay unique");
  });

  test("10. direct messages: only members of a conversation can read or write it", async () => {
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: identities.a.id })).status, 400);
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: "user_doesNotExist123" })).status, 404);
    const open = await api("POST", "/api/community/conversations", tokens.a, { userId: identities.b.id });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    state.conversation = open.json.conversation.id;
    assert.equal((await api("POST", "/api/community/conversations", tokens.b, { userId: identities.a.id })).json.conversation.id, state.conversation, "the same pair gets the same conversation");

    const sent = await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body: "Hey, how's the split going?" });
    assert.equal(sent.status, 201);
    assert.equal(sent.json.message.isOwn, true);
    assert.equal((await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.admin, { body: "intruder" })).status, 403);
    assert.equal((await api("GET", `/api/community/conversations/${state.conversation}/messages`, tokens.admin)).status, 403);

    const bList = await api("GET", "/api/community/conversations", tokens.b);
    assert.equal(bList.json.unreadCount, 1);
    assert.equal(bList.json.conversations[0].other.id, identities.a.id);
    assert.equal(bList.json.conversations[0].lastMessage, "Hey, how's the split going?");
    const read = await api("GET", `/api/community/conversations/${state.conversation}/messages`, tokens.b);
    assert.equal(read.status, 200);
    assert.equal(read.json.messages.length, 1);
    assert.equal(read.json.messages[0].isOwn, false);
    assert.equal(read.json.other.id, identities.a.id);
    assert.equal((await api("GET", "/api/community/conversations", tokens.b)).json.unreadCount, 0, "reading marks it read");
    for (let i = 0; i < 3; i++) await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.b, { body: `reply ${i}` });
    const pageOne = await api("GET", `/api/community/conversations/${state.conversation}/messages?limit=2`, tokens.a);
    assert.equal(pageOne.json.messages.length, 2);
    assert.equal(pageOne.json.messages[0].body, "reply 2", "newest first");
    const pageTwo = await api("GET", `/api/community/conversations/${state.conversation}/messages?limit=2&cursor=${encodeURIComponent(pageOne.json.nextCursor)}`, tokens.a);
    assert.deepEqual(pageTwo.json.messages.map((m) => m.body), ["reply 0", "Hey, how's the split going?"]);
    assert.equal((await api("GET", "/api/community/conversations", tokens.admin)).json.conversations.length, 0, "others see nothing of this conversation");
  });

  test("11. malformed ids and oversized or unknown input are 400s, never 500s", async () => {
    for (const bad of ["1 OR 1=1", "../x", "11111111-2222-4333-8444-55555555555z"]) {
      assert.equal((await api("GET", `/api/community/posts/${encodeURIComponent(bad)}`, tokens.a)).status, 400, bad);
      assert.equal((await api("POST", `/api/community/posts/${encodeURIComponent(bad)}/like`, tokens.a)).status, 400, bad);
    }
    assert.equal((await api("GET", "/api/community/posts/11111111-2222-4333-8444-555555555555", tokens.a)).status, 404);
    assert.equal((await api("POST", "/api/community/posts", tokens.a, { body: "x".repeat(1001) })).status, 400);
    assert.equal((await api("POST", "/api/community/posts", tokens.a, "a string")).status, 400);
    assert.equal((await api("POST", `/api/community/posts/${state.postA}/comments`, tokens.a, { body: "ok", userId: "user_x" })).status, 400);
  });
});
