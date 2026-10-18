// Gym communities: the gyms, who belongs to them, joining (instant, by request, or with a
// code), member management, gym posts and their review, announcements, events with RSVPs,
// and invitations. Every function takes the verified caller's id and loads their membership
// itself; permissions/*.js decides from that. Anything the caller may not see answers like
// a missing gym (404), so hidden gyms can't be probed.
//
// member_count and attendee_count change only inside transactions that lock the row they
// count (gym or event FOR UPDATE), the same way community counts are kept.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const { memberSummary, ensureUser } = require("../community/members");
const { NotFoundError, ForbiddenError } = require("../community/posts");
const posts = require("../community/posts");
const { assertOwnMedia, mediaUrl } = require("../community/media");
const perms = require("./permissions");

const INVITE_DAYS = 14;
const GONE = "That gym doesn't exist.";

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};

// Codes people type: no 0/O or 1/I, so they read back cleanly
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(length) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Runs fn(connection) in one transaction
async function inTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const GYM_COLUMNS = `g.id, g.name, g.tagline, g.description, g.location, g.address, g.logo_media_id, g.cover_media_id,
  g.hours, g.facilities, g.membership_tiers, g.guidelines, g.contact_phone, g.contact_email, g.contact_website,
  g.invite_code, g.visibility, g.who_can_post, g.who_can_comment, g.who_can_create_events, g.member_approval,
  g.post_moderation, g.plan, g.member_count, g.created_at`;

async function loadGym(db, gymId, { lock = false } = {}) {
  const [rows] = await db.query(`SELECT ${GYM_COLUMNS} FROM gyms g WHERE g.id = ?${lock ? " FOR UPDATE" : ""}`, [gymId]);
  return rows[0] ?? null;
}

async function membershipOf(db, gymId, userId, { lock = false } = {}) {
  const [rows] = await db.query(`SELECT gym_id, user_id, role, status, joined_at FROM gym_members WHERE gym_id = ? AND user_id = ?${lock ? " FOR UPDATE" : ""}`, [gymId, userId]);
  return rows[0] ?? null;
}

// The gym and the caller's membership, or a 404 when the gym is missing or hidden from them
async function access(pool, gymId, userId) {
  const gym = await loadGym(pool, gymId);
  const membership = gym ? await membershipOf(pool, gymId, userId) : null;
  if (!gym || !perms.canSeeGym(gym, membership)) throw new NotFoundError(GONE);
  return { gym, membership };
}

// Reading the feed, members, events or announcements
async function readable(pool, gymId, userId) {
  const found = await access(pool, gymId, userId);
  if (!perms.canViewContent(found.gym, found.membership)) throw new ForbiddenError("Join this gym to see what members share.");
  return found;
}

function gymToApi(gym, membership) {
  const role = perms.activeRole(membership);
  return {
    id: gym.id,
    name: gym.name,
    tagline: gym.tagline,
    description: gym.description,
    location: gym.location,
    address: gym.address,
    logoUrl: mediaUrl(gym.logo_media_id),
    coverUrl: mediaUrl(gym.cover_media_id),
    hours: gym.hours ?? [],
    facilities: gym.facilities ?? [],
    membershipTiers: gym.membership_tiers ?? [],
    guidelines: gym.guidelines ?? [],
    contact: { phone: gym.contact_phone, email: gym.contact_email, website: gym.contact_website },
    visibility: gym.visibility,
    settings: {
      whoCanPost: gym.who_can_post,
      whoCanComment: gym.who_can_comment,
      whoCanCreateEvents: gym.who_can_create_events,
      memberApproval: Boolean(gym.member_approval),
      postModeration: Boolean(gym.post_moderation),
    },
    plan: gym.plan,
    memberCount: gym.member_count,
    // The shareable code is for staff (they invite people with it)
    inviteCode: perms.canInvite(membership) ? gym.invite_code : null,
    membership: membership ? { role: membership.role, status: membership.status } : null,
    joinMode: perms.joinMode(gym),
    can: {
      viewContent: perms.canViewContent(gym, membership),
      post: perms.canPost(gym, membership),
      comment: perms.canComment(gym, membership),
      createEvents: perms.canCreateEvents(gym, membership),
      invite: perms.canInvite(membership),
      manage: perms.canManage(membership),
      moderate: perms.canModerate(membership),
      leave: perms.canLeave(membership) && role !== null,
    },
  };
}

