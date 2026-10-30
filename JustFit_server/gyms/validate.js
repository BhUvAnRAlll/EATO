// Input checks for the gym routes: one friendly line per problem, unknown fields refused.
// Pure functions (no database), unit-tested in __tests__/gym-validate.test.js.
const { ValidationError } = require("../profile");
const { requireObject, rejectUnknownKeys, text, optionalText, optionalId } = require("../community/validate");
const { isoDate } = require("../macro/validate");

const limits = {
  name: 80,
  tagline: 120,
  description: 1000,
  location: 80,
  address: 200,
  hours: 7, // rows like "Mon–Fri · 5am–11pm"
  hourText: 40,
  facilities: 12,
  facility: 40,
  tiers: 4,
  tierName: 40,
  tierPrice: 40,
  tierPerks: 120,
  guidelines: 10,
  guideline: 160,
  announcementTitle: 120,
  announcementBody: 1000,
  eventTitle: 80,
  eventDescription: 1000,
  eventLocation: 120,
  maxAttendees: 1000,
  contact: 120,
  eventDaysAhead: 366, // events can be planned up to a year ahead
};

const VISIBILITY = ["public", "private", "hidden"];
const WHO_CAN_POST = ["everyone", "admins"];
const WHO_CAN_COMMENT = ["members", "off"];
const WHO_CAN_CREATE_EVENTS = ["admins", "members"];
const PLANS = ["starter", "pro", "elite"];
const INVITE_CHANNELS = ["link", "qr", "email", "phone"];
const INVITE_ROLES = ["member"];
const MEMBER_STATUSES = ["active", "suspended"];
const MEMBER_ROLES = ["admin", "member"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 -]{6,18}[0-9]$/;
const WEBSITE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CODE = /^[A-Z0-9]{8,10}$/;

const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}.`);
  return value;
};
const bool = (value, label) => {
  if (typeof value !== "boolean") throw new ValidationError(`${label} must be true or false.`);
  return value;
};
const list = (value, label, max) => {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list.`);
  if (value.length > max) throw new ValidationError(`${label} can have at most ${max} entries.`);
  return value;
};
const pattern = (value, regex, label, max) => {
  const clean = optionalText(value, label, max);
  if (clean !== null && !regex.test(clean)) throw new ValidationError(`${label} doesn't look right.`);
  return clean;
};

// The profile fields an owner or admin edits (all optional; only what is sent changes)
const PROFILE_FIELDS = ["name", "tagline", "description", "location", "address", "logoMediaId", "coverMediaId",
  "hours", "facilities", "membershipTiers", "guidelines", "contactPhone", "contactEmail", "contactWebsite"];

function profileField(key, value) {
  switch (key) {
    case "name": return text(value, "Gym name", { min: 2, max: limits.name });
    case "tagline": return optionalText(value, "Tagline", limits.tagline);
    case "description": return optionalText(value, "Description", limits.description);
    case "location": return optionalText(value, "Location", limits.location);
    case "address": return optionalText(value, "Address", limits.address);
    case "logoMediaId": return optionalId(value, "The logo");
    case "coverMediaId": return optionalId(value, "The cover photo");
    case "hours":
      return list(value, "Opening hours", limits.hours).map((row) => {
        requireObject(row, "opening hours row");
        rejectUnknownKeys(row, ["label", "value"], "An opening hours row");
        return { label: text(row.label, "Days", { max: limits.hourText }), value: text(row.value, "Hours", { max: limits.hourText }) };
      });
    case "facilities": return list(value, "Facilities", limits.facilities).map((item) => text(item, "A facility", { max: limits.facility }));
    case "guidelines": return list(value, "Guidelines", limits.guidelines).map((item) => text(item, "A guideline", { max: limits.guideline }));
    case "membershipTiers":
      return list(value, "Membership tiers", limits.tiers).map((tier) => {
        requireObject(tier, "membership tier");
        rejectUnknownKeys(tier, ["name", "price", "perks"], "A membership tier");
        return {
          name: text(tier.name, "Tier name", { max: limits.tierName }),
          price: text(tier.price, "Tier price", { max: limits.tierPrice }),
          perks: optionalText(tier.perks, "Tier perks", limits.tierPerks) ?? "",
        };
      });
    case "contactPhone": return pattern(value, PHONE, "Phone", 20);
    case "contactEmail": return pattern(value, EMAIL, "Email", limits.contact);
    case "contactWebsite": return pattern(value, WEBSITE, "Website", 200);
    default: throw new ValidationError(`The gym has an unexpected field: ${key}.`);
  }
}

