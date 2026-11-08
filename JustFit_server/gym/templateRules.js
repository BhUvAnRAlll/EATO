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

// PUT /api/gym/templates/:kind: { text }. Trimmed, 10-300 characters, line breaks allowed but no
// other control characters, and only the kind's own {placeholders} (a stray brace is refused, so
// a typo like {nmae} or {name never reaches a member as written)
function templateBody(kind, body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "text")) throw new ValidationError("Send the template's text.");
  if (typeof body.text !== "string") throw new ValidationError("Send the template's text.");
  const text = body.text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_CHARS) throw new ValidationError(`Write at least ${MIN_CHARS} characters.`);
  if (text.length > MAX_CHARS) throw new ValidationError(`Keep the message to ${MAX_CHARS} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(text)) throw new ValidationError("The message has characters we can't send.");
  const allowed = PLACEHOLDERS[kind];
  const unknown = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((name) => !allowed.includes(name));
  if (unknown !== undefined) throw new ValidationError(`{${unknown.slice(0, 20)}} isn't a placeholder this message can use. Use ${allowed.map((p) => `{${p}}`).join(", ")}.`);
  if (/[{}]/.test(text.replace(/\{[^{}]*\}/g, ""))) throw new ValidationError("A placeholder is missing its { or }.");
  return { text };
}

module.exports = { KINDS, PLACEHOLDERS, MIN_CHARS, MAX_CHARS, kindParam, templateBody };
