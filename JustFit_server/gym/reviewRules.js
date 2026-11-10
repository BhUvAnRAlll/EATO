// Gym reviews (Gym Profile Management phase 4, 2026-11-09; pure, unit-tested): what a member sends
// when they rate a branch, what the gym may send back (a reply, or hiding the words with a reason),
// the reviewer's name as others see it, and the summary members read. A rating is only ever the
// member's: nothing here lets the gym change it, and a hidden review's stars still count.
const { ValidationError } = require("../profile");

const COMMENT_MAX = 500;
const REPLY_MAX = 500;
const PAGE_SIZE = 20;
const RECENT = 3; // reviews shown on a gym's page before "See all"
const HIDE_REASONS = ["abusive", "spam", "personal", "not_member", "other"];
const VIEWS = ["all", "unreplied", "hidden"];
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const isObject = (body) => body && typeof body === "object" && !Array.isArray(body);
function only(body, keys, what) {
  if (!isObject(body)) throw new ValidationError(`Send the ${what} as an object.`);
  for (const key of Object.keys(body)) if (!keys.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}

// Text kept as written (line breaks too, at most two in a row), trimmed; empty is null
function text(value, max, words) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`Write the ${words} as text.`);
  const tidy = value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (CONTROL.test(tidy)) throw new ValidationError(`The ${words} has characters we can't show.`);
  if (tidy.length > max) throw new ValidationError(`Keep the ${words} to ${max} characters.`);
  return tidy || null;
}

/** PUT /api/gyms/:id/review { rating, comment? }: whole stars 1 to 5, an optional comment */
function reviewBody(body) {
  only(body, ["rating", "comment"], "review");
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw new ValidationError("Pick 1 to 5 stars.");
  const comment = text(body.comment, COMMENT_MAX, "review");
  if (comment !== null && comment.length < 3) throw new ValidationError("Write a few more words, or leave the review without them.");
  return { rating: body.rating, comment };
}

/** PUT /api/gym/reviews/:id/reply { text } */
function replyBody(body) {
  only(body, ["text"], "reply");
  const reply = text(body.text, REPLY_MAX, "reply");
  if (reply === null || reply.length < 2) throw new ValidationError("Write the reply first.");
  return { reply };
}

/** POST /api/gym/reviews/:id/hide { reason } */
function hideBody(body) {
  only(body, ["reason"], "request");
  if (!HIDE_REASONS.includes(body.reason)) throw new ValidationError("Pick why the review should be hidden.");
  return { reason: body.reason };
}

/** GET /api/gym/reviews?view=&page= */
function reviewsQuery(query = {}) {
  for (const key of Object.keys(query)) if (!["view", "page"].includes(key)) throw new ValidationError(`Unexpected filter: ${key}.`);
  const view = query.view === undefined ? "all" : query.view;
  if (!VIEWS.includes(view)) throw new ValidationError("Pick All, Not replied or Hidden.");
  return { view, page: pageOf(query.page) };
}

/** ?page= for a member's list too: a whole number from 1, 1 when left out */
function pageOf(value) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,3}$/.test(value)) throw new ValidationError("Pick a page from 1.");
  return Number(value);
}
function memberQuery(query = {}) {
  for (const key of Object.keys(query)) if (key !== "page") throw new ValidationError(`Unexpected filter: ${key}.`);
  return { page: pageOf(query.page) };
}

// The reviewer as others see them: the first name and the last name's initial ("Arjun M."), never
// the full name, number or account; someone without a name is "justFit member"
function reviewerName(fullName) {
  const words = typeof fullName === "string" ? fullName.trim().split(/\s+/).filter(Boolean) : [];
  if (words.length === 0 || words[0].length < 2) return "justFit member";
  const first = words[0].slice(0, 30);
  const last = words.length > 1 ? words[words.length - 1] : "";
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/**
 * The branch's rating from every review, hidden ones included (the gym can't hide a rating):
 * the average to one decimal, the number of reviews and how many gave each number of stars.
 * rows: [{ rating, n }]
 */
function summary(rows) {
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rows) if (counts[r.rating] !== undefined) counts[r.rating] += Number(r.n);
  const count = Object.values(counts).reduce((a, b) => a + b, 0);
  const total = Object.entries(counts).reduce((a, [stars, n]) => a + Number(stars) * n, 0);
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, counts };
}

module.exports = { COMMENT_MAX, REPLY_MAX, PAGE_SIZE, RECENT, HIDE_REASONS, VIEWS, reviewBody, replyBody, hideBody, reviewsQuery, memberQuery, reviewerName, summary };
