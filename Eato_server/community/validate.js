// Input checks for the community routes: one friendly line per problem, as the profile
// validators do. Pure functions (no database), so they are unit-tested directly.
const { ValidationError } = require("../profile");

const limits = {
  postBody: 1000,
  commentBody: 500,
  caption: 200,
  messageBody: 1000,
  reason: 300,
  groupName: 80,
  groupTopic: 40,
  groupDescription: 300,
  search: 60,
  pageMax: 50,
  pageDefault: 20,
  storyHours: 24, // how long a story stays up
  postMedia: 4, // photos per post
};

const CATEGORIES = ["general", "meal", "workout", "progress", "achievement"];
const AUDIENCES = ["public", "followers", "only_me"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function requireObject(body, label) {
  if (!isPlainObject(body)) throw new ValidationError(`Send the ${label} as an object.`);
  return body;
}

function rejectUnknownKeys(body, allowed, label) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ValidationError(`${label} has an unexpected field: ${key}.`);
  }
}

// Trimmed text within [min, max] characters; control characters other than newlines are dropped
function text(value, label, { min = 1, max }) {
  if (typeof value !== "string") throw new ValidationError(min > 0 ? `${label} is required.` : `${label} must be text.`);
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (clean.length < min) throw new ValidationError(`${label} is required.`);
  if (clean.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return clean;
}

function optionalText(value, label, max) {
  if (value === undefined || value === null || value === "") return null;
  return text(value, label, { min: 0, max }) || null;
}

// A route parameter or body field that must be one of our UUIDs (never interpolated into SQL,
// but checked anyway so bad ids are a 400, not a database round trip)
function id(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ValidationError(`${label} isn't valid.`);
  return value.toLowerCase();
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return id(value, label);
}

// ?limit= → a page size within bounds
function pageSize(value) {
  if (value === undefined || value === "") return limits.pageDefault;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > limits.pageMax) throw new ValidationError(`limit must be between 1 and ${limits.pageMax}.`);
  return n;
}

// Cursors are "<unix ms>_<uuid>" of the last row seen, so a page never repeats or skips a
// row even when several share a timestamp
function encodeCursor(row) {
  return `${new Date(row.created_at).getTime()}_${row.id}`;
}

function decodeCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError("cursor isn't valid.");
  const match = /^(\d{1,16})_([0-9a-f-]{36})$/i.exec(value);
  if (!match || !UUID.test(match[2])) throw new ValidationError("cursor isn't valid.");
  return { createdAt: new Date(Number(match[1])), id: match[2].toLowerCase() };
}

// The photos on a post, in display order: up to limits.postMedia ids of the member's own
// uploads (ownership is checked against the database by posts.js). `mediaId`, one photo,
// is still accepted so older app builds keep working.
function mediaIdList(body) {
  if (body.mediaIds === undefined) {
    const one = optionalId(body.mediaId, "The image");
    return one ? [one] : [];
  }
  if (body.mediaId !== undefined) throw new ValidationError("Send either mediaId or mediaIds, not both.");
  if (!Array.isArray(body.mediaIds)) throw new ValidationError("mediaIds must be a list of images.");
  if (body.mediaIds.length > limits.postMedia) throw new ValidationError(`A post can have up to ${limits.postMedia} photos.`);
  const ids = body.mediaIds.map((value) => id(value, "The image"));
  if (new Set(ids).size !== ids.length) throw new ValidationError("The same photo is listed twice.");
  return ids;
}

function validatePost(body) {
  requireObject(body, "post");
  rejectUnknownKeys(body, ["body", "category", "audience", "mediaId", "mediaIds", "groupId", "clientKey"], "The post");
  const category = body.category === undefined ? "general" : body.category;
  if (!CATEGORIES.includes(category)) throw new ValidationError("Category isn't a valid choice.");
  const audience = body.audience === undefined ? "public" : body.audience;
  if (!AUDIENCES.includes(audience)) throw new ValidationError("Audience isn't a valid choice.");
  const groupId = optionalId(body.groupId, "The group");
  if (groupId && audience !== "public") throw new ValidationError("A group post is shared with the group.");
  return {
    body: text(body.body, "Post text", { max: limits.postBody }),
    category,
    audience,
    mediaIds: mediaIdList(body),
    groupId,
    // A UUID the app makes once per draft: a repeated Publish with the same key returns the saved post
    clientKey: optionalId(body.clientKey, "The client key"),
  };
}

