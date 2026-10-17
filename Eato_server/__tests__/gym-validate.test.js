// Unit tests for the gym input checks (gyms/validate.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const v = require("../gyms/validate.js");

const rejects = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
const NOW = Date.parse("2026-10-20T10:00:00Z");

describe("gym validation", () => {
  it("creating a gym: a name, the owner's email, known visibility", () => {
    assert.deepEqual(v.validateGymCreate({ name: " Iron Temple ", ownerEmail: "Owner@Example.com" }), {
      name: "Iron Temple", tagline: null, location: null, ownerEmail: "owner@example.com", visibility: "public", memberApproval: false,
    });
    rejects(() => v.validateGymCreate({ name: "X", ownerEmail: "o@example.com" }), /Gym name/);
    rejects(() => v.validateGymCreate({ name: "Iron", ownerEmail: "not-an-email" }), /Owner email/);
    rejects(() => v.validateGymCreate({ name: "Iron", ownerEmail: "o@example.com", visibility: "secret" }), /Visibility/);
    rejects(() => v.validateGymCreate({ name: "Iron", ownerEmail: "o@example.com", ownerId: "user_x" }), /unexpected field: ownerId/);
  });

  it("the profile: only known fields, lists within limits, contact details that look right", () => {
    const changes = v.validateGymProfile({
      tagline: "Lift heavy", hours: [{ label: "Mon–Fri", value: "5am–11pm" }], facilities: ["Free weights"],
      membershipTiers: [{ name: "Basic", price: "₹1,499/mo" }], contactPhone: "+91 98765 43210", contactWebsite: "https://iron.example",
    });
    assert.deepEqual(changes.membershipTiers, [{ name: "Basic", price: "₹1,499/mo", perks: "" }]);
    assert.equal(changes.contactPhone, "+91 98765 43210");
    rejects(() => v.validateGymProfile({}), /at least one/);
    rejects(() => v.validateGymProfile({ inviteCode: "ABCDEFGH" }), /unexpected field: inviteCode/);
    rejects(() => v.validateGymProfile({ facilities: Array(13).fill("x") }), /at most 12/);
    rejects(() => v.validateGymProfile({ hours: [{ label: "Mon", value: "9-5", extra: 1 }] }), /unexpected field: extra/);
    rejects(() => v.validateGymProfile({ contactEmail: "nope" }), /Email/);
    rejects(() => v.validateGymProfile({ contactWebsite: "javascript:alert(1)" }), /Website/);
    rejects(() => v.validateGymProfile({ logoMediaId: "../../etc/passwd" }), /logo/);
    assert.equal(v.validateGymProfile({ tagline: "" }).tagline, null, "empty clears a field");
  });

  it("settings map to their columns and refuse unknown values", () => {
    assert.deepEqual(v.validateGymSettings({ whoCanPost: "trainers", postModeration: true, plan: "pro" }), { who_can_post: "trainers", post_moderation: true, plan: "pro" });
    rejects(() => v.validateGymSettings({ whoCanPost: "anyone" }), /Who can post/);
    rejects(() => v.validateGymSettings({ memberApproval: "yes" }), /true or false/);
    rejects(() => v.validateGymSettings({ member_count: 9999 }), /unexpected field/);
  });

  it("member changes are a role or a status; owner can't be requested", () => {
    assert.deepEqual(v.validateMemberChange({ status: "active" }), { status: "active" });
    assert.deepEqual(v.validateMemberChange({ role: "trainer" }), { role: "trainer" });
    rejects(() => v.validateMemberChange({ role: "owner" }), /Role/);
    rejects(() => v.validateMemberChange({ status: "pending" }), /Status/);
    rejects(() => v.validateMemberChange({}), /role or a status/);
  });

  it("invitations: email and phone need a contact, link and QR don't take one", () => {
    assert.deepEqual(v.validateInvitation({ channel: "email", contact: "A@B.co" }), { channel: "email", contact: "a@b.co", role: "member" });
    assert.deepEqual(v.validateInvitation({ channel: "link", role: "trainer" }), { channel: "link", contact: null, role: "trainer" });
    rejects(() => v.validateInvitation({ channel: "phone", contact: "abc" }), /Phone/);
    rejects(() => v.validateInvitation({ channel: "link", contact: "x@y.z" }), /no contact/);
    rejects(() => v.validateInvitation({ channel: "link", role: "admin" }), /Role/);
    rejects(() => v.validateInvitation({ channel: "sms" }), /Channel/);
  });

  it("events: a real date not in the past, start before end, optional capacity", () => {
    const event = v.validateEvent({ title: "Deadlift clinic", description: "Form check", date: "2026-10-25", startTime: "07:00", endTime: "08:30", location: "Main floor", maxAttendees: 12 }, NOW);
    assert.equal(event.maxAttendees, 12);
    const base = { title: "t", description: "d", date: "2026-10-25", startTime: "07:00", endTime: "08:00", location: "l" };
    assert.equal(v.validateEvent(base, NOW).maxAttendees, null);
    assert.equal(v.validateEvent({ ...base, date: "2026-10-19" }, NOW).date, "2026-10-19", "yesterday is someone's today");
    rejects(() => v.validateEvent({ ...base, date: "2026-10-18" }, NOW), /already passed/);
    rejects(() => v.validateEvent({ ...base, date: "2027-12-01" }, NOW), /year ahead/);
    rejects(() => v.validateEvent({ ...base, date: "2026-02-30" }, NOW), /real day/);
    rejects(() => v.validateEvent({ ...base, endTime: "07:00" }, NOW), /end after/);
    rejects(() => v.validateEvent({ ...base, startTime: "7am" }, NOW), /HH:MM/);
    rejects(() => v.validateEvent({ ...base, maxAttendees: 0 }, NOW), /Maximum attendees/);
    rejects(() => v.validateEvent({ ...base, maxAttendees: 2.5 }, NOW), /Maximum attendees/);
    rejects(() => v.validateEvent({ ...base, hostId: "user_x" }, NOW), /unexpected field: hostId/);
  });

  it("announcements: full on create, partial on edit", () => {
    assert.deepEqual(v.validateAnnouncement({ title: "Holiday hours", body: "Closed Monday" }), { title: "Holiday hours", body: "Closed Monday", pinned: false });
    assert.deepEqual(v.validateAnnouncement({ pinned: true }, { partial: true }), { pinned: true });
    rejects(() => v.validateAnnouncement({ title: "x" }), /Announcement text/);
    rejects(() => v.validateAnnouncement({}, { partial: true }), /at least one/);
  });

  it("invite codes ignore case, spaces and dashes; anything else is refused", () => {
    assert.equal(v.inviteCode(" abcd-efgh "), "ABCDEFGH");
    assert.equal(v.inviteCode("ABCDE23456"), "ABCDE23456");
    rejects(() => v.inviteCode("ABC"), /isn't valid/);
    rejects(() => v.inviteCode("' OR 1=1 --"), /isn't valid/);
    rejects(() => v.inviteCode(42), /Enter an invite code/);
  });
});
