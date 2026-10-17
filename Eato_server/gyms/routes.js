// HTTP routes for gym communities, mounted at /api/gyms in index.js behind requireUser and
// the per-user rate limit. Each handler validates its input, then calls gyms.js, which loads
// the verified caller's membership and checks permissions.js. The caller is always
// req.userId; ids in the body are never trusted (the route ids name the gym and the target).
const express = require("express");

const { requireAdmin } = require("../auth");
const { ValidationError } = require("../profile");
const { ensureUser } = require("../community/members");
const { isSuspended } = require("../community/visibility");
const cv = require("../community/validate");
const v = require("./validate");
const gyms = require("./gyms");

const router = express.Router();
const smallBody = express.json({ limit: "20kb" });

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const pool = (req) => req.app.locals.pool;
const gymId = (req) => cv.id(req.params.gymId, "The gym");
const page = (req) => ({ cursor: cv.decodeCursor(req.query.cursor), limit: cv.pageSize(req.query.limit) });

// A write needs a users row, and a member suspended from the community can't write in a gym either
const withUser = route(async (req, res, next) => {
  await ensureUser(pool(req), req.userId);
  if (await isSuspended(pool(req), req.userId)) return res.status(403).json({ error: "Your community access is suspended." });
  next();
});

// ---- gyms ----------------------------------------------------------------------------

router.get("/", route(async (req, res) => {
  res.json(await gyms.listGyms(pool(req), req.userId, { search: cv.searchTerm(req.query.search) }));
}));

// Platform admins create a gym and name its owner
router.post("/", requireAdmin, smallBody, route(async (req, res) => {
  res.status(201).json({ gym: await gyms.createGym(pool(req), req.userId, v.validateGymCreate(req.body)) });
}));

// Platform admins: every gym, hidden ones included
router.get("/admin/all", requireAdmin, route(async (req, res) => {
  res.json({ gyms: await gyms.listAllGyms(pool(req)) });
}));

// Codes: the gym's own code or a staff invitation
router.get("/codes/:code", route(async (req, res) => {
  res.json(await gyms.previewCode(pool(req), req.userId, v.inviteCode(req.params.code)));
}));

router.post("/join-by-code", smallBody, withUser, route(async (req, res) => {
  cv.rejectUnknownKeys(cv.requireObject(req.body, "code"), ["code"], "The request");
  res.json({ gym: await gyms.joinByCode(pool(req), req.userId, v.inviteCode(req.body.code)) });
}));

router.get("/:gymId", route(async (req, res) => {
  res.json({ gym: await gyms.getGym(pool(req), req.userId, gymId(req)) });
}));

router.patch("/:gymId", smallBody, withUser, route(async (req, res) => {
  res.json({ gym: await gyms.updateProfile(pool(req), req.userId, gymId(req), v.validateGymProfile(req.body)) });
}));

router.patch("/:gymId/settings", smallBody, withUser, route(async (req, res) => {
  res.json({ gym: await gyms.updateSettings(pool(req), req.userId, gymId(req), v.validateGymSettings(req.body)) });
}));

router.post("/:gymId/code/rotate", withUser, route(async (req, res) => {
  res.json({ gym: await gyms.rotateCode(pool(req), req.userId, gymId(req)) });
}));

router.post("/:gymId/join", withUser, route(async (req, res) => {
  res.json({ gym: await gyms.join(pool(req), req.userId, gymId(req)) });
}));

router.delete("/:gymId/join", route(async (req, res) => {
  res.json(await gyms.leave(pool(req), req.userId, gymId(req)));
}));

// ---- members -------------------------------------------------------------------------

const MEMBER_LISTS = ["active", "pending", "suspended"];

router.get("/:gymId/members", route(async (req, res) => {
  const status = req.query.status ?? "active";
  if (!MEMBER_LISTS.includes(status)) throw new ValidationError(`status must be one of: ${MEMBER_LISTS.join(", ")}.`);
  res.json({ members: await gyms.listMembers(pool(req), req.userId, gymId(req), { status }) });
}));

router.patch("/:gymId/members/:userId", smallBody, withUser, route(async (req, res) => {
  const target = cv.clerkUserId(req.params.userId, "The member");
  res.json(await gyms.changeMember(pool(req), req.userId, gymId(req), target, v.validateMemberChange(req.body)));
}));

