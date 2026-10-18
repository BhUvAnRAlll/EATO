// HTTP routes for the community, mounted at /api/community in index.js behind requireUser
// and the per-user rate limit. Each handler validates its input, calls the module that
// owns the data, and hands any error to the shared handler (which maps the status codes
// set here and logs only safe fields).
const express = require("express");

const { requireAdmin } = require("../auth");
const { jsonBodyWithLimit } = require("../requestBody");
const { uploadLimits } = require("../bodyComposition/upload");
const { ensureUser, currentRole } = require("./members");
const media = require("./media");
const posts = require("./posts");
const stories = require("./stories");
const messages = require("./messages");
const profiles = require("./profiles");
const friends = require("./friends");
const notifications = require("./notifications");
const gyms = require("../gyms/gyms");
const { isSuspended } = require("./visibility");
const v = require("./validate");

const router = express.Router();
const smallBody = express.json({ limit: "20kb" });
// The largest body an image upload needs: the biggest allowed image as base64 plus the JSON around it
const imageBody = jsonBodyWithLimit(Math.ceil(uploadLimits.maxImageBytes * (4 / 3)) + 1024);

// Wraps an async handler so a thrown error reaches the error handler
const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const page = (req) => ({ cursor: v.decodeCursor(req.query.cursor), limit: v.pageSize(req.query.limit) });

// A write needs a users row for the caller (created from Clerk on the first write), and a
// suspended member can read but not write
const withUser = route(async (req, res, next) => {
  const pool = req.app.locals.pool;
  await ensureUser(pool, req.userId);
  if (await isSuspended(pool, req.userId)) return res.status(403).json({ error: "Your community access is suspended." });
  next();
});
// A Clerk user id in the route (never interpolated; checked so bad ids are a 400)
const memberId = (req) => v.clerkUserId(req.params.userId, "The member");

// ---- media -----------------------------------------------------------------------

router.post("/media", imageBody, withUser, route(async (req, res) => {
  res.status(201).json({ media: await media.storeImage(req.app.locals.pool, req.userId, req.body) });
}));

// ---- feed and posts ---------------------------------------------------------------

router.get("/feed", route(async (req, res) => {
  res.json(await posts.listPosts(req.app.locals.pool, req.userId, page(req)));
}));

router.post("/posts", smallBody, withUser, route(async (req, res) => {
  res.status(201).json({ post: await posts.createPost(req.app.locals.pool, req.userId, v.validatePost(req.body)) });
}));