// ---- gyms ----------------------------------------------------------------------------

// The caller's gyms (any status), then the gyms they could find (not hidden), optionally by name or area
async function listGyms(pool, userId, { search = null }) {
  const params = [userId];
  let filter = "";
  if (search) {
    filter = " AND (g.name LIKE ? OR g.location LIKE ?)";
    params.push(`%${search}%`, `%${search}%`); // escaped for LIKE by validate.searchTerm
  }
  const [rows] = await pool.query(
    `SELECT ${GYM_COLUMNS}, m.role AS my_role, m.status AS my_status
     FROM gyms g LEFT JOIN gym_members m ON m.gym_id = g.id AND m.user_id = ?
     WHERE (g.visibility <> 'hidden' OR m.user_id IS NOT NULL)${filter}
     ORDER BY g.name LIMIT 100`,
    params,
  );
  const toApi = (row) => gymToApi(row, row.my_role ? { role: row.my_role, status: row.my_status, user_id: userId } : null);
  return {
    mine: rows.filter((row) => row.my_role).map(toApi).sort((a, b) => perms.RANK[a.membership.role] - perms.RANK[b.membership.role]),
    explore: rows.filter((row) => !row.my_role).map(toApi),
  };
}

async function getGym(pool, userId, gymId) {
  const { gym, membership } = await access(pool, gymId, userId);
  return gymToApi(gym, membership);
}

