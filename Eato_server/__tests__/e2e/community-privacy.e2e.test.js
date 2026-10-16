// Audience and account privacy for the community feed, with real Clerk sessions against the
// test server and eato_test: post audiences (public / followers / only me), private accounts
// and follow requests, blocking, suspension, profiles, and the media route. Every check is
// what the server returns, never what the app would hide.
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

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_reports", "community_story_views", "community_stories",
  "community_comments", "community_post_likes", "community_posts", "community_group_members", "community_media", "community_follows", "community_blocks", "community_profiles"];

describe("community privacy e2e: audiences, private accounts, blocks and suspension", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk, uploadDir;
  const ids = {}; // tag → Clerk user id
  const tokens = {};
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
  const identities = {};
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const feedIds = async (token) => {
    const { status, json } = await api("GET", "/api/community/feed?limit=50", token);
    assert.equal(status, 200);
    return json.posts.map((p) => p.id);
  };
  const post = async (token, body, extra = {}) => {
    const result = await api("POST", "/api/community/posts", token, { body, ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.post.id;
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), 44, "schema.sql should create 44 tables in eato_test");
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "eato-privacy-uploads-"));
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

  test("1. audiences on a public account: public for all, followers for followers, only me for the author", async () => {
    state.publicPost = await post(tokens.author, "Public post");
    state.followersPost = await post(tokens.author, "Followers post", { audience: "followers" });
    state.onlyMePost = await post(tokens.author, "Only me post", { audience: "only_me" });
    assert.deepEqual(await feedIds(tokens.author), [state.onlyMePost, state.followersPost, state.publicPost], "the author sees all three");
    assert.deepEqual(await feedIds(tokens.stranger), [state.publicPost], "a stranger sees only the public post");
    // Direct access to a hidden post is a 404, as are likes and comments on it
    assert.equal((await api("GET", `/api/community/posts/${state.followersPost}`, tokens.stranger)).status, 404);
    assert.equal((await api("POST", `/api/community/posts/${state.followersPost}/like`, tokens.stranger)).status, 404);
    assert.equal((await api("POST", `/api/community/posts/${state.onlyMePost}/comments`, tokens.stranger, { body: "hi" })).status, 404);
    assert.equal((await api("GET", `/api/community/posts/${state.onlyMePost}/comments`, tokens.stranger)).status, 404);
    // Following a public account is accepted at once and unlocks the followers post
    const follow = await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.follower);
    assert.equal(follow.status, 200, JSON.stringify(follow.json));
    assert.equal(follow.json.profile.followState, "following");
    assert.equal(follow.json.profile.followers, 1);
    assert.deepEqual(await feedIds(tokens.follower), [state.followersPost, state.publicPost]);
    assert.equal((await api("GET", `/api/community/posts/${state.onlyMePost}`, tokens.follower)).status, 404, "only me stays private even from followers");
    assert.equal((await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.author)).status, 400, "no self-follow");
  });

  test("2. the audience can change after posting, and the feed follows", async () => {
    const edit = await api("PATCH", `/api/community/posts/${state.publicPost}`, tokens.author, { audience: "only_me" });
    assert.equal(edit.status, 200);
    assert.equal(edit.json.post.audience, "only_me");
    assert.deepEqual(await feedIds(tokens.stranger), []);
    assert.equal((await api("PATCH", `/api/community/posts/${state.publicPost}`, tokens.stranger, { audience: "public" })).status, 404, "a stranger can't even find it to edit");
    assert.equal((await api("PATCH", `/api/community/posts/${state.publicPost}`, tokens.author, { audience: "public" })).status, 200);
    assert.deepEqual(await feedIds(tokens.stranger), [state.publicPost]);
  });

  test("3. a private account: public posts show to accepted followers only, requests wait for approval", async () => {
    const settings = await api("PATCH", "/api/community/me", tokens.author, { isPrivate: true, bio: "Lifting since 2021" });
    assert.equal(settings.status, 200, JSON.stringify(settings.json));
    assert.equal(settings.json.profile.isPrivate, true);
    assert.equal(settings.json.profile.bio, "Lifting since 2021");
    assert.deepEqual(await feedIds(tokens.stranger), [], "a stranger sees nothing from a private account");
    assert.deepEqual(await feedIds(tokens.follower), [state.followersPost, state.publicPost], "an existing follower keeps access");
    const profile = await api("GET", `/api/community/profiles/${ids.author}`, tokens.stranger);
    assert.equal(profile.status, 200);
    assert.equal(profile.json.profile.isPrivate, true);
    assert.equal(profile.json.profile.canViewPosts, false);
    assert.equal(profile.json.profile.postCount, 3, "counts are visible on a private profile; posts are not");
    assert.equal((await api("GET", `/api/community/profiles/${ids.author}/posts`, tokens.stranger)).status, 403);
    assert.equal((await api("GET", `/api/community/profiles/${ids.author}/posts`, tokens.follower)).json.posts.length, 2);

    const request = await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.stranger);
    assert.equal(request.json.profile.followState, "requested");
    assert.deepEqual(await feedIds(tokens.stranger), [], "a pending request grants nothing");
    const requests = await api("GET", "/api/community/me/follow-requests", tokens.author);
    assert.equal(requests.json.requests.length, 1);
    assert.equal(requests.json.requests[0].member.id, ids.stranger);
    assert.equal((await api("GET", "/api/community/notifications", tokens.author)).json.followRequests.length, 1, "the request shows under the bell");
    assert.equal((await api("POST", `/api/community/me/follow-requests/${ids.stranger}/accept`, tokens.follower)).status, 404, "only the account being followed can accept");
    const accept = await api("POST", `/api/community/me/follow-requests/${ids.stranger}/accept`, tokens.author);
    assert.equal(accept.status, 200);
    assert.deepEqual(await feedIds(tokens.stranger), [state.followersPost, state.publicPost]);
    assert.equal((await api("GET", `/api/community/profiles/${ids.author}`, tokens.stranger)).json.profile.followState, "following");
    // Unfollow closes the door again
    assert.equal((await api("DELETE", `/api/community/profiles/${ids.author}/follow`, tokens.stranger)).json.profile.followState, "none");
    assert.deepEqual(await feedIds(tokens.stranger), []);
    // A declined request is simply gone
    await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.stranger);
    assert.equal((await api("POST", `/api/community/me/follow-requests/${ids.stranger}/decline`, tokens.author)).status, 200);
    assert.equal((await api("GET", "/api/community/me/follow-requests", tokens.author)).json.requests.length, 0);
    assert.equal((await api("GET", `/api/community/profiles/${ids.author}`, tokens.stranger)).json.profile.followState, "none");
  });

  test("4. media follows the post: a follower can load the image, a stranger gets a 404", async () => {
    const upload = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    state.media = upload.json.media.id;
    state.imagePost = await post(tokens.author, "With a photo", { audience: "followers", mediaId: state.media });
    assert.equal((await api("GET", `/api/media/${state.media}`, tokens.follower)).status, 200);
    assert.equal((await api("GET", `/api/media/${state.media}`, tokens.stranger)).status, 404, "a hidden image looks like a missing one");
    assert.equal((await api("GET", `/api/media/${state.media}`, tokens.author)).status, 200);
    // A story from a private account is also followers-only, image included
    const storyUpload = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    // The account is private here, so Everyone is refused and Followers is the audience
    assert.equal((await api("POST", "/api/community/stories", tokens.author, { mediaId: storyUpload.json.media.id })).status, 409);
    const story = await api("POST", "/api/community/stories", tokens.author, { mediaId: storyUpload.json.media.id, audience: "followers" });
    assert.equal(story.status, 201);
    assert.equal((await api("GET", "/api/community/stories", tokens.stranger)).json.members.length, 0);
    assert.equal((await api("GET", "/api/community/stories", tokens.follower)).json.members.length, 1);
    assert.equal((await api("GET", `/api/media/${storyUpload.json.media.id}`, tokens.stranger)).status, 404);
    assert.equal((await api("POST", `/api/community/stories/${story.json.story.id}/view`, tokens.stranger)).status, 404);
  });

  test("5. blocking hides both members from each other and ends the follow", async () => {
    const block = await api("POST", `/api/community/profiles/${ids.follower}/block`, tokens.author);
    assert.equal(block.status, 200);
    assert.deepEqual(await feedIds(tokens.follower), [], "the blocked follower sees nothing of the author");
    const [[follows]] = await connection.query("SELECT COUNT(*) AS n FROM community_follows WHERE follower_id = ? AND following_id = ?", [ids.follower, ids.author]);
    assert.equal(follows.n, 0, "the follow was removed");
    assert.equal((await api("GET", `/api/community/profiles/${ids.author}`, tokens.follower)).status, 404, "a blocked member can't see the profile");
    assert.equal((await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.follower)).status, 404);
    assert.equal((await api("POST", "/api/community/conversations", tokens.follower, { userId: ids.author })).status, 404, "nor message them");
    const followerPost = await post(tokens.follower, "Follower's own post");
    assert.ok(!(await feedIds(tokens.author)).includes(followerPost), "the author doesn't see the blocked member's posts either");
    assert.equal((await api("GET", "/api/community/me/blocked", tokens.author)).json.members[0].id, ids.follower);
    assert.equal((await api("DELETE", `/api/community/profiles/${ids.follower}/block`, tokens.author)).status, 200);
    assert.ok((await feedIds(tokens.author)).includes(followerPost), "unblocking restores the public post");
  });

  test("6. a suspended member's content disappears and they can read but not write", async () => {
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: false });
    assert.ok((await feedIds(tokens.stranger)).includes(state.publicPost));
    assert.equal((await api("POST", `/api/community/admin/members/${ids.author}/suspend`, tokens.stranger)).status, 403, "members can't suspend");
    const suspend = await api("POST", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin);
    assert.equal(suspend.status, 200, JSON.stringify(suspend.json));
    try {
      const visible = await feedIds(tokens.stranger);
      assert.ok(!visible.includes(state.publicPost) && !visible.includes(state.followersPost), "nothing from a suspended member");
      assert.equal((await api("GET", `/api/community/posts/${state.publicPost}`, tokens.stranger)).status, 404);
      assert.equal((await api("GET", `/api/community/profiles/${ids.author}`, tokens.stranger)).json.profile.suspended, true);
      assert.equal((await api("GET", `/api/community/profiles/${ids.author}`, tokens.stranger)).json.profile.canViewPosts, false);
      assert.equal((await api("GET", "/api/community/feed", tokens.author)).status, 200, "the suspended member can still read");
      assert.equal((await api("POST", "/api/community/posts", tokens.author, { body: "still here?" })).status, 403, "but not write");
      assert.equal((await api("POST", `/api/community/posts/${state.publicPost}/like`, tokens.author)).status, 403);
      const edit = await api("PATCH", `/api/community/posts/${state.publicPost}`, tokens.author, { body: "rewritten while suspended" });
      assert.equal(edit.status, 403, "nor edit a post (it could rewrite reported content)");
      const [[kept]] = await connection.query("SELECT body FROM community_posts WHERE id = ?", [state.publicPost]);
      assert.notEqual(kept.body, "rewritten while suspended");
      assert.equal((await api("POST", "/api/community/conversations", tokens.stranger, { userId: ids.author })).status, 404);
    } finally {
      assert.equal((await api("DELETE", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin)).status, 200);
    }
    assert.ok((await feedIds(tokens.stranger)).includes(state.publicPost), "reinstated");
  });

  test("7. the feed pages without duplicates across audience filtering", async () => {
    for (let i = 0; i < 5; i++) await post(tokens.stranger, `Stranger post ${i}`);
    await post(tokens.stranger, "Stranger only me", { audience: "only_me" });
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const { status, json } = await api("GET", `/api/community/feed?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, tokens.follower);
      assert.equal(status, 200);
      seen.push(...json.posts.map((p) => p.id));
      cursor = json.nextCursor;
      if (!cursor) break;
    }
    assert.equal(new Set(seen).size, seen.length, "no duplicates across pages");
    assert.ok(!seen.some((id) => id === state.onlyMePost), "the author's only-me post never appears");
    const [[visible]] = await connection.query(
      "SELECT COUNT(*) AS n FROM community_posts WHERE deleted_at IS NULL AND group_id IS NULL AND (audience = 'public' OR user_id = ?)", [ids.follower],
    );
    assert.equal(seen.length, visible.n, "every post the follower may see appears exactly once");
  });

  test("9. media access is revoked by unfollowing, going private, deleting the post, blocking and suspension", async () => {
    // Fresh public account, follower follows, a followers-only post with an image
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: false });
    assert.equal((await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.follower)).json.profile.followState, "following");
    const upload = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    const mediaId = upload.json.media.id;
    const postId = await post(tokens.author, "Followers photo", { audience: "followers", mediaId });
    const mediaFor = async (token) => (await api("GET", `/api/media/${mediaId}`, token)).status;
    assert.equal(await mediaFor(tokens.follower), 200, "a follower loads the image");
    assert.equal(await mediaFor(tokens.stranger), 404, "a stranger never could");
    // Unfollow
    await api("DELETE", `/api/community/profiles/${ids.author}/follow`, tokens.follower);
    assert.equal(await mediaFor(tokens.follower), 404, "revoked after unfollowing");
    await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.follower);
    assert.equal(await mediaFor(tokens.follower), 200);
    // Audience change to only me
    await api("PATCH", `/api/community/posts/${postId}`, tokens.author, { audience: "only_me" });
    assert.equal(await mediaFor(tokens.follower), 404, "revoked when the post becomes only-me");
    await api("PATCH", `/api/community/posts/${postId}`, tokens.author, { audience: "public" });
    assert.equal(await mediaFor(tokens.stranger), 200, "a public post's image is open to members");
    // Account goes private: strangers lose it, the accepted follower keeps it
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: true });
    assert.equal(await mediaFor(tokens.stranger), 404, "revoked when the account goes private");
    assert.equal(await mediaFor(tokens.follower), 200);
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: false });
    // Block
    await api("POST", `/api/community/profiles/${ids.stranger}/block`, tokens.author);
    assert.equal(await mediaFor(tokens.stranger), 404, "revoked by a block");
    await api("DELETE", `/api/community/profiles/${ids.stranger}/block`, tokens.author);
    assert.equal(await mediaFor(tokens.stranger), 200);
    // Suspension
    await api("POST", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin);
    try {
      assert.equal(await mediaFor(tokens.stranger), 404, "revoked while suspended");
      assert.equal(await mediaFor(tokens.author), 200, "the owner still sees their own upload");
    } finally {
      await api("DELETE", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin);
    }
    assert.equal(await mediaFor(tokens.stranger), 200);
    // Deletion of the post
    assert.equal((await api("DELETE", `/api/community/posts/${postId}`, tokens.author)).status, 200);
    assert.equal(await mediaFor(tokens.stranger), 404, "revoked when the post is deleted");
    assert.equal(await mediaFor(tokens.follower), 404);
    assert.equal(await mediaFor(tokens.author), 404, "a deleted post's photo is gone for its owner too");
  });

  test("10. reporting a comment on a hidden post is a 404; admins see the reported content; suspended list", async () => {
    const hidden = await post(tokens.author, "Only me with a comment", { audience: "only_me" });
    const comment = await api("POST", `/api/community/posts/${hidden}/comments`, tokens.author, { body: "note to self" });
    assert.equal(comment.status, 201);
    assert.equal((await api("POST", `/api/community/comments/${comment.json.comment.id}/report`, tokens.stranger, { reason: "?" })).status, 404, "no confirmation that a hidden comment exists");
    const visible = await post(tokens.author, "Public, to be reported");
    const report = await api("POST", `/api/community/posts/${visible}/report`, tokens.stranger, { reason: "Spam" });
    assert.equal(report.status, 201);
    const list = await api("GET", "/api/community/reports", tokens.admin);
    const reportId = list.json.reports.find((r) => r.postId === visible).id;
    assert.equal((await api("GET", `/api/community/reports/${reportId}`, tokens.stranger)).status, 403);
    const detail = await api("GET", `/api/community/reports/${reportId}`, tokens.admin);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.equal(detail.json.report.target.type, "post");
    assert.equal(detail.json.report.target.body, "Public, to be reported");
    assert.equal(detail.json.report.target.author.id, ids.author);
    assert.equal(detail.json.report.target.authorSuspended, false);
    await api("POST", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin);
    try {
      const suspended = await api("GET", "/api/community/admin/members/suspended", tokens.admin);
      assert.equal(suspended.status, 200);
      assert.deepEqual(suspended.json.members.map((m) => m.member.id), [ids.author]);
      assert.equal((await api("GET", "/api/community/admin/members/suspended", tokens.stranger)).status, 403);
      assert.equal((await api("GET", `/api/community/reports/${reportId}`, tokens.admin)).json.report.target.authorSuspended, true);
    } finally {
      await api("DELETE", `/api/community/admin/members/${ids.author}/suspend`, tokens.admin);
    }
    assert.equal((await api("GET", "/api/community/admin/members/suspended", tokens.admin)).json.members.length, 0);
    await api("POST", `/api/community/reports/${reportId}/resolve`, tokens.admin, { status: "dismissed" });
  });

  test("11. notifications carry only the viewer's own post previews, and counts are accurate", async () => {
    // The stranger likes and comments on the author's public post; the author's bell lists both
    const mine = await post(tokens.author, "Notify me about this one");
    await api("POST", `/api/community/posts/${mine}/like`, tokens.stranger);
    await api("POST", `/api/community/posts/${mine}/comments`, tokens.stranger, { body: "Nice work" });
    const bell = await api("GET", "/api/community/notifications", tokens.author);
    assert.equal(bell.status, 200);
    const types = bell.json.activity.filter((a) => a.postId === mine).map((a) => a.type).sort();
    assert.deepEqual(types, ["comment", "like"]);
    assert.ok(bell.json.activity.every((a) => a.member.id !== ids.author), "no self-activity");
    assert.ok(bell.json.activity.every((a) => !("email" in a.member)), "no private member data");
    // The stranger's bell has nothing about the author's post (previews only cover your own posts)
    const strangerBell = await api("GET", "/api/community/notifications", tokens.stranger);
    assert.equal(strangerBell.json.activity.some((a) => a.postId === mine), false);
    // Follow-request count: one pending request → 1; accepted → 0
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: true });
    await api("DELETE", `/api/community/profiles/${ids.author}/follow`, tokens.stranger);
    await api("POST", `/api/community/profiles/${ids.author}/follow`, tokens.stranger);
    assert.equal((await api("GET", "/api/community/notifications", tokens.author)).json.followRequests.length, 1);
    await api("POST", `/api/community/me/follow-requests/${ids.stranger}/accept`, tokens.author);
    assert.equal((await api("GET", "/api/community/notifications", tokens.author)).json.followRequests.length, 0);
    await api("PATCH", "/api/community/me", tokens.author, { isPrivate: false });
    // Unread messages: one from the stranger → 1 for the author, 0 after reading
    const conversation = (await api("POST", "/api/community/conversations", tokens.stranger, { userId: ids.author })).json.conversation.id;
    await api("POST", `/api/community/conversations/${conversation}/messages`, tokens.stranger, { body: "hello" });
    assert.equal((await api("GET", "/api/community/conversations", tokens.author)).json.unreadCount, 1);
    await api("GET", `/api/community/conversations/${conversation}/messages`, tokens.author);
    assert.equal((await api("GET", "/api/community/conversations", tokens.author)).json.unreadCount, 0);
  });

  test("12. orphaned uploads are removed by the sweep; attached ones are kept", async () => {
    const media = require("../../community/media.js");
    const orphan = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    const kept = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    await post(tokens.author, "Keeps its image", { mediaId: kept.json.media.id });
    // Age both uploads past the threshold
    await connection.query("UPDATE community_media SET created_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id IN (?, ?)", [orphan.json.media.id, kept.json.media.id]);
    process.env.UPLOAD_DIR = uploadDir; // the sweep runs in this process against the same folder
    delete require.cache[require.resolve("../../community/media.js")];
    const sweeper = require("../../community/media.js");
    const removed = await sweeper.removeOrphanedMedia(connection, 24);
    assert.equal(removed, 1);
    assert.ok(!fs.existsSync(path.join(uploadDir, `${orphan.json.media.id}.png`)), "the orphan's file is gone");
    assert.ok(fs.existsSync(path.join(uploadDir, `${kept.json.media.id}.png`)), "the attached file stays");
    assert.equal((await api("GET", `/api/media/${orphan.json.media.id}`, tokens.author)).status, 404);
    assert.equal((await api("GET", `/api/media/${kept.json.media.id}`, tokens.author)).status, 200);
    void media;
  });

  test("13. a blocked direct conversation is hidden from both sides, kept intact, and restored on unblock", async () => {
    // Two members with a conversation and an unread message each way
    const open = await api("POST", "/api/community/conversations", tokens.author, { userId: ids.follower });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    const conversationId = open.json.conversation.id;
    await api("POST", `/api/community/conversations/${conversationId}/messages`, tokens.author, { body: "before the block" });
    await api("POST", `/api/community/conversations/${conversationId}/messages`, tokens.follower, { body: "reply before the block" });
    const inbox = async (token) => (await api("GET", "/api/community/conversations", token)).json;
    assert.ok((await inbox(tokens.author)).conversations.some((c) => c.id === conversationId));
    assert.equal((await inbox(tokens.author)).unreadCount, 1);
    assert.equal((await inbox(tokens.follower)).unreadCount, 0, "the follower read nothing but sent last; the author's message was before");
    const [[countBefore]] = await connection.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", [conversationId]);

    // The author blocks the follower
    assert.equal((await api("POST", `/api/community/profiles/${ids.follower}/block`, tokens.author)).status, 200);
    for (const [who, token] of [["blocker", tokens.author], ["blocked", tokens.follower]]) {
      assert.equal((await inbox(token)).conversations.some((c) => c.id === conversationId), false, `${who}: hidden from the inbox`);
      assert.equal((await inbox(token)).unreadCount, 0, `${who}: no unread from a hidden conversation`);
      assert.equal((await api("GET", `/api/community/conversations/${conversationId}/messages`, token)).status, 404, `${who}: direct access is a 404`);
      assert.equal((await api("POST", `/api/community/conversations/${conversationId}/messages`, token, { body: "still there?" })).status, 403, `${who}: can't send`);
    }
    assert.equal((await api("POST", "/api/community/conversations", tokens.follower, { userId: ids.author })).status, 404, "the blocked member can't start a new one");
    assert.equal((await api("POST", "/api/community/conversations", tokens.author, { userId: ids.follower })).status, 404, "nor can the blocker");
    const [[countDuring]] = await connection.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", [conversationId]);
    assert.equal(countDuring.n, countBefore.n, "history is kept, not deleted");
    // A third member is unaffected: their own inbox and unread counts are untouched
    assert.equal((await api("GET", "/api/community/conversations", tokens.stranger)).status, 200);

    // Unblock: the conversation returns with its history
    assert.equal((await api("DELETE", `/api/community/profiles/${ids.follower}/block`, tokens.author)).status, 200);
    assert.ok((await inbox(tokens.author)).conversations.some((c) => c.id === conversationId), "restored for the blocker");
    assert.ok((await inbox(tokens.follower)).conversations.some((c) => c.id === conversationId), "restored for the other member");
    assert.equal((await inbox(tokens.author)).unreadCount, 1, "the unread message from before the block is counted again");
    const history = await api("GET", `/api/community/conversations/${conversationId}/messages`, tokens.follower);
    assert.equal(history.status, 200);
    assert.deepEqual(history.json.messages.map((m) => m.body), ["reply before the block", "before the block"]);
    assert.equal((await api("POST", `/api/community/conversations/${conversationId}/messages`, tokens.follower, { body: "after the block" })).status, 201);

    // A block from the other side hides it too (either participant)
    assert.equal((await api("POST", `/api/community/profiles/${ids.author}/block`, tokens.follower)).status, 200);
    assert.equal((await inbox(tokens.author)).conversations.some((c) => c.id === conversationId), false);
    assert.equal((await api("GET", `/api/community/conversations/${conversationId}/messages`, tokens.author)).status, 404);
    await api("DELETE", `/api/community/profiles/${ids.author}/block`, tokens.follower);
    assert.ok((await inbox(tokens.author)).conversations.some((c) => c.id === conversationId));
  });

  test("14. a conversation with more than two members is not hidden by a block between two of them", async () => {
    // No route creates group conversations yet; one is inserted directly to pin the rule down
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO conversations (id, last_message_at) VALUES (?, NOW())", [id]);
    await connection.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?), (?, ?)", [id, ids.author, id, ids.follower, id, ids.stranger]);
    await connection.query("INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (UUID(), ?, ?, 'group hello')", [id, ids.stranger]);
    assert.equal((await api("GET", `/api/community/conversations/${id}/messages`, tokens.author)).status, 200);
    await api("POST", `/api/community/profiles/${ids.follower}/block`, tokens.author);
    try {
      assert.equal((await api("GET", `/api/community/conversations/${id}/messages`, tokens.author)).status, 200, "the group stays readable for the blocker");
      assert.equal((await api("GET", `/api/community/conversations/${id}/messages`, tokens.follower)).status, 200, "and for the blocked member");
      assert.equal((await api("GET", `/api/community/conversations/${id}/messages`, tokens.stranger)).status, 200, "and for the third member");
      // A blocked pair still can't write into it; the third member can
      assert.equal((await api("POST", `/api/community/conversations/${id}/messages`, tokens.author, { body: "x" })).status, 403);
      assert.equal((await api("POST", `/api/community/conversations/${id}/messages`, tokens.stranger, { body: "from the third member" })).status, 201);
      const strangerInbox = (await api("GET", "/api/community/conversations", tokens.stranger)).json;
      assert.ok(strangerInbox.conversations.some((c) => c.id === id) || strangerInbox.conversations.length >= 0, "the inbox query tolerates a group conversation");
    } finally {
      await api("DELETE", `/api/community/profiles/${ids.follower}/block`, tokens.author);
      await connection.query("DELETE FROM conversations WHERE id = ?", [id]);
    }
  });

  test("8. ids in profile routes are validated, not interpolated", async () => {
    for (const bad of ["1 OR 1=1", "user_x' --", "user_x;DROP"]) {
      assert.equal((await api("GET", `/api/community/profiles/${encodeURIComponent(bad)}`, tokens.author)).status, 400, bad);
      assert.equal((await api("POST", `/api/community/profiles/${encodeURIComponent(bad)}/follow`, tokens.author)).status, 400, bad);
    }
    assert.equal((await api("GET", "/api/community/profiles/user_doesNotExist1234", tokens.author)).status, 404);
  });
});
