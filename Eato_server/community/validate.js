// Input checks for the community routes: one friendly line per problem, as the profile
// validators do. Pure functions (no database), so they are unit-tested directly.
const { ValidationError } = require("../profile");

const limits = {
  postBody: 1000,
  commentBody: 500,
  caption: 200,
  messageBody: 1000,
  reason: 300,
  search: 60,
  pageMax: 50,
  pageDefault: 20,
  storyHours: 24, // how long a story stays up
  activeStories: 30, // stories one member can have up at once
  postMedia: 4, // photos per post
  headline: 120, // progress title, meal name, achievement title
  milestone: 120,
  achievementDetail: 300,
  location: 120,
  tags: 10, // friends tagged on one post
  pollOptionsMin: 2,
  pollOptionsMax: 6,
  pollOption: 80,
  mealKcal: 5000,
  mealProtein: 500,
};

// A post's type. "general" and "workout" are the older types (no details); Create Post offers
// photo, progress, meal, achievement, question and poll.
const CATEGORIES = ["general", "meal", "workout", "progress", "achievement", "photo", "question", "poll"];
// Types fixed once posted: a photo post needs its photos and a poll its options
const FIXED_CATEGORIES = ["photo", "question", "poll"];
// Which detail fields each type may carry (anything else is refused)
const DETAIL_FIELDS = {
  general: [],
  workout: [],
  photo: [],
  question: [],
  poll: [],
  progress: ["headline", "detail", "detailDate"],
  meal: ["headline", "mealKcal", "mealProteinG"],
  achievement: ["headline", "detail"],
};
// Types whose caption may be left empty (their photo or details say enough)
const CAPTION_OPTIONAL = ["photo", "progress", "meal", "achievement"];
const DETAIL_KEYS = ["headline", "detail", "detailDate", "mealKcal", "mealProteinG"];
const AUDIENCES = ["public", "followers", "only_me"];
// Who sees a story: everyone eligible, accepted followers, or the owner's Close Friends
const STORY_AUDIENCES = ["public", "followers", "close_friends"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// "YYYY-MM-DD", a real calendar date, not after tomorrow (time zones), not before 2000
function optionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${label} must be a date.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ValidationError(`${label} must be a date.`);
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  if (date.getTime() > tomorrow || value < "2000-01-01") throw new ValidationError(`${label} can't be in the future.`);
  return value;
}

function optionalWhole(value, label, max) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new ValidationError(`${label} must be a whole number from 0 to ${max}.`);
  return value;
}

// The details a type carries: a field the type doesn't use is refused. The headline is optional
// here so older app builds (which sent a meal or progress post with no details) keep working;
// Create Post asks for it. Returns every detail column, null where unused, so a type's other
// fields can never linger.
function postDetails(category, body) {
  const allowed = DETAIL_FIELDS[category];
  for (const key of DETAIL_KEYS) {
    if (body[key] !== undefined && body[key] !== null && !allowed.includes(key)) throw new ValidationError(`A ${category} post can't have ${key}.`);
  }
  const headlineLabel = category === "meal" ? "Meal name" : "Title";
  const headline = allowed.includes("headline") ? optionalText(body.headline, headlineLabel, limits.headline) : null;
  return {
    headline,
    detail: allowed.includes("detail") ? optionalText(body.detail, category === "progress" ? "Milestone" : "Description", category === "progress" ? limits.milestone : limits.achievementDetail) : null,
    detailDate: allowed.includes("detailDate") ? optionalDate(body.detailDate, "Date") : null,
    mealKcal: allowed.includes("mealKcal") ? optionalWhole(body.mealKcal, "Calories", limits.mealKcal) : null,
    mealProteinG: allowed.includes("mealProteinG") ? optionalWhole(body.mealProteinG, "Protein", limits.mealProtein) : null,
  };
}

// Friends to tag: distinct Clerk user ids, up to limits.tags (friendship is checked by posts.js)
function taggedUserIdList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("taggedUserIds must be a list.");
  if (value.length > limits.tags) throw new ValidationError(`Tag up to ${limits.tags} people.`);
  const ids = value.map((item) => clerkUserId(item, "A tagged member"));
  if (new Set(ids).size !== ids.length) throw new ValidationError("Each person can be tagged once.");
  return ids;
}

// A poll's choices: 2 to 6, each 1 to 80 characters, no two the same (ignoring case)
function pollOptionList(value) {
  if (!Array.isArray(value)) throw new ValidationError(`A poll needs ${limits.pollOptionsMin} to ${limits.pollOptionsMax} options.`);
  if (value.length < limits.pollOptionsMin || value.length > limits.pollOptionsMax) throw new ValidationError(`A poll needs ${limits.pollOptionsMin} to ${limits.pollOptionsMax} options.`);
  const options = value.map((item, index) => text(item, `Option ${index + 1}`, { max: limits.pollOption }));
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) throw new ValidationError("Each poll option must be different.");
  return options;
}