router.delete("/:gymId/members/:userId", route(async (req, res) => {
  res.json(await gyms.removeMember(pool(req), req.userId, gymId(req), cv.clerkUserId(req.params.userId, "The member")));
}));

// ---- posts ---------------------------------------------------------------------------

router.get("/:gymId/posts", route(async (req, res) => {
  res.json(await gyms.listGymPosts(pool(req), req.userId, gymId(req), page(req)));
}));

// The same post fields as the main feed; the gym comes from the route, never the body
router.post("/:gymId/posts", smallBody, withUser, route(async (req, res) => {
  const values = cv.validatePost(req.body);
  res.status(201).json({ post: await gyms.createGymPost(pool(req), req.userId, gymId(req), values) });
}));

router.post("/:gymId/posts/:postId/approve", withUser, route(async (req, res) => {
  res.json(await gyms.approvePost(pool(req), req.userId, gymId(req), cv.id(req.params.postId, "The post")));
}));

router.delete("/:gymId/posts/:postId", route(async (req, res) => {
  res.json(await gyms.removePost(pool(req), req.userId, gymId(req), cv.id(req.params.postId, "The post")));
}));

// ---- announcements -------------------------------------------------------------------

router.get("/:gymId/announcements", route(async (req, res) => {
  res.json({ announcements: await gyms.listAnnouncements(pool(req), req.userId, gymId(req)) });
}));

router.post("/:gymId/announcements", smallBody, withUser, route(async (req, res) => {
  res.status(201).json({ announcement: await gyms.createAnnouncement(pool(req), req.userId, gymId(req), v.validateAnnouncement(req.body)) });
}));

router.patch("/:gymId/announcements/:announcementId", smallBody, withUser, route(async (req, res) => {
  const id = cv.id(req.params.announcementId, "The announcement");
  res.json({ announcement: await gyms.updateAnnouncement(pool(req), req.userId, gymId(req), id, v.validateAnnouncement(req.body, { partial: true })) });
}));

router.delete("/:gymId/announcements/:announcementId", route(async (req, res) => {
  res.json(await gyms.deleteAnnouncement(pool(req), req.userId, gymId(req), cv.id(req.params.announcementId, "The announcement")));
}));

// ---- events --------------------------------------------------------------------------

router.get("/:gymId/events", route(async (req, res) => {
  res.json({ events: await gyms.listEvents(pool(req), req.userId, gymId(req)) });
}));

router.post("/:gymId/events", smallBody, withUser, route(async (req, res) => {
  res.status(201).json({ event: await gyms.createEvent(pool(req), req.userId, gymId(req), v.validateEvent(req.body, Date.now())) });
}));

router.delete("/:gymId/events/:eventId", route(async (req, res) => {
  res.json(await gyms.deleteEvent(pool(req), req.userId, gymId(req), cv.id(req.params.eventId, "The event")));
}));

router.post("/:gymId/events/:eventId/rsvp", withUser, route(async (req, res) => {
  res.json({ event: await gyms.setRsvp(pool(req), req.userId, gymId(req), cv.id(req.params.eventId, "The event"), true) });
}));

router.delete("/:gymId/events/:eventId/rsvp", route(async (req, res) => {
  res.json({ event: await gyms.setRsvp(pool(req), req.userId, gymId(req), cv.id(req.params.eventId, "The event"), false) });
}));

// ---- invitations ---------------------------------------------------------------------

router.get("/:gymId/invitations", route(async (req, res) => {
  res.json({ invitations: await gyms.listInvitations(pool(req), req.userId, gymId(req)) });
}));

router.post("/:gymId/invitations", smallBody, withUser, route(async (req, res) => {
  res.status(201).json({ invitation: await gyms.createInvitation(pool(req), req.userId, gymId(req), v.validateInvitation(req.body)) });
}));

for (const action of ["revoke", "renew"]) {
  router.post(`/:gymId/invitations/:invitationId/${action}`, withUser, route(async (req, res) => {
    const id = cv.id(req.params.invitationId, "The invitation");
    res.json({ invitation: await gyms.changeInvitation(pool(req), req.userId, gymId(req), id, action) });
  }));
}

module.exports = { gymsRouter: router };
