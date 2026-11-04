// The gym portal's SMS to members (Send Bulk SMS, Auto Reminders, the member list's reminder
// button): the four messages, what each auto reminder targets, the manual-send groups and the
// checks on what the app sends. Pure, unit-tested (__tests__/gym-sms-rules.test.js).
//
// SMS in India go out on DLT-registered templates: every message below must be registered on
// Fast2SMS's DLT portal word for word, with each {#var#} where the {…} placeholders are, and its
// template id set in .env (FAST2SMS_GYM_<KIND>_ID). Each variable is at most 30 characters.
const { ValidationError } = require("../profile");

const KINDS = ["expiry", "expired", "due", "birthday"];

// The text, and the variables in the order the DLT template has them
const TEMPLATES = {
  expiry: { text: "Hi {name}, your membership at {gym} ends on {date}. Renew to keep training with us. - justFit", vars: ["name", "gym", "date"] },
  expired: { text: "Hi {name}, your membership at {gym} ended on {date}. Renew today to get back on track. - justFit", vars: ["name", "gym", "date"] },
  due: { text: "Hi {name}, a payment of Rs {amount} is due at {gym} for membership {code}. Please pay at the front desk. - justFit", vars: ["name", "amount", "gym", "code"] },
  birthday: { text: "Happy birthday {name}! Wishing you a great year of health and strength from all of us at {gym}. - justFit", vars: ["name", "gym"] },
};

// The Auto Reminders screen's rows (the user's design): title and when it goes
const AUTO = {
  expiry: { title: "Membership Expiry Reminder", when: "1 day before expiry" },
  expired: { title: "Membership Expired Reminder", when: "3 days after expiry" },
  due: { title: "Due Reminder", when: "Weekly — all pending dues" },
  birthday: { title: "Birthday Wishes", when: "On member's birthday" },
};

// Manual Send: a group of members and the message it gets
const GROUPS = {
  expiring: { label: "Expiring in 3 days", kind: "expiry" },
  expired: { label: "Expired in the last 30 days", kind: "expired" },
  due: { label: "Payment due", kind: "due" },
  birthday: { label: "Birthday today", kind: "birthday" },
};

const MAX_VAR = 30;
const MAX_RECIPIENTS = 200;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const clip = (value) => String(value).replace(/\s+/g, " ").trim().slice(0, MAX_VAR);

// A member's values for a message (first name, the gym and branch, the plan's end, the amount)
function variablesFor(kind, member, gym) {
  const all = {
    name: clip(member.full_name.split(" ")[0]),
    gym: clip(`${gym.brand} ${gym.branch}`),
    date: shortDate(member.expires_on),
    amount: clip(Number(member.due_amount).toLocaleString("en-IN")),
    code: clip(member.member_code),
  };
  return TEMPLATES[kind].vars.map((key) => all[key]);
}

// The message as the member reads it
function render(kind, values) {
  let i = 0;
  return TEMPLATES[kind].text.replace(/\{[a-z]+\}/g, () => values[i++] ?? "");
}

// The Preview: the message with a sample member
function preview(kind, gym, today) {
  const sample = { full_name: "Priya", expires_on: today, due_amount: 1500, member_code: "FOR-TUM-0001" };
  return render(kind, variablesFor(kind, sample, gym));
}

// Monday of the date's week: due reminders go once a week per member
function weekOf(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// The key that makes an auto reminder go once: per plan end (expiry, expired), per week (due),
// per year (birthday). A renewal moves the plan's end, so its reminders can go again.
function autoKey(kind, member, today) {
  if (kind === "expiry" || kind === "expired") return `${kind}:${member.expires_on}`;
  if (kind === "due") return `due:${weekOf(today)}`;
  return `birthday:${today.slice(0, 4)}`;
}

// Auto reminders go out in the daytime only, India time (10:00 to 19:59)
function reminderHour(now = Date.now()) {
  const hour = new Date(now + 330 * 60 * 1000).getUTCHours();
  return hour >= 10 && hour < 20;
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// PATCH /api/gym/sms/settings: { expiry: true, birthday: false } (one or more)
function settingsBody(body) {
  if (!isPlainObject(body) || Object.keys(body).length === 0) throw new ValidationError("Say which reminders to switch on or off.");
  for (const [key, value] of Object.entries(body)) {
    if (!KINDS.includes(key)) throw new ValidationError("That reminder doesn't exist.");
    if (typeof value !== "boolean") throw new ValidationError("Switch a reminder on or off with true or false.");
  }
  return body;
}

// POST /api/gym/sms/send: { group }
function sendBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== "group")) throw new ValidationError("Pick a group of members.");
  if (!Object.hasOwn(GROUPS, body.group)) throw new ValidationError("Pick a group of members.");
  return { group: body.group };
}

// POST /api/gym/members/:id/sms: { kind }
function memberSmsBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== "kind") || !KINDS.includes(body.kind)) throw new ValidationError("Pick a reminder: expiry, expired, due or birthday.");
  return { kind: body.kind };
}

// GET /api/gym/sms/logs?before=<id>
function logsQuery(query = {}) {
  for (const key of Object.keys(query)) if (key !== "before") throw new ValidationError("Unexpected query.");
  if (query.before === undefined || query.before === "") return { before: null };
  if (typeof query.before !== "string" || !/^[1-9][0-9]{0,15}$/.test(query.before)) throw new ValidationError("That page doesn't exist.");
  return { before: Number(query.before) };
}

// Super Admin › a gym › SMS credits: { credits } added (1-100,000)
function creditsBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== "credits")) throw new ValidationError("Say how many credits to add.");
  if (!Number.isInteger(body.credits) || body.credits < 1 || body.credits > 100_000) throw new ValidationError("Add between 1 and 100,000 credits.");
  return { credits: body.credits };
}

module.exports = {
  KINDS, TEMPLATES, AUTO, GROUPS, MAX_VAR, MAX_RECIPIENTS,
  variablesFor, render, preview, weekOf, autoKey, reminderHour, settingsBody, sendBody, memberSmsBody, logsQuery, creditsBody,
};
