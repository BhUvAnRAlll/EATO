// Authenticated tests for the Create Post types: real Clerk development identities against the
// real Express server and the isolated `eato_test` database. Covers each type's details,
// location, tagging (accepted friends only, all or nothing), polls and votes (one per member,
// options checked, hidden polls stay hidden), edits that keep a type's rules, and that deleting
// a member leaves no orphaned tags, options or votes.
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
const COMMUNITY_TABLES = ["community_poll_votes", "community_poll_options", "community_post_tags", "community_reports", "community_comments",
  "community_post_likes", "community_post_media", "community_posts", "community_media", "community_friendships", "community_profiles"];

describe("community post types e2e: details, tags, polls and votes", () => {
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
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag) => {
    const identity = await clerk.createIdentity(runId, tag, {});
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  // Friendships are stored once per pair, lowest id first (as friendRules.pairOf orders them)
  const befriend = async (a, b, status) => {
    const [low, high] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    await connection.query("INSERT INTO community_friendships (user_low, user_high, requester_id, status) VALUES (?, ?, ?, ?)", [low, high, a, status]);
  };
  const create = (token, body) => api("POST", "/api/community/posts", token, body);
  const postCount = async (body) => (await connection.query("SELECT COUNT(*) AS n FROM community_posts WHERE body = ?", [body]))[0][0].n;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-post-types-uploads-"));
    server = await startTestServer({ ...env, UPLOAD_DIR: uploadDir });
    try {
      for (const tag of ["author", "friend", "pending", "stranger"]) await newIdentity(tag);
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `Member ${tag}`]);
    }
    await befriend(ids.author, ids.friend, "accepted");
    await befriend(ids.author, ids.pending, "pending");
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

  test("1. a progress post keeps its title, milestone, date, location and tagged friend", async () => {
    const result = await create(tokens.author, {
      category: "progress", body: "Twelve weeks into my cut.", headline: "Week 12 check-in", detail: "-6 kg, deadlift up 10 kg",
      detailDate: "2026-10-01", location: "Cult, Indiranagar", taggedUserIds: [ids.friend],
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    const post = result.json.post;
    assert.deepEqual(
      [post.category, post.headline, post.detail, post.detailDate, post.location, post.mealKcal],
      ["progress", "Week 12 check-in", "-6 kg, deadlift up 10 kg", "2026-10-01", "Cult, Indiranagar", null],
    );
    assert.deepEqual(post.tagged.map((m) => m.id), [ids.friend]);
    assert.equal(post.tagged[0].name, "Member friend");
    assert.equal(post.poll, null);
    state.progress = post.id;
    // The friend sees the same post and its tag in the feed
    const feed = (await api("GET", "/api/community/feed?limit=50", tokens.friend)).json.posts;
    assert.deepEqual(feed.find((p) => p.id === post.id).tagged.map((m) => m.id), [ids.friend]);
  });

  test("2. only accepted friends can be tagged, and a refused tag saves nothing", async () => {
    for (const [who, label] of [[ids.stranger, "a stranger"], [ids.pending, "a pending request"], [ids.author, "yourself"]]) {
      const body = `Tag attempt: ${label}`;
      const result = await create(tokens.author, { body, taggedUserIds: [ids.friend, who] });
      assert.equal(result.status, 400, `${label}: ${JSON.stringify(result.json)}`);
      assert.match(result.json.error, /only tag your friends/);
      assert.equal(await postCount(body), 0, `${label}: rolled back, no post`);
    }
    const injected = await create(tokens.author, { body: "x", taggedUserIds: ["user_x' OR '1'='1"] });
    assert.equal(injected.status, 400);
    const [[tags]] = await connection.query("SELECT COUNT(*) AS n FROM community_post_tags");
    assert.equal(tags.n, 1, "only the tag from test 1");
  });

  test("3. meal, achievement, question and photo posts: each type's own details and rules", async () => {
    const meal = await create(tokens.author, { category: "meal", headline: "Paneer tikka bowl", mealKcal: 540, mealProteinG: 38 });
    assert.equal(meal.status, 201, JSON.stringify(meal.json));
    assert.deepEqual([meal.json.post.body, meal.json.post.headline, meal.json.post.mealKcal, meal.json.post.mealProteinG], ["", "Paneer tikka bowl", 540, 38]);
    assert.equal((await create(tokens.author, { category: "meal", headline: "Bowl", detail: "nope" })).status, 400, "a meal has no description");
    assert.equal((await create(tokens.author, { category: "meal", headline: "Bowl", mealKcal: 99999 })).status, 400);
    const achievement = await create(tokens.author, { category: "achievement", headline: "First pull-up", detail: "Six months of trying" });
    assert.equal(achievement.json.post.detail, "Six months of trying");
    assert.equal((await create(tokens.author, { category: "question" })).status, 400, "a question needs its text");
    assert.equal((await create(tokens.author, { category: "photo", body: "No photo" })).status, 400, "a photo post needs a photo");
    const upload = await api("POST", "/api/community/media", tokens.author, { data: TINY_PNG, mediaType: "image/png" });
    const photo = await create(tokens.author, { category: "photo", mediaIds: [upload.json.media.id] });
    assert.equal(photo.status, 201, JSON.stringify(photo.json));
    state.photo = photo.json.post.id;
    state.meal = meal.json.post.id;
    // Someone else's photo can't be posted
    const theirs = await api("POST", "/api/community/media", tokens.friend, { data: TINY_PNG, mediaType: "image/png" });
    assert.notEqual((await create(tokens.author, { category: "photo", mediaIds: [theirs.json.media.id] })).status, 201);
  });

  test("4. a poll: options in order, one vote per member that can move, counts and myVote per viewer", async () => {
    const result = await create(tokens.author, { category: "poll", body: "Best leg day finisher?", pollOptions: ["Walking lunges", "Wall sit", "Sled push"] });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    const poll = result.json.post.poll;
    assert.deepEqual(poll.options.map((o) => [o.label, o.votes]), [["Walking lunges", 0], ["Wall sit", 0], ["Sled push", 0]]);
    assert.deepEqual([poll.totalVotes, poll.myVote], [0, null]);
    state.poll = result.json.post.id;
    const [lunges, wallSit] = poll.options;

    const voted = await api("POST", `/api/community/posts/${state.poll}/vote`, tokens.friend, { optionId: lunges.id });
    assert.equal(voted.status, 200, JSON.stringify(voted.json));
    assert.deepEqual([voted.json.post.poll.myVote, voted.json.post.poll.totalVotes, voted.json.post.poll.options[0].votes], [lunges.id, 1, 1]);
    // Voting again moves the vote; still one row
    const moved = await api("POST", `/api/community/posts/${state.poll}/vote`, tokens.friend, { optionId: wallSit.id });
    assert.deepEqual(moved.json.post.poll.options.map((o) => o.votes), [0, 1, 0]);
    const [[rows]] = await connection.query("SELECT COUNT(*) AS n FROM community_poll_votes WHERE post_id = ? AND user_id = ?", [state.poll, ids.friend]);
    assert.equal(rows.n, 1);
    // The author sees the count but not someone else's vote as theirs
    const asAuthor = (await api("GET", `/api/community/posts/${state.poll}`, tokens.author)).json.post.poll;
    assert.deepEqual([asAuthor.totalVotes, asAuthor.myVote], [1, null]);
  });

  test("5. votes are refused for a wrong option, a non-poll, a hidden poll, a bad id or no session", async () => {
    const other = await create(tokens.author, { category: "poll", body: "Another poll", pollOptions: ["Yes", "No"] });
    const foreignOption = other.json.post.poll.options[0].id;
    const vote = (token, postId, body) => api("POST", `/api/community/posts/${postId}/vote`, token, body);
    assert.equal((await vote(tokens.friend, state.poll, { optionId: foreignOption })).status, 400, "another poll's option");
    assert.equal((await vote(tokens.friend, state.meal, { optionId: foreignOption })).status, 400, "not a poll");
    assert.equal((await vote(tokens.friend, state.poll, { optionId: "1 OR 1=1" })).status, 400);
    assert.equal((await vote(tokens.friend, state.poll, { optionId: foreignOption, userId: ids.author })).status, 400, "no identity in the body");
    assert.equal((await vote(null, state.poll, { optionId: foreignOption })).status, 401);
    const hidden = await create(tokens.author, { category: "poll", body: "Only me poll", audience: "only_me", pollOptions: ["A", "B"] });
    assert.equal((await vote(tokens.stranger, hidden.json.post.id, { optionId: hidden.json.post.poll.options[0].id })).status, 404, "a hidden poll doesn't exist to them");
    const [[votes]] = await connection.query("SELECT COUNT(*) AS n FROM community_poll_votes WHERE post_id IN (?, ?)", [other.json.post.id, hidden.json.post.id]);
    assert.equal(votes.n, 0);
  });

  test("6. edits keep each type's rules; only the author edits", async () => {
    const patch = (token, postId, body) => api("PATCH", `/api/community/posts/${postId}`, token, body);
    const edited = await patch(tokens.author, state.progress, { headline: "Week 13 check-in", location: "" });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.deepEqual([edited.json.post.headline, edited.json.post.detail, edited.json.post.location], ["Week 13 check-in", "-6 kg, deadlift up 10 kg", null], "other details kept");
    assert.equal((await patch(tokens.author, state.progress, { mealKcal: 300 })).status, 400, "a progress post has no calories");
    assert.equal((await patch(tokens.author, state.photo, { category: "general" })).status, 400, "a photo post keeps its type");
    assert.equal((await patch(tokens.author, state.photo, { mediaIds: [] })).status, 400, "a photo post keeps a photo");
    assert.equal((await patch(tokens.author, state.poll, { category: "general" })).status, 400);
    assert.equal((await patch(tokens.author, state.poll, { pollOptions: ["x", "y"] })).status, 400);
    assert.equal((await patch(tokens.author, state.progress, { taggedUserIds: [] })).status, 400);
    // A meal turned into a general post loses the meal's details
    const general = await patch(tokens.author, state.meal, { category: "general", body: "Lunch" });
    assert.equal(general.status, 200, JSON.stringify(general.json));
    assert.deepEqual([general.json.post.headline, general.json.post.mealKcal], [null, null]);
    assert.equal((await patch(tokens.friend, state.progress, { headline: "hijack" })).status, 403);
  });

  test("6b. a profile's Tagged list: posts that tag that member, as each viewer may see them", async () => {
    const tagged = (await api("GET", `/api/community/profiles/${ids.friend}/tagged`, tokens.stranger)).json.posts.map((p) => p.id);
    assert.deepEqual(tagged, [state.progress], "the public progress post that tags the friend");
    assert.deepEqual((await api("GET", `/api/community/profiles/${ids.author}/tagged`, tokens.friend)).json.posts, [], "nobody tagged the author");
    // An only-me post that tags the friend stays hidden from everyone but its author
    const hidden = await create(tokens.author, { body: "Just for me", audience: "only_me", taggedUserIds: [ids.friend] });
    assert.equal(hidden.status, 201, JSON.stringify(hidden.json));
    const asStranger = (await api("GET", `/api/community/profiles/${ids.friend}/tagged`, tokens.stranger)).json.posts.map((p) => p.id);
    assert.equal(asStranger.includes(hidden.json.post.id), false);
    const asAuthor = (await api("GET", `/api/community/profiles/${ids.friend}/tagged`, tokens.author)).json.posts.map((p) => p.id);
    assert.equal(asAuthor.includes(hidden.json.post.id), true);
    assert.equal((await api("GET", "/api/community/profiles/user_x'%20OR%201=1/tagged", tokens.author)).status, 400);
    assert.equal((await api("GET", `/api/community/profiles/${ids.friend}/tagged`, null)).status, 401);
    // A block either way shuts the list, as it does the member's own posts
    assert.equal((await api("POST", `/api/community/profiles/${ids.stranger}/block`, tokens.friend)).status, 200);
    const blocked = await api("GET", `/api/community/profiles/${ids.friend}/tagged`, tokens.stranger);
    assert.equal(blocked.status, 403);
    assert.equal(JSON.stringify(blocked.json).includes(state.progress), false);
    assert.equal((await api("GET", `/api/community/profiles/${ids.friend}/posts`, tokens.stranger)).status, 403, "the same answer as the posts route");
    await api("DELETE", `/api/community/profiles/${ids.stranger}/block`, tokens.friend);
  });

  test("7. deleting a member leaves no orphaned tags, options or votes", async () => {
    // The friend (tagged on a post, with a vote) leaves: their tag and vote go with them
    await db.deleteUsers(connection, [ids.friend]);
    const [[tags]] = await connection.query("SELECT COUNT(*) AS n FROM community_post_tags WHERE user_id = ?", [ids.friend]);
    const [[votes]] = await connection.query("SELECT COUNT(*) AS n FROM community_poll_votes WHERE user_id = ?", [ids.friend]);
    assert.deepEqual([tags.n, votes.n], [0, 0]);
    // The author leaves: their posts, and those posts' options, go too
    await db.deleteUsers(connection, [ids.author]);
    const [[orphans]] = await connection.query(`
      SELECT (SELECT COUNT(*) FROM community_poll_options o LEFT JOIN community_posts p ON p.id = o.post_id WHERE p.id IS NULL)
           + (SELECT COUNT(*) FROM community_post_tags t LEFT JOIN community_posts p ON p.id = t.post_id WHERE p.id IS NULL)
           + (SELECT COUNT(*) FROM community_poll_votes v LEFT JOIN community_posts p ON p.id = v.post_id WHERE p.id IS NULL) AS n`);
    assert.equal(orphans.n, 0);
  });
});