// Platform admins only (checked by the route). The owner is an existing account found by email.
async function createGym(pool, adminId, values) {
  await ensureUser(pool, adminId);
  const [owners] = await pool.query("SELECT id FROM users WHERE email = ?", [values.ownerEmail]);
  if (!owners[0]) throw new NotFoundError("No EATO account uses that owner email.");
  const ownerId = owners[0].id;
  for (let attempt = 0; ; attempt++) {
    try {
      const gymId = await inTransaction(pool, async (connection) => {
        const [[{ id }]] = await connection.query("SELECT UUID() AS id");
        await connection.query(
          `INSERT INTO gyms (id, name, tagline, location, invite_code, visibility, member_approval, member_count, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [id, values.name, values.tagline, values.location, newCode(8), values.visibility, values.memberApproval, adminId],
        );
        await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', NOW())", [id, ownerId]);
        return id;
      });
      // The creating admin may not be a member (or able to see a hidden gym), so answer from the row
      return gymToApi(await loadGym(pool, gymId), await membershipOf(pool, gymId, adminId));
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY" && /uq_gyms_name/.test(error.message)) throw conflict("A gym with that name already exists.");
      if (error?.code === "ER_DUP_ENTRY" && attempt < 3) continue; // the random invite code collided
      throw error;
    }
  }
}

const PROFILE_COLUMNS = {
  name: "name", tagline: "tagline", description: "description", location: "location", address: "address",
  logoMediaId: "logo_media_id", coverMediaId: "cover_media_id", hours: "hours", facilities: "facilities",
  membershipTiers: "membership_tiers", guidelines: "guidelines", contactPhone: "contact_phone",
  contactEmail: "contact_email", contactWebsite: "contact_website",
};
const JSON_FIELDS = new Set(["hours", "facilities", "membershipTiers", "guidelines"]);

// Owner and admins edit the profile; a new logo or cover must be the editor's own upload
async function updateProfile(pool, userId, gymId, changes) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canManage(membership)) throw new ForbiddenError("Only gym admins can edit the gym.");
  for (const key of ["logoMediaId", "coverMediaId"]) if (changes[key]) await assertOwnMedia(pool, changes[key], userId);
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(changes)) {
    sets.push(`${PROFILE_COLUMNS[key]} = ?`); // column names come from the allowlist above, never the request
    params.push(JSON_FIELDS.has(key) ? JSON.stringify(value) : value);
  }
  try {
    await pool.query(`UPDATE gyms SET ${sets.join(", ")} WHERE id = ?`, [...params, gymId]);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw conflict("A gym with that name already exists.");
    throw error;
  }
  return getGym(pool, userId, gymId);
}

// Admins replace the gym's code when it has leaked (the old one stops working at once)
async function rotateCode(pool, userId, gymId) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canManage(membership)) throw new ForbiddenError("Only gym admins can replace the gym code.");
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query("UPDATE gyms SET invite_code = ? WHERE id = ?", [newCode(8), gymId]);
      return getGym(pool, userId, gymId);
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY" && attempt < 3) continue; // the random code collided
      throw error;
    }
  }
}

// Platform admins: every gym, hidden ones included (the member listing hides those)
async function listAllGyms(pool) {
  const [rows] = await pool.query(`SELECT ${GYM_COLUMNS} FROM gyms g ORDER BY g.name LIMIT 500`);
  return rows.map((row) => gymToApi(row, null));
}

const SETTING_COLUMNS = new Set(["who_can_post", "who_can_comment", "who_can_create_events", "member_approval", "post_moderation", "visibility", "plan"]);

async function updateSettings(pool, userId, gymId, changes) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canManage(membership)) throw new ForbiddenError("Only gym admins can change the settings.");
  const keys = Object.keys(changes).filter((key) => SETTING_COLUMNS.has(key));
  await pool.query(`UPDATE gyms SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`, [...keys.map((key) => changes[key]), gymId]);
  return getGym(pool, userId, gymId);
}

// ---- joining and leaving -------------------------------------------------------------

// Adds (or activates) a membership inside a transaction that holds the gym row
async function admit(connection, gymId, userId, role, existing) {
  if (existing) {
    await connection.query("UPDATE gym_members SET status = 'active', role = ?, joined_at = NOW() WHERE gym_id = ? AND user_id = ?", [role, gymId, userId]);
  } else {
    await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, ?, 'active', NOW())", [gymId, userId, role]);
  }
  await connection.query("UPDATE gyms SET member_count = member_count + 1 WHERE id = ?", [gymId]);
}

// Join now, or ask to join. Repeating changes nothing; a suspended member can't rejoin.
async function join(pool, userId, gymId) {
  await ensureUser(pool, userId);
  await inTransaction(pool, async (connection) => {
    const gym = await loadGym(connection, gymId, { lock: true });
    const membership = gym ? await membershipOf(connection, gymId, userId, { lock: true }) : null;
    if (!gym || !perms.canSeeGym(gym, membership)) throw new NotFoundError(GONE);
    if (membership?.status === "suspended") throw new ForbiddenError("Your membership of this gym is suspended.");
    if (membership) return; // already active or already asked
    if (perms.joinMode(gym) === "join") await admit(connection, gymId, userId, "member", null);
    else await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status) VALUES (?, ?, 'member', 'pending')", [gymId, userId]);
  });
  return getGym(pool, userId, gymId);
}

// Leave the gym or withdraw a request. The owner can't leave; a suspended member stays recorded.
async function leave(pool, userId, gymId) {
  await inTransaction(pool, async (connection) => {
    const gym = await loadGym(connection, gymId, { lock: true });
    const membership = gym ? await membershipOf(connection, gymId, userId, { lock: true }) : null;
    if (!gym || !membership) throw new NotFoundError("You aren't a member of this gym.");
    if (!perms.canLeave(membership)) throw new ForbiddenError("The owner can't leave their gym.");
    if (membership.status === "suspended") throw new ForbiddenError("Your membership of this gym is suspended.");
    await connection.query("DELETE FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, userId]);
    if (membership.status === "active") await connection.query("UPDATE gyms SET member_count = GREATEST(member_count, 1) - 1 WHERE id = ?", [gymId]);
  });
  return { left: true };
}

// What a code opens: the gym's own code (joins as a member) or a pending, unexpired invitation
async function findCode(db, code) {
  const [gyms] = await db.query(`SELECT ${GYM_COLUMNS} FROM gyms g WHERE g.invite_code = ?`, [code]);
  if (gyms[0]) return { gym: gyms[0], invitation: null, role: "member" };
  const [invites] = await db.query(
    "SELECT id, gym_id, role, status, expires_at <= NOW() AS expired FROM gym_invitations WHERE code = ?",
    [code],
  );
  const invite = invites[0];
  if (!invite || invite.status !== "pending" || invite.expired) return null;
  const gym = await loadGym(db, invite.gym_id);
  return gym ? { gym, invitation: invite, role: invite.role } : null;
}

// The invitation screen: which gym a code opens, before accepting (works for hidden gyms too)
async function previewCode(pool, userId, code) {
  const found = await findCode(pool, code);
  if (!found) throw new NotFoundError("That invite code isn't valid or has expired.");
  const membership = await membershipOf(pool, found.gym.id, userId);
  return { gym: gymToApi(found.gym, membership), role: found.role };
}

// Accepting a code is an invitation: it skips approval. An existing member keeps their place
// (a trainer invitation promotes a member); a pending request becomes active.
async function joinByCode(pool, userId, code) {
  await ensureUser(pool, userId);
  const gymId = await inTransaction(pool, async (connection) => {
    const found = await findCode(connection, code);
    if (!found) throw new NotFoundError("That invite code isn't valid or has expired.");
    const gym = await loadGym(connection, found.gym.id, { lock: true });
    const membership = await membershipOf(connection, gym.id, userId, { lock: true });
    if (membership?.status === "suspended") throw new ForbiddenError("Your membership of this gym is suspended.");
    if (!membership || membership.status === "pending") await admit(connection, gym.id, userId, found.role, membership);
    else if (membership.role === "member" && found.role === "trainer") {
      await connection.query("UPDATE gym_members SET role = 'trainer' WHERE gym_id = ? AND user_id = ?", [gym.id, userId]);
    }
    if (found.invitation) {
      await connection.query("UPDATE gym_invitations SET status = 'accepted', accepted_by = ? WHERE id = ? AND status = 'pending'", [userId, found.invitation.id]);
    }
    return gym.id;
  });
  return getGym(pool, userId, gymId);
}

// ---- members -------------------------------------------------------------------------

// Active members for anyone who can read the gym; pending and suspended lists for admins
async function listMembers(pool, userId, gymId, { status = "active" }) {
  const { membership } = await readable(pool, gymId, userId);
  if (status !== "active" && !perms.canManage(membership)) throw new ForbiddenError("Only gym admins can see requests.");
  const [rows] = await pool.query(
    `SELECT m.user_id, m.role, m.status, m.joined_at, m.requested_at, u.full_name
     FROM gym_members m JOIN users u ON u.id = m.user_id
     WHERE m.gym_id = ? AND m.status = ?
     ORDER BY FIELD(m.role, 'owner', 'admin', 'trainer', 'member'), u.full_name, m.user_id
     LIMIT 500`,
    [gymId, status],
  );
  return rows.map((row) => ({
    member: memberSummary(row),
    role: row.role,
    status: row.status,
    since: new Date(row.joined_at ?? row.requested_at).toISOString(),
    isMe: row.user_id === userId,
  }));
}

// Approve, suspend, reinstate or change a role (see permissions.memberChangeRefusal)
async function changeMember(pool, actorId, gymId, targetId, change) {
  await inTransaction(pool, async (connection) => {
    const gym = await loadGym(connection, gymId, { lock: true });
    const actor = gym ? await membershipOf(connection, gymId, actorId) : null;
    if (!gym || !perms.canSeeGym(gym, actor)) throw new NotFoundError(GONE);
    const target = await membershipOf(connection, gymId, targetId, { lock: true });
    const refusal = perms.memberChangeRefusal(actor, target, change);
    if (refusal) throw target || !perms.canManage(actor) ? new ForbiddenError(refusal) : new NotFoundError(refusal);
    if (change.status === "active" && target.status !== "active") {
      await connection.query("UPDATE gym_members SET status = 'active', joined_at = NOW() WHERE gym_id = ? AND user_id = ?", [gymId, targetId]);
      await connection.query("UPDATE gyms SET member_count = member_count + 1 WHERE id = ?", [gymId]);
    } else if (change.status === "suspended" && target.status !== "suspended") {
      await connection.query("UPDATE gym_members SET status = 'suspended' WHERE gym_id = ? AND user_id = ?", [gymId, targetId]);
      if (target.status === "active") await connection.query("UPDATE gyms SET member_count = GREATEST(member_count, 1) - 1 WHERE id = ?", [gymId]);
    }
    if (change.role !== undefined) await connection.query("UPDATE gym_members SET role = ? WHERE gym_id = ? AND user_id = ?", [change.role, gymId, targetId]);
  });
  const [rows] = await pool.query("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, targetId]);
  return { userId: targetId, role: rows[0].role, status: rows[0].status };
}

// Remove a member or decline a request (same rules as changing them)
async function removeMember(pool, actorId, gymId, targetId) {
  await inTransaction(pool, async (connection) => {
    const gym = await loadGym(connection, gymId, { lock: true });
    const actor = gym ? await membershipOf(connection, gymId, actorId) : null;
    if (!gym || !perms.canSeeGym(gym, actor)) throw new NotFoundError(GONE);
    const target = await membershipOf(connection, gymId, targetId, { lock: true });
    const refusal = perms.memberChangeRefusal(actor, target, {});
    if (refusal) throw target || !perms.canManage(actor) ? new ForbiddenError(refusal) : new NotFoundError(refusal);
    await connection.query("DELETE FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, targetId]);
    if (target.status === "active") await connection.query("UPDATE gyms SET member_count = GREATEST(member_count, 1) - 1 WHERE id = ?", [gymId]);
  });
  return { removed: true };
}

// ---- posts ---------------------------------------------------------------------------

async function listGymPosts(pool, userId, gymId, page) {
  await readable(pool, gymId, userId);
  return posts.listPosts(pool, userId, { gymId, ...page });
}

// Who may post comes from the settings; with post moderation on, members' posts wait for staff
async function createGymPost(pool, userId, gymId, values) {
  const { gym, membership } = await access(pool, gymId, userId);
  if (!perms.canPost(gym, membership)) throw new ForbiddenError("You can't post in this gym.");
  const audience = "public"; // a gym post's audience is the gym (visibility.js)
  return posts.createPost(pool, userId, { ...values, audience, gymId, reviewStatus: perms.postNeedsReview(gym, membership) ? "pending" : "published" });
}

// The gym post for a moderation action, or a 404 (another gym's post can't be reached here)
async function gymPostFor(pool, gymId, postId) {
  const [rows] = await pool.query("SELECT id, review_status FROM community_posts WHERE id = ? AND gym_id = ? AND deleted_at IS NULL", [postId, gymId]);
  if (!rows[0]) throw new NotFoundError("That post no longer exists.");
  return rows[0];
}

async function approvePost(pool, userId, gymId, postId) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canModerate(membership)) throw new ForbiddenError("Only gym staff can approve posts.");
  const [result] = await pool.query("UPDATE community_posts SET review_status = 'published' WHERE id = ? AND gym_id = ? AND deleted_at IS NULL AND review_status = 'pending'", [postId, gymId]);
  if (result.affectedRows === 0) await gymPostFor(pool, gymId, postId); // a 404 if it is gone; otherwise it was already published
  return { id: postId, reviewStatus: "published" };
}

// Gym admins take down any post in their gym (soft delete, like the author's own delete)
async function removePost(pool, userId, gymId, postId) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canManage(membership)) throw new ForbiddenError("Only gym admins can remove posts.");
  const [result] = await pool.query("UPDATE community_posts SET deleted_at = NOW() WHERE id = ? AND gym_id = ? AND deleted_at IS NULL", [postId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That post no longer exists.");
  return { deleted: true };
}

// For the community comment route: a comment on a gym post follows the gym's comment setting
async function assertCanComment(pool, userId, gymId) {
  const { gym, membership } = await access(pool, gymId, userId);
  if (!perms.canComment(gym, membership)) throw new ForbiddenError("Comments in this gym are limited.");
}

// ---- announcements -------------------------------------------------------------------

function announcementToApi(row) {
  return {
    id: row.id, gymId: row.gym_id, title: row.title, body: row.body, pinned: Boolean(row.pinned),
    author: row.author_id ? memberSummary({ user_id: row.author_id, full_name: row.full_name }) : null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const ANNOUNCEMENT_SELECT = "SELECT a.*, u.full_name FROM gym_announcements a LEFT JOIN users u ON u.id = a.author_id";

async function listAnnouncements(pool, userId, gymId) {
  await readable(pool, gymId, userId);
  const [rows] = await pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.gym_id = ? ORDER BY a.pinned DESC, a.updated_at DESC, a.id LIMIT 50`, [gymId]);
  return rows.map(announcementToApi);
}

async function manageable(pool, gymId, userId, what) {
  const found = await access(pool, gymId, userId);
  if (!perms.canManage(found.membership)) throw new ForbiddenError(`Only gym admins can ${what}.`);
  return found;
}

async function createAnnouncement(pool, userId, gymId, values) {
  await manageable(pool, gymId, userId, "post announcements");
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query("INSERT INTO gym_announcements (id, gym_id, author_id, title, body, pinned) VALUES (?, ?, ?, ?, ?, ?)", [id, gymId, userId, values.title, values.body, values.pinned]);
  const [rows] = await pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.id = ?`, [id]);
  return announcementToApi(rows[0]);
}

async function updateAnnouncement(pool, userId, gymId, announcementId, values) {
  await manageable(pool, gymId, userId, "edit announcements");
  const columns = ["title", "body", "pinned"].filter((key) => values[key] !== undefined);
  const [result] = await pool.query(
    `UPDATE gym_announcements SET ${columns.map((key) => `${key} = ?`).join(", ")} WHERE id = ? AND gym_id = ?`,
    [...columns.map((key) => values[key]), announcementId, gymId],
  );
  if (result.affectedRows === 0) throw new NotFoundError("That announcement no longer exists.");
  const [rows] = await pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.id = ?`, [announcementId]);
  return announcementToApi(rows[0]);
}

async function deleteAnnouncement(pool, userId, gymId, announcementId) {
  await manageable(pool, gymId, userId, "delete announcements");
  const [result] = await pool.query("DELETE FROM gym_announcements WHERE id = ? AND gym_id = ?", [announcementId, gymId]);
  if (result.affectedRows === 0) throw new NotFoundError("That announcement no longer exists.");
  return { deleted: true };
}

// ---- events --------------------------------------------------------------------------

const hhmm = (time) => String(time).slice(0, 5);
const isoDay = (date) => (date instanceof Date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : String(date).slice(0, 10));

function eventToApi(row, userId) {
  return {
    id: row.id, gymId: row.gym_id, title: row.title, description: row.description,
    date: isoDay(row.event_date), startTime: hhmm(row.start_time), endTime: hhmm(row.end_time), location: row.location,
    maxAttendees: row.max_attendees, attendeeCount: row.attendee_count,
    full: row.max_attendees !== null && row.attendee_count >= row.max_attendees,
    going: Boolean(row.going),
    host: row.host_id ? memberSummary({ user_id: row.host_id, full_name: row.full_name }) : null,
    isHost: row.host_id === userId,
  };
}

const EVENT_SELECT = `SELECT e.*, u.full_name, EXISTS (SELECT 1 FROM gym_event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS going
  FROM gym_events e LEFT JOIN users u ON u.id = e.host_id`;

// The gym's events from the last 60 days onwards, soonest first; the app splits upcoming from
// past by its own clock. Older events fall off the list, so a gym that runs classes for years
// still gets its upcoming events back (events are never deleted automatically).
const PAST_EVENT_DAYS = 60;
async function listEvents(pool, userId, gymId) {
  await readable(pool, gymId, userId);
  const [rows] = await pool.query(
    `${EVENT_SELECT} WHERE e.gym_id = ? AND e.event_date >= CURRENT_DATE - INTERVAL ? DAY ORDER BY e.event_date, e.start_time, e.id LIMIT 200`,
    [userId, gymId, PAST_EVENT_DAYS],
  );
  return rows.map((row) => eventToApi(row, userId));
}

async function createEvent(pool, userId, gymId, values) {
  const { gym, membership } = await access(pool, gymId, userId);
  if (!perms.canCreateEvents(gym, membership)) throw new ForbiddenError("You can't create events in this gym.");
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query(
    `INSERT INTO gym_events (id, gym_id, host_id, title, description, event_date, start_time, end_time, location, max_attendees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, gymId, userId, values.title, values.description, values.date, values.startTime, values.endTime, values.location, values.maxAttendees],
  );
  const [rows] = await pool.query(`${EVENT_SELECT} WHERE e.id = ?`, [userId, id]);
  return eventToApi(rows[0], userId);
}

// The host or a gym admin cancels an event (its RSVPs go with it)
async function deleteEvent(pool, userId, gymId, eventId) {
  const { membership } = await access(pool, gymId, userId);
  const [rows] = await pool.query("SELECT host_id FROM gym_events WHERE id = ? AND gym_id = ?", [eventId, gymId]);
  if (!rows[0]) throw new NotFoundError("That event no longer exists.");
  if (rows[0].host_id !== userId && !perms.canManage(membership)) throw new ForbiddenError("Only the host or a gym admin can cancel this event.");
  await pool.query("DELETE FROM gym_events WHERE id = ? AND gym_id = ?", [eventId, gymId]);
  return { deleted: true };
}

// Going / not going. Active members only; the event row is locked so capacity holds, and a
// repeat changes nothing. Past events (by date, a day's grace for time zones) are closed.
async function setRsvp(pool, userId, gymId, eventId, going) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.activeRole(membership)) throw new ForbiddenError("Join this gym to RSVP.");
  await inTransaction(pool, async (connection) => {
    const [events] = await connection.query(
      "SELECT id, max_attendees, attendee_count, event_date < (CURRENT_DATE - INTERVAL 1 DAY) AS past FROM gym_events WHERE id = ? AND gym_id = ? FOR UPDATE",
      [eventId, gymId],
    );
    const event = events[0];
    if (!event) throw new NotFoundError("That event no longer exists.");
    if (event.past) throw new ForbiddenError("This event has already happened.");
    if (going) {
      const [existing] = await connection.query("SELECT 1 FROM gym_event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, userId]);
      if (existing.length > 0) return;
      if (event.max_attendees !== null && event.attendee_count >= event.max_attendees) throw conflict("This event is full.");
      await connection.query("INSERT INTO gym_event_rsvps (event_id, user_id) VALUES (?, ?)", [eventId, userId]);
      await connection.query("UPDATE gym_events SET attendee_count = attendee_count + 1 WHERE id = ?", [eventId]);
    } else {
      const [result] = await connection.query("DELETE FROM gym_event_rsvps WHERE event_id = ? AND user_id = ?", [eventId, userId]);
      if (result.affectedRows === 1) await connection.query("UPDATE gym_events SET attendee_count = GREATEST(attendee_count, 1) - 1 WHERE id = ?", [eventId]);
    }
  });
  const [rows] = await pool.query(`${EVENT_SELECT} WHERE e.id = ?`, [userId, eventId]);
  return eventToApi(rows[0], userId);
}

// ---- invitations ---------------------------------------------------------------------

// `showCode` false hides the code: a trainer may see that an admin invited a trainer, but not
// pass that code on (they can only grant the member role themselves)
function invitationToApi(row, { showCode = true } = {}) {
  const expired = row.status === "pending" && new Date(row.expires_at) <= new Date();
  return {
    id: row.id, code: showCode ? row.code : null, channel: row.channel, contact: row.contact, role: row.role,
    status: expired ? "expired" : row.status,
    invitedBy: row.invited_by ? memberSummary({ user_id: row.invited_by, full_name: row.full_name }) : null,
    expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
  };
}

const INVITATION_SELECT = "SELECT i.*, u.full_name FROM gym_invitations i LEFT JOIN users u ON u.id = i.invited_by";

async function listInvitations(pool, userId, gymId) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.canInvite(membership)) throw new ForbiddenError("Only gym staff can see invitations.");
  const [rows] = await pool.query(`${INVITATION_SELECT} WHERE i.gym_id = ? ORDER BY i.created_at DESC, i.id LIMIT 200`, [gymId]);
  const grantable = perms.invitableRoles(membership);
  return rows.map((row) => invitationToApi(row, { showCode: grantable.includes(row.role) || row.invited_by === userId }));
}

// Records an invitation (nothing is sent). Trainers invite members; admins also trainers.
async function createInvitation(pool, userId, gymId, values) {
  const { membership } = await access(pool, gymId, userId);
  if (!perms.invitableRoles(membership).includes(values.role)) {
    throw new ForbiddenError(perms.canInvite(membership) ? "You can't invite someone with that role." : "Only gym staff can invite people.");
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const [[{ id }]] = await pool.query("SELECT UUID() AS id");
      await pool.query(
        `INSERT INTO gym_invitations (id, gym_id, code, channel, contact, role, invited_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? DAY)`,
        [id, gymId, newCode(10), values.channel, values.contact, values.role, userId, INVITE_DAYS],
      );
      const [rows] = await pool.query(`${INVITATION_SELECT} WHERE i.id = ?`, [id]);
      return invitationToApi(rows[0]);
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY" && attempt < 3) continue; // the random code collided
      throw error;
    }
  }
}

// Revoke (the inviter or an admin) or renew (admins: a fresh 14 days for a pending or expired one)
async function changeInvitation(pool, userId, gymId, invitationId, action) {
  const { membership } = await access(pool, gymId, userId);
  const [rows] = await pool.query("SELECT invited_by, status FROM gym_invitations WHERE id = ? AND gym_id = ?", [invitationId, gymId]);
  const invitation = rows[0];
  if (!invitation) throw new NotFoundError("That invitation doesn't exist.");
  const allowed = perms.canManage(membership) || (action === "revoke" && perms.canInvite(membership) && invitation.invited_by === userId);
  if (!allowed) throw new ForbiddenError(action === "revoke" ? "You can't revoke this invitation." : "Only gym admins can renew invitations.");
  if (invitation.status !== "pending") throw conflict(`This invitation was already ${invitation.status}.`);
  if (action === "revoke") await pool.query("UPDATE gym_invitations SET status = 'revoked' WHERE id = ?", [invitationId]);
  else await pool.query("UPDATE gym_invitations SET expires_at = NOW() + INTERVAL ? DAY WHERE id = ?", [INVITE_DAYS, invitationId]);
  const [updated] = await pool.query(`${INVITATION_SELECT} WHERE i.id = ?`, [invitationId]);
  return invitationToApi(updated[0]);
}

// ---- media ---------------------------------------------------------------------------

// Whether the viewer may load a gym's logo or cover: anyone who can see the gym at all
async function canSeeGymMedia(pool, userId, mediaId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM gyms g WHERE (g.logo_media_id = ? OR g.cover_media_id = ?)
       AND (g.visibility <> 'hidden' OR EXISTS (SELECT 1 FROM gym_members m WHERE m.gym_id = g.id AND m.user_id = ?)) LIMIT 1`,
    [mediaId, mediaId, userId],
  );
  return rows.length > 0;
}

module.exports = {
  INVITE_DAYS, newCode, gymToApi,
  listGyms, listAllGyms, getGym, createGym, updateProfile, updateSettings, rotateCode,
  join, leave, previewCode, joinByCode,
  listMembers, changeMember, removeMember,
  listGymPosts, createGymPost, approvePost, removePost, assertCanComment,
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listEvents, createEvent, deleteEvent, setRsvp,
  listInvitations, createInvitation, changeInvitation, canSeeGymMedia,
};
