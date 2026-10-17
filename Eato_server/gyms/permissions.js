// Who may do what in a gym. Pure functions of the gym's settings and the caller's membership
// (no database, no Clerk), so every rule is unit-tested (__tests__/gym-permissions.test.js).
// The routes load the membership from gym_members for the verified caller and ask these; a
// role is only counted while the membership is active.
//
// Roles, most senior first: owner > admin > trainer > member.
//   staff  = owner, admin, trainer (invite people, see and approve held posts)
//   admins = owner, admin         (manage the gym, its members, settings and announcements)

const ROLES = ["owner", "admin", "trainer", "member"];
const RANK = { owner: 0, admin: 1, trainer: 2, member: 3 };

// The caller's role in the gym, only while their membership is active (else null)
const activeRole = (membership) => (membership && membership.status === "active" ? membership.role : null);

const isStaff = (role) => role === "owner" || role === "admin" || role === "trainer";
const isAdmin = (role) => role === "owner" || role === "admin";

// Joining: instant, or a request staff approve. Private gyms always need approval.
function joinMode(gym) {
  return gym.member_approval || gym.visibility === "private" ? "request" : "join";
}

// Reading the feed, members, events and announcements: active members, or anyone for a public gym
function canViewContent(gym, membership) {
  return activeRole(membership) !== null || gym.visibility === "public";
}

// Whether the gym shows up at all (its name and About): hidden gyms only to members, including
// a pending or suspended one (they can see where they stand). Invite codes reach it separately.
function canSeeGym(gym, membership) {
  return gym.visibility !== "hidden" || Boolean(membership);
}

// The three community settings, each with the same shape: who is allowed
function canPost(gym, membership) {
  const role = activeRole(membership);
  if (!role) return false;
  if (gym.who_can_post === "everyone") return true;
  if (gym.who_can_post === "trainers") return isStaff(role);
  return isAdmin(role);
}

function canComment(gym, membership) {
  const role = activeRole(membership);
  if (!role) return false;
  if (gym.who_can_comment === "members") return true;
  if (gym.who_can_comment === "trainers") return isStaff(role);
  return isAdmin(role); // "off": only admins can still reply
}

function canCreateEvents(gym, membership) {
  const role = activeRole(membership);
  if (!role) return false;
  if (gym.who_can_create_events === "members") return true;
  if (gym.who_can_create_events === "trainers") return isStaff(role);
  return isAdmin(role);
}

// A new post from this member is held for review when post moderation is on (staff skip it)
function postNeedsReview(gym, membership) {
  return Boolean(gym.post_moderation) && !isStaff(activeRole(membership));
}

const canInvite = (membership) => isStaff(activeRole(membership));
const canManage = (membership) => isAdmin(activeRole(membership));
const canModerate = (membership) => isStaff(activeRole(membership));

// Roles an invitation may grant: members invite nobody; trainers invite members; admins also trainers
function invitableRoles(membership) {
  const role = activeRole(membership);
  if (isAdmin(role)) return ["member", "trainer"];
  if (role === "trainer") return ["member"];
  return [];
}

// Changing another member: approve (pending → active), suspend, change role, or remove.
// - Only admins act on members, and nobody acts on the owner or on themselves here.
// - An admin acts on trainers and members only; the owner on everyone else.
// - Nobody grants "owner" (ownership is set when a platform admin creates the gym).
// - Only the owner grants "admin".
// Returns null when allowed, or the reason it isn't.
function memberChangeRefusal(actor, target, change) {
  const actorRole = activeRole(actor);
  if (!isAdmin(actorRole)) return "Only gym admins can manage members.";
  if (!target) return "That member isn't in this gym.";
  if (target.user_id === actor.user_id) return "You can't change your own membership here.";
  if (target.role === "owner") return "The owner's membership can't be changed.";
  if (actorRole === "admin" && target.role === "admin") return "Only the owner can change another admin.";
  if (change.role !== undefined) {
    if (!ROLES.includes(change.role) || change.role === "owner") return "That role can't be given.";
    if (change.role === "admin" && actorRole !== "owner") return "Only the owner can make someone an admin.";
  }
  return null;
}

// Leaving: anyone but the owner (a gym always keeps its owner)
const canLeave = (membership) => Boolean(membership) && membership.role !== "owner";

module.exports = {
  ROLES, RANK, activeRole, isStaff, isAdmin, joinMode, canViewContent, canSeeGym,
  canPost, canComment, canCreateEvents, postNeedsReview, canInvite, canManage, canModerate,
  invitableRoles, memberChangeRefusal, canLeave,
};