function validateGymProfile(body) {
  requireObject(body, "gym profile");
  rejectUnknownKeys(body, PROFILE_FIELDS, "The gym profile");
  const changes = {};
  for (const [key, value] of Object.entries(body)) changes[key] = profileField(key, value);
  if (Object.keys(changes).length === 0) throw new ValidationError("Send at least one field to change.");
  return changes;
}

// A platform admin creates a gym and names its owner by the email of an existing account
function validateGymCreate(body) {
  requireObject(body, "gym");
  rejectUnknownKeys(body, ["name", "tagline", "location", "ownerEmail", "visibility", "memberApproval"], "The gym");
  const ownerEmail = text(body.ownerEmail, "Owner email", { max: limits.contact }).toLowerCase();
  if (!EMAIL.test(ownerEmail)) throw new ValidationError("Owner email doesn't look right.");
  return {
    name: text(body.name, "Gym name", { min: 2, max: limits.name }),
    tagline: optionalText(body.tagline, "Tagline", limits.tagline),
    location: optionalText(body.location, "Location", limits.location),
    ownerEmail,
    visibility: body.visibility === undefined ? "public" : oneOf(body.visibility, VISIBILITY, "Visibility"),
    memberApproval: body.memberApproval === undefined ? false : bool(body.memberApproval, "Member approval"),
  };
}

// Community settings (owner and admins); the plan card too (no payment: it only changes the label)
function validateGymSettings(body) {
  requireObject(body, "settings");
  rejectUnknownKeys(body, ["whoCanPost", "whoCanComment", "whoCanCreateEvents", "memberApproval", "postModeration", "visibility", "plan"], "The settings");
  const changes = {};
  if (body.whoCanPost !== undefined) changes.who_can_post = oneOf(body.whoCanPost, WHO_CAN_POST, "Who can post");
  if (body.whoCanComment !== undefined) changes.who_can_comment = oneOf(body.whoCanComment, WHO_CAN_COMMENT, "Who can comment");
  if (body.whoCanCreateEvents !== undefined) changes.who_can_create_events = oneOf(body.whoCanCreateEvents, WHO_CAN_CREATE_EVENTS, "Who can create events");
  if (body.memberApproval !== undefined) changes.member_approval = bool(body.memberApproval, "Member approval");
  if (body.postModeration !== undefined) changes.post_moderation = bool(body.postModeration, "Post moderation");
  if (body.visibility !== undefined) changes.visibility = oneOf(body.visibility, VISIBILITY, "Visibility");
  if (body.plan !== undefined) changes.plan = oneOf(body.plan, PLANS, "Plan");
  if (Object.keys(changes).length === 0) throw new ValidationError("Send at least one setting to change.");
  return changes;
}

// Approve or suspend a member ({ status }), or change their role ({ role })
function validateMemberChange(body) {
  requireObject(body, "change");
  rejectUnknownKeys(body, ["role", "status"], "The change");
  const change = {};
  if (body.role !== undefined) change.role = oneOf(body.role, MEMBER_ROLES, "Role");
  if (body.status !== undefined) change.status = oneOf(body.status, MEMBER_STATUSES, "Status");
  if (Object.keys(change).length === 0) throw new ValidationError("Send a role or a status.");
  return change;
}