// PATCH: text, category, audience and the photo list can change (never the author or the group)
function validatePostUpdate(body) {
  requireObject(body, "changes");
  rejectUnknownKeys(body, ["body", "category", "audience", "mediaIds"], "The changes");
  const changes = {};
  if (body.body !== undefined) changes.body = text(body.body, "Post text", { max: limits.postBody });
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) throw new ValidationError("Category isn't a valid choice.");
    changes.category = body.category;
  }
  if (body.audience !== undefined) {
    if (!AUDIENCES.includes(body.audience)) throw new ValidationError("Audience isn't a valid choice.");
    changes.audience = body.audience;
  }
  if (body.mediaIds !== undefined) changes.mediaIds = mediaIdList({ mediaIds: body.mediaIds });
  if (Object.keys(changes).length === 0) throw new ValidationError("Nothing to change.");
  return changes;
}

function validateComment(body) {
  requireObject(body, "comment");
  rejectUnknownKeys(body, ["body"], "The comment");
  return { body: text(body.body, "Comment", { max: limits.commentBody }) };
}

function validateStory(body) {
  requireObject(body, "story");
  rejectUnknownKeys(body, ["mediaId", "caption"], "The story");
  return { mediaId: id(body.mediaId, "The image"), caption: optionalText(body.caption, "Caption", limits.caption) };
}

function validateReport(body) {
  requireObject(body, "report");
  rejectUnknownKeys(body, ["reason"], "The report");
  return { reason: text(body.reason, "Reason", { max: limits.reason }) };
}

function validateGroup(body) {
  requireObject(body, "group");
  rejectUnknownKeys(body, ["name", "topic", "description", "isPrivate", "coverMediaId"], "The group");
  const name = text(body.name, "Group name", { min: 2, max: limits.groupName });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!SLUG.test(slug)) throw new ValidationError("Group name needs some letters or digits.");
  if (body.isPrivate !== undefined && typeof body.isPrivate !== "boolean") throw new ValidationError("isPrivate must be true or false.");
  return {
    name,
    slug,
    topic: text(body.topic, "Topic", { max: limits.groupTopic }),
    description: text(body.description, "Description", { max: limits.groupDescription }),
    isPrivate: body.isPrivate === true,
    coverMediaId: optionalId(body.coverMediaId, "The cover image"),
  };
}

function validateMessage(body) {
  requireObject(body, "message");
  rejectUnknownKeys(body, ["body"], "The message");
  return { body: text(body.body, "Message", { max: limits.messageBody }) };
}

// Own community settings
function validateProfileSettings(body) {
  requireObject(body, "settings");
  rejectUnknownKeys(body, ["isPrivate", "bio"], "The settings");
  const changes = {};
  if (body.isPrivate !== undefined) {
    if (typeof body.isPrivate !== "boolean") throw new ValidationError("isPrivate must be true or false.");
    changes.isPrivate = body.isPrivate;
  }
  if (body.bio !== undefined) changes.bio = optionalText(body.bio, "Bio", 160);
  if (Object.keys(changes).length === 0) throw new ValidationError("Nothing to change.");
  return changes;
}

// ?search= for groups: short, trimmed, and the SQL wildcard characters are escaped
function searchTerm(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError("search must be text.");
  const clean = value.trim().slice(0, limits.search);
  return clean === "" ? null : clean.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// A user id as Clerk issues them (for starting a conversation)
function clerkUserId(value, label) {
  if (typeof value !== "string" || !/^user_[A-Za-z0-9]{10,64}$/.test(value)) throw new ValidationError(`${label} isn't valid.`);
  return value;
}

module.exports = {
  limits, CATEGORIES, AUDIENCES, validateProfileSettings,
  id, optionalId, pageSize, encodeCursor, decodeCursor, searchTerm, clerkUserId,
  validatePost, validatePostUpdate, validateComment, validateStory, validateReport, validateGroup, validateMessage,
};
