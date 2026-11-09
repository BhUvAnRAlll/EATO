// Reminder Templates' rules (pure, unit-tested: __tests__/gym-template-rules.test.js): which
// messages a branch may reword and what a saved text may hold. The app fills the {placeholders}
// in for each member (JustFit_client/src/lib/reminderTemplates.ts keeps the same lists); the
// server only stores the text. justFit's own SMS never use these: they keep the DLT-registered
// texts in smsRules.js.
const { ValidationError } = require("../profile");

const KINDS = ["due", "expiry", "expired", "enquiry"];
// The placeholders each message may use
const PLACEHOLDERS = {
  due: ["name", "gym", "amount", "dueBy", "code"],
  expiry: ["name", "gym", "date", "code"],
  expired: ["name", "gym", "date", "code"],
  enquiry: ["name", "gym"],
};
const MIN_CHARS = 10;
const MAX_CHARS = 300;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// :kind in the path
function kindParam(value) {
  if (!KINDS.includes(value)) throw new ValidationError("That isn't one of the reminder templates.");
  return value;
}

// A template's text: trimmed, 10-300 characters, line breaks allowed but no other control
// characters, and only the allowed {placeholders} (a stray brace is refused, so a typo like {nmae}
// or {name never reaches a member as written)
function cleanText(value, allowed) {
  if (typeof value !== "string") throw new ValidationError("Send the template's text.");
  const text = value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_CHARS) throw new ValidationError(`Write at least ${MIN_CHARS} characters.`);
  if (text.length > MAX_CHARS) throw new ValidationError(`Keep the message to ${MAX_CHARS} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(text)) throw new ValidationError("The message has characters we can't send.");
  const unknown = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((name) => !allowed.includes(name));
  if (unknown !== undefined) throw new ValidationError(`{${unknown.slice(0, 20)}} isn't a placeholder this message can use. Use ${allowed.map((p) => `{${p}}`).join(", ")}.`);
  if (/[{}]/.test(text.replace(/\{[^{}]*\}/g, ""))) throw new ValidationError("A placeholder is missing its { or }.");
  return text;
}

// PUT /api/gym/templates/:kind: { text }
function templateBody(kind, body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "text")) throw new ValidationError("Send the template's text.");
  return { text: cleanText(body.text, PLACEHOLDERS[kind]) };
}

// Added templates (2026-11-08): the gym admin's own named messages for Send Reminder, beside the
// four above. They are sent to a member, so every member placeholder may be used.
const ADDED_PLACEHOLDERS = ["name", "gym", "amount", "dueBy", "date", "code"];
const NAME_MIN = 2;
const NAME_MAX = 40;
const ADDED_MAX = 20; // per branch

// POST /api/gym/templates/added and PUT /api/gym/templates/added/:id: { name, text }. The name is
// one line, 2-40 characters, with its spaces tidied
function addedBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "name" && key !== "text")) throw new ValidationError("Send the template's name and text.");
  if (typeof body.name !== "string") throw new ValidationError("Give the template a name.");
  const name = body.name.replace(/\s+/g, " ").trim();
  if (name.length < NAME_MIN) throw new ValidationError("Give the template a name.");
  if (name.length > NAME_MAX) throw new ValidationError(`Keep the name to ${NAME_MAX} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(name)) throw new ValidationError("The name has characters we can't use.");
  return { name, text: cleanText(body.text, ADDED_PLACEHOLDERS) };
}

module.exports = { KINDS, PLACEHOLDERS, ADDED_PLACEHOLDERS, MIN_CHARS, MAX_CHARS, NAME_MAX, ADDED_MAX, kindParam, templateBody, addedBody };