function validateInvitation(body) {
  requireObject(body, "invitation");
  rejectUnknownKeys(body, ["channel", "contact", "role"], "The invitation");
  const channel = oneOf(body.channel, INVITE_CHANNELS, "Channel");
  const role = body.role === undefined ? "member" : oneOf(body.role, INVITE_ROLES, "Role");
  let contact = null;
  if (channel === "email") {
    contact = text(body.contact, "Email", { max: limits.contact }).toLowerCase();
    if (!EMAIL.test(contact)) throw new ValidationError("Email doesn't look right.");
  } else if (channel === "phone") {
    contact = text(body.contact, "Phone", { max: 20 });
    if (!PHONE.test(contact)) throw new ValidationError("Phone doesn't look right.");
  } else if (body.contact !== undefined && body.contact !== null && body.contact !== "") {
    throw new ValidationError("A link or QR invitation has no contact.");
  }
  return { channel, contact, role };
}

function validateAnnouncement(body, { partial = false } = {}) {
  requireObject(body, "announcement");
  rejectUnknownKeys(body, ["title", "body", "pinned"], "The announcement");
  const values = {};
  if (!partial || body.title !== undefined) values.title = text(body.title, "Title", { max: limits.announcementTitle });
  if (!partial || body.body !== undefined) values.body = text(body.body, "Announcement text", { max: limits.announcementBody });
  if (body.pinned !== undefined) values.pinned = bool(body.pinned, "Pinned");
  else if (!partial) values.pinned = false;
  if (partial && Object.keys(values).length === 0) throw new ValidationError("Send at least one field to change.");
  return values;
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// An event: a real date from yesterday (any time zone's today) up to a year ahead, start
// before end, and an optional capacity
function validateEvent(body, now) {
  requireObject(body, "event");
  rejectUnknownKeys(body, ["title", "description", "date", "startTime", "endTime", "location", "maxAttendees"], "The event");
  const date = isoDate(body.date, "The date");
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000;
  if (days < -1) throw new ValidationError("The event date has already passed.");
  if (days > limits.eventDaysAhead) throw new ValidationError("Events can be planned up to a year ahead.");
  for (const [key, label] of [["startTime", "Start time"], ["endTime", "End time"]]) {
    if (typeof body[key] !== "string" || !TIME.test(body[key])) throw new ValidationError(`${label} must look like HH:MM.`);
  }
  if (minutes(body.endTime) <= minutes(body.startTime)) throw new ValidationError("The event must end after it starts.");
  let maxAttendees = null;
  if (body.maxAttendees !== undefined && body.maxAttendees !== null) {
    if (!Number.isInteger(body.maxAttendees) || body.maxAttendees < 1 || body.maxAttendees > limits.maxAttendees) {
      throw new ValidationError(`Maximum attendees must be a whole number from 1 to ${limits.maxAttendees}.`);
    }
    maxAttendees = body.maxAttendees;
  }
  return {
    title: text(body.title, "Title", { max: limits.eventTitle }),
    description: text(body.description, "Description", { max: limits.eventDescription }),
    date,
    startTime: body.startTime,
    endTime: body.endTime,
    location: text(body.location, "Location", { max: limits.eventLocation }),
    maxAttendees,
  };
}

// A gym or invitation code: letters and digits, any case, spaces and dashes ignored
function inviteCode(value) {
  if (typeof value !== "string") throw new ValidationError("Enter an invite code.");
  const clean = value.replace(/[\s-]/g, "").toUpperCase();
  if (!CODE.test(clean)) throw new ValidationError("That invite code isn't valid.");
  return clean;
}

module.exports = {
  limits, VISIBILITY, WHO_CAN_POST, WHO_CAN_COMMENT, WHO_CAN_CREATE_EVENTS, PLANS, INVITE_CHANNELS,
  validateGymProfile, validateGymCreate, validateGymSettings, validateMemberChange, validateInvitation,
  validateAnnouncement, validateEvent, inviteCode,
};