function validatePost(body) {
  requireObject(body, "post");
  rejectUnknownKeys(body, ["body", "category", "audience", "mediaId", "mediaIds", "clientKey", ...DETAIL_KEYS, "location", "taggedUserIds", "pollOptions"], "The post");
  const category = body.category === undefined ? "general" : body.category;
  if (!CATEGORIES.includes(category)) throw new ValidationError("Category isn't a valid choice.");
  const audience = body.audience === undefined ? "public" : body.audience;
  if (!AUDIENCES.includes(audience)) throw new ValidationError("Audience isn't a valid choice.");
  const mediaIds = mediaIdList(body);
  if (category === "photo" && mediaIds.length === 0) throw new ValidationError("Add at least one photo.");
  if (category === "poll" && mediaIds.length > 0) throw new ValidationError("A poll can't have photos.");
  if (category !== "poll" && body.pollOptions !== undefined) throw new ValidationError("Only a poll has options.");
  const captionLabel = category === "question" ? "Question" : category === "poll" ? "Poll question" : "Post text";
  return {
    body: text(body.body ?? (CAPTION_OPTIONAL.includes(category) ? "" : undefined), captionLabel, { min: CAPTION_OPTIONAL.includes(category) ? 0 : 1, max: limits.postBody }),
    category,
    audience,
    mediaIds,
    ...postDetails(category, body),
    location: optionalText(body.location, "Location", limits.location),
    taggedUserIds: taggedUserIdList(body.taggedUserIds),
    pollOptions: category === "poll" ? pollOptionList(body.pollOptions) : [],
    // A UUID the app makes once per draft: a repeated Publish with the same key returns the saved post
    clientKey: optionalId(body.clientKey, "The client key"),
  };
}

// PATCH: the text, audience, photos, location and the type's details can change (never the
// author, the group, the tags or a poll's options). A post's type can change only among the
// older types; photo, question and poll posts keep theirs. posts.js applies the details for
// the type the post ends up with.
function validatePostUpdate(body) {
  requireObject(body, "changes");
  rejectUnknownKeys(body, ["body", "category", "audience", "mediaIds", ...DETAIL_KEYS, "location"], "The changes");
  const changes = {};
  if (body.body !== undefined) changes.body = text(body.body, "Post text", { min: 0, max: limits.postBody });
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) throw new ValidationError("Category isn't a valid choice.");
    if (FIXED_CATEGORIES.includes(body.category)) throw new ValidationError("A post can't be changed into that type.");
    changes.category = body.category;
  }
  if (body.audience !== undefined) {
    if (!AUDIENCES.includes(body.audience)) throw new ValidationError("Audience isn't a valid choice.");
    changes.audience = body.audience;
  }
  if (body.mediaIds !== undefined) changes.mediaIds = mediaIdList({ mediaIds: body.mediaIds });
  if (body.location !== undefined) changes.location = optionalText(body.location, "Location", limits.location);
  // The raw details, checked by validateDetailUpdate once posts.js knows the post's type
  const detailInput = Object.fromEntries(DETAIL_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  if (Object.keys(detailInput).length > 0) changes.detailInput = detailInput;
  if (Object.keys(changes).length === 0) throw new ValidationError("Nothing to change.");
  return changes;
}

// The details sent with an edit, checked against the type the post ends up with (posts.js
// calls this once it knows the post's current type)
function validateDetailUpdate(category, body) {
  return postDetails(category, body);
}

// A poll vote: the chosen option's id
function validateVote(body) {
  requireObject(body, "vote");
  rejectUnknownKeys(body, ["optionId"], "The vote");
  return { optionId: id(body.optionId, "The option") };
}

function validateComment(body) {
  requireObject(body, "comment");
  rejectUnknownKeys(body, ["body"], "The comment");
  return { body: text(body.body, "Comment", { max: limits.commentBody }) };
}

function validateStory(body) {
  requireObject(body, "story");
  rejectUnknownKeys(body, ["mediaId", "caption", "audience"], "The story");
  const audience = body.audience === undefined ? "public" : body.audience;
  if (!STORY_AUDIENCES.includes(audience)) throw new ValidationError("Audience isn't a valid choice.");
  return { mediaId: id(body.mediaId, "The image"), caption: optionalText(body.caption, "Caption", limits.caption), audience };
}

function validateReport(body) {
  requireObject(body, "report");
  rejectUnknownKeys(body, ["reason"], "The report");
  return { reason: text(body.reason, "Reason", { max: limits.reason }) };
}

// `id` is optional: a UUID the app made for this message, so a retried send stores it once
function validateMessage(body) {
  requireObject(body, "message");
  rejectUnknownKeys(body, ["body", "id"], "The message");
  return { body: text(body.body, "Message", { max: limits.messageBody }), id: optionalId(body.id, "The message id") };
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
  limits, CATEGORIES, AUDIENCES, STORY_AUDIENCES, validateProfileSettings, requireObject, rejectUnknownKeys, text, optionalText,
  id, optionalId, pageSize, encodeCursor, decodeCursor, searchTerm, clerkUserId,
  validatePost, validatePostUpdate, validateDetailUpdate, validateVote, validateComment, FIXED_CATEGORIES, CAPTION_OPTIONAL, DETAIL_FIELDS, validateStory, validateReport, validateMessage,
};