router.get("/posts/:postId", route(async (req, res) => {
  res.json({ post: await posts.getPost(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post")) });
}));

router.patch("/posts/:postId", smallBody, withUser, route(async (req, res) => {
  res.json({ post: await posts.updatePost(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post"), v.validatePostUpdate(req.body)) });
}));

router.delete("/posts/:postId", route(async (req, res) => {
  const pool = req.app.locals.pool;
  await posts.deletePost(pool, req.userId, await currentRole(req.userId), v.id(req.params.postId, "The post"));
  res.json({ deleted: true });
}));

// A poll vote (one per member; voting again moves it). Answers with the post and its counts.
router.post("/posts/:postId/vote", smallBody, withUser, route(async (req, res) => {
  const { optionId } = v.validateVote(req.body);
  res.json({ post: await posts.votePoll(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post"), optionId) });
}));

router.post("/posts/:postId/like", withUser, route(async (req, res) => {
  res.json(await posts.setLike(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post"), true));
}));

router.delete("/posts/:postId/like", route(async (req, res) => {
  res.json(await posts.setLike(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post"), false));
}));

router.get("/posts/:postId/comments", route(async (req, res) => {
  res.json(await posts.listComments(req.app.locals.pool, req.userId, v.id(req.params.postId, "The post"), page(req)));
}));

router.post("/posts/:postId/comments", smallBody, withUser, route(async (req, res) => {
  const pool = req.app.locals.pool;
  const postId = v.id(req.params.postId, "The post");
  const values = v.validateComment(req.body);
  // A gym post follows its gym's comment setting (who may comment)
  const post = await posts.getPost(pool, req.userId, postId);
  if (post.gymId) await gyms.assertCanComment(pool, req.userId, post.gymId);
  res.status(201).json(await posts.createComment(pool, req.userId, postId, values, { visible: post }));
}));

router.delete("/comments/:commentId", route(async (req, res) => {
  const pool = req.app.locals.pool;
  res.json(await posts.deleteComment(pool, req.userId, await currentRole(req.userId), v.id(req.params.commentId, "The comment")));
}));

router.post("/posts/:postId/report", smallBody, withUser, route(async (req, res) => {
  res.status(201).json(await posts.reportContent(req.app.locals.pool, req.userId, { postId: v.id(req.params.postId, "The post") }, v.validateReport(req.body)));
}));

router.post("/comments/:commentId/report", smallBody, withUser, route(async (req, res) => {
  res.status(201).json(await posts.reportContent(req.app.locals.pool, req.userId, { commentId: v.id(req.params.commentId, "The comment") }, v.validateReport(req.body)));
}));

// Admins: open reports and their resolution
router.get("/reports", requireAdmin, route(async (req, res) => {
  res.json({ reports: await posts.listReports(req.app.locals.pool) });
}));

router.get("/reports/:reportId", requireAdmin, route(async (req, res) => {
  res.json({ report: await posts.getReport(req.app.locals.pool, v.id(req.params.reportId, "The report")) });
}));

// The photo a report is about, for the admin reviewing it: served even if the post or story
// was deleted (until the retention clean-up), never cached, and only for that report's photo
router.get("/reports/:reportId/media", requireAdmin, route(async (req, res) => {
  const pool = req.app.locals.pool;
  const mediaId = await posts.reportEvidenceMediaId(pool, v.id(req.params.reportId, "The report"));
  const row = mediaId ? await media.getMedia(pool, mediaId) : null;
  if (!row) return res.status(404).json({ error: "Not found." });
  res.set("Cache-Control", "private, no-store");
  res.type(row.media_type);
  res.sendFile(media.pathFor(row), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Not found." });
  });
}));

router.post("/reports/:reportId/resolve", requireAdmin, smallBody, route(async (req, res) => {
  res.json(await posts.resolveReport(req.app.locals.pool, v.id(req.params.reportId, "The report"), req.body?.status));
}));

// ---- stories ----------------------------------------------------------------------

router.get("/stories", route(async (req, res) => {
  res.json({ members: await stories.listStories(req.app.locals.pool, req.userId) });
}));

// 201 for a new story; 200 with the same story when this photo was already published
router.post("/stories", smallBody, withUser, route(async (req, res) => {
  const { story, created } = await stories.createStory(req.app.locals.pool, req.userId, v.validateStory(req.body));
  res.status(created ? 201 : 200).json({ story });
}));

router.post("/stories/:storyId/view", withUser, route(async (req, res) => {
  res.json(await stories.viewStory(req.app.locals.pool, req.userId, v.id(req.params.storyId, "The story")));
}));

router.post("/stories/:storyId/report", smallBody, withUser, route(async (req, res) => {
  res.status(201).json(await stories.reportStory(req.app.locals.pool, req.userId, v.id(req.params.storyId, "The story"), v.validateReport(req.body)));
}));

router.delete("/stories/:storyId", route(async (req, res) => {
  const pool = req.app.locals.pool;
  await stories.deleteStory(pool, req.userId, await currentRole(req.userId), v.id(req.params.storyId, "The story"));
  res.json({ deleted: true });
}));

// ---- friends ------------------------------------------------------------------------
// Always the caller's own friendships: the other member is the route id, the caller is the
// verified session. Sending repeats safely; answering only works for the member asked.

router.get("/friends", route(async (req, res) => {
  res.json({ friends: await friends.listFriends(req.app.locals.pool, req.userId) });
}));

router.get("/friends/requests", route(async (req, res) => {
  res.json(await friends.listRequests(req.app.locals.pool, req.userId));
}));

// Name search, or suggestions when there's no search
router.get("/friends/search", route(async (req, res) => {
  res.json({ members: await friends.searchMembers(req.app.locals.pool, req.userId, { search: v.searchTerm(req.query.search) }) });
}));

router.post("/friends/:userId/request", withUser, route(async (req, res) => {
  res.json(await friends.sendRequest(req.app.locals.pool, req.userId, memberId(req)));
}));

router.delete("/friends/:userId/request", route(async (req, res) => {
  res.json(await friends.cancelRequest(req.app.locals.pool, req.userId, memberId(req)));
}));

router.post("/friends/:userId/accept", withUser, route(async (req, res) => {
  res.json(await friends.answerRequest(req.app.locals.pool, req.userId, memberId(req), true));
}));

router.post("/friends/:userId/decline", route(async (req, res) => {
  res.json(await friends.answerRequest(req.app.locals.pool, req.userId, memberId(req), false));
}));

router.delete("/friends/:userId", route(async (req, res) => {
  res.json(await friends.removeFriend(req.app.locals.pool, req.userId, memberId(req)));
}));

// ---- profiles, following, blocking ------------------------------------------------

router.get("/me", route(async (req, res) => {
  res.json({ profile: await profiles.getProfile(req.app.locals.pool, req.userId, req.userId) });
}));

router.patch("/me", smallBody, withUser, route(async (req, res) => {
  res.json({ profile: await profiles.updateOwnProfile(req.app.locals.pool, req.userId, v.validateProfileSettings(req.body)) });
}));

router.get("/me/follow-requests", route(async (req, res) => {
  res.json({ requests: await profiles.listFollowRequests(req.app.locals.pool, req.userId) });
}));

router.post("/me/follow-requests/:userId/accept", withUser, route(async (req, res) => {
  res.json(await profiles.answerFollowRequest(req.app.locals.pool, req.userId, memberId(req), true));
}));

router.post("/me/follow-requests/:userId/decline", withUser, route(async (req, res) => {
  res.json(await profiles.answerFollowRequest(req.app.locals.pool, req.userId, memberId(req), false));
}));

// The caller's Close Friends (and the followers they can add). Only ever the caller's own list.
router.get("/me/close-friends", route(async (req, res) => {
  res.json({ members: await profiles.listCloseFriends(req.app.locals.pool, req.userId) });
}));

router.put("/me/close-friends/:userId", withUser, route(async (req, res) => {
  res.json(await profiles.addCloseFriend(req.app.locals.pool, req.userId, memberId(req)));
}));

router.delete("/me/close-friends/:userId", route(async (req, res) => {
  res.json(await profiles.removeCloseFriend(req.app.locals.pool, req.userId, memberId(req)));
}));

router.get("/me/blocked", route(async (req, res) => {
  res.json({ members: await profiles.listBlocked(req.app.locals.pool, req.userId) });
}));

router.get("/notifications", route(async (req, res) => {
  res.json(await notifications.listNotifications(req.app.locals.pool, req.userId));
}));

router.get("/profiles/:userId", route(async (req, res) => {
  res.json({ profile: await profiles.getProfile(req.app.locals.pool, req.userId, memberId(req)) });
}));

// A member's posts the viewer may see (403 for a private account the viewer doesn't follow)
router.get("/profiles/:userId/posts", route(async (req, res) => {
  res.json(await posts.listPosts(req.app.locals.pool, req.userId, { authorId: memberId(req), ...page(req) }));
}));

// Posts that tag this member (the profile's Tagged tab)
router.get("/profiles/:userId/tagged", route(async (req, res) => {
  res.json(await posts.listPosts(req.app.locals.pool, req.userId, { taggedId: memberId(req), ...page(req) }));
}));

router.post("/profiles/:userId/follow", withUser, route(async (req, res) => {
  res.json({ profile: await profiles.follow(req.app.locals.pool, req.userId, memberId(req)) });
}));

router.delete("/profiles/:userId/follow", route(async (req, res) => {
  res.json({ profile: await profiles.unfollow(req.app.locals.pool, req.userId, memberId(req)) });
}));

router.post("/profiles/:userId/block", withUser, route(async (req, res) => {
  res.json(await profiles.block(req.app.locals.pool, req.userId, memberId(req)));
}));

router.delete("/profiles/:userId/block", route(async (req, res) => {
  res.json(await profiles.unblock(req.app.locals.pool, req.userId, memberId(req)));
}));

// Admins: who is suspended, and suspend or reinstate a member's community presence
router.get("/admin/members/suspended", requireAdmin, route(async (req, res) => {
  res.json({ members: await profiles.listSuspended(req.app.locals.pool) });
}));

router.post("/admin/members/:userId/suspend", requireAdmin, route(async (req, res) => {
  res.json(await profiles.setSuspended(req.app.locals.pool, memberId(req), true));
}));

router.delete("/admin/members/:userId/suspend", requireAdmin, route(async (req, res) => {
  res.json(await profiles.setSuspended(req.app.locals.pool, memberId(req), false));
}));

// ---- messages ---------------------------------------------------------------------

router.get("/conversations", route(async (req, res) => {
  const pool = req.app.locals.pool;
  res.json({ conversations: await messages.listConversations(pool, req.userId), unreadCount: await messages.unreadCount(pool, req.userId) });
}));

router.post("/conversations", smallBody, withUser, route(async (req, res) => {
  const otherId = v.clerkUserId(req.body?.userId, "The member");
  res.json({ conversation: await messages.openConversation(req.app.locals.pool, req.userId, otherId) });
}));

router.get("/conversations/:conversationId/messages", route(async (req, res) => {
  res.json(await messages.listMessages(req.app.locals.pool, req.userId, v.id(req.params.conversationId, "The conversation"), page(req)));
}));

router.post("/conversations/:conversationId/messages", smallBody, route(async (req, res) => {
  res.status(201).json({ message: await messages.sendMessage(req.app.locals.pool, req.userId, v.id(req.params.conversationId, "The conversation"), v.validateMessage(req.body)) });
}));

// Whether the viewer may see the image through the general media route: their own upload
// that isn't attached to anything yet, a visible post or story (the owner always sees their
// own live content through those rules), or a gym logo or cover. Nobody gets deleted or ended
// content here, owners and admins included; moderators use the report evidence route
// (GET /reports/:reportId/media), which is admin-only and tied to one report.
async function canSeeMedia(pool, userId, mediaRow) {
  if (mediaRow.user_id === userId && (await media.isUnattached(pool, mediaRow.id))) return true;
  if (await gyms.canSeeGymMedia(pool, userId, mediaRow.id)) return true;
  if (await posts.canSeePostMedia(pool, userId, mediaRow.id)) return true;
  return stories.canSeeStoryMedia(pool, userId, mediaRow.id);
}

module.exports = { communityRouter: router, canSeeMedia };
