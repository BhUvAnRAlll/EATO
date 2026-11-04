// The gym admin portal's input rules (pure, unit-tested): what the gym staff and the justFit
// admin may send, cleaned and bounded. Anything unexpected is refused with a 400 and one line.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");

const limits = {
  name: 80,
  area: 80,
  city: 60,
  note: 200,
  amount: 1_000_000, // rupees, per payment or due
  search: 60,
  page: 50,
};
const PLAN_MONTHS = [1, 3, 6, 12];
const METHODS = ["online", "cash"];
const SALE_KINDS = { supplement: "Supplement Sale", merchandise: "Merchandise Sale", other: "Sale" };
const MEMBER_FILTERS = ["all", "due", "expiring", "expired", "in_today"];
const PAYMENT_KINDS = ["admission", "renewal", "due", "sale"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function onlyKeys(body, keys) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  const extra = Object.keys(body).filter((key) => !keys.includes(key));
  if (extra.length > 0) throw new ValidationError("That request has fields we don't use.");
}

// Letters, numbers and everyday punctuation, one space at a time
const cleanText = (value, max) =>
  typeof value === "string" ? value.replace(/[^\p{L}\p{N} ,.'()/&+:#?!-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

function requiredText(value, label, max, min = 2) {
  if (typeof value !== "string" || value.length > max * 2) throw new ValidationError(`Enter the ${label}.`);
  const text = cleanText(value, max + 1);
  if (text.length < min) throw new ValidationError(`Enter the ${label}.`);
  if (text.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return text;
}

// "" or missing → null; otherwise a valid Indian mobile number
function optionalPhone(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizePhone(value);
}

function rupees(value, label, { min = 1 } = {}) {
  if (!Number.isInteger(value) || value < min || value > limits.amount) {
    throw new ValidationError(`Enter the ${label} in whole rupees${min > 0 ? `, at least ₹${min}` : ""}, up to ₹10,00,000.`);
  }
  return value;
}

function method(value) {
  if (!METHODS.includes(value)) throw new ValidationError("Pick online or cash.");
  return value;
}

function months(value) {
  if (!PLAN_MONTHS.includes(value)) throw new ValidationError("Pick a plan: 1, 3, 6 or 12 months.");
  return value;
}

// A positive whole-number id from the path
function id(value, what = "member") {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ValidationError(`That ${what} doesn't exist.`);
  return Number(value);
}

// A fee and what was paid now; the rest is owed
function feeAndPaid(body) {
  const fee = rupees(body.fee, "plan fee");
  const paid = rupees(body.paid, "amount paid");
  if (paid > fee) throw new ValidationError("The amount paid can't be more than the plan fee.");
  return { fee, paid, due: fee - paid };
}

// A new member and what they paid
function admissionBody(body) {
  onlyKeys(body, ["name", "phone", "months", "fee", "paid", "method"]);
  return { name: requiredText(body.name, "member's name", limits.name), phone: optionalPhone(body.phone), months: months(body.months), ...feeAndPaid(body), method: method(body.method) };
}

// A member renewing their plan
function renewalBody(body) {
  onlyKeys(body, ["months", "fee", "paid", "method"]);
  return { months: months(body.months), ...feeAndPaid(body), method: method(body.method) };
}

// Part or all of what a member owes
function duePaymentBody(body) {
  onlyKeys(body, ["amount", "method"]);
  return { amount: rupees(body.amount, "amount"), method: method(body.method) };
}

// A shop sale (supplements, merchandise)
function saleBody(body) {
  onlyKeys(body, ["item", "category", "amount", "method"]);
  if (!Object.hasOwn(SALE_KINDS, body.category)) throw new ValidationError("Pick what was sold: supplement, merchandise or other.");
  return { item: requiredText(body.item, "item", limits.name), detail: SALE_KINDS[body.category], amount: rupees(body.amount, "amount"), method: method(body.method) };
}

function enquiryBody(body) {
  onlyKeys(body, ["name", "phone", "note"]);
  const note = body.note === undefined || body.note === null ? "" : cleanText(String(body.note).slice(0, limits.note * 2), limits.note);
  return { name: requiredText(body.name, "name", limits.name), phone: optionalPhone(body.phone), note: note || null };
}

// A member's name and phone, corrected
function memberEditBody(body) {
  onlyKeys(body, ["name", "phone"]);
  const out = {};
  if (body.name !== undefined) out.name = requiredText(body.name, "member's name", limits.name);
  if (body.phone !== undefined) out.phone = optionalPhone(body.phone);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name or the phone number.");
  return out;
}

function membersQuery(query = {}) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!MEMBER_FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, due, expiring, expired or in today.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > limits.search) throw new ValidationError(`Search for at most ${limits.search} characters.`);
  return { filter, search };
}

// Newest first, 50 at a time; `before` is the last id of the previous page
function paymentsQuery(query = {}) {
  const kind = query.kind === undefined || query.kind === "" ? null : query.kind;
  if (kind !== null && !PAYMENT_KINDS.includes(kind)) throw new ValidationError("Pick a type: admission, renewal, due or sale.");
  const before = query.before === undefined || query.before === "" ? null : id(String(query.before), "page");
  const today = query.today === "1";
  return { kind, before, today };
}

// A gym, as the justFit admin creates or edits it
function gymBody(body, { creating }) {
  onlyKeys(body, ["name", "area", "city"]);
  const out = {};
  if (creating || body.name !== undefined) out.name = requiredText(body.name, "gym's name", limits.name);
  if (creating || body.area !== undefined) out.area = requiredText(body.area, "area", limits.area);
  if (creating || body.city !== undefined) out.city = requiredText(body.city, "city", limits.city);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name, the area or the city.");
  return out;
}

// The gym_admin account to link, by its sign-in number
function staffBody(body) {
  onlyKeys(body, ["phone"]);
  return { phone: normalizePhone(body.phone) };
}

// ---- dates (India's calendar) -------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60 * 1000;

// Today in India as YYYY-MM-DD (the server's clock may be in any zone)
const todayInIndia = (now = Date.now()) => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

// YYYY-MM-DD plus whole months, kept on a real day (31 Jan + 1 month → 28/29 Feb)
function addMonths(isoDate, count) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const addDays = (isoDate, count) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

// A plan bought on `today` for `count` months covers up to the day before the same date
const planEnd = (startDate, count) => addDays(addMonths(startDate, count), -1);

// A renewal starts the day after the current plan ends, or today if it already ended
function renewedUntil(expiresOn, today, count) {
  const start = expiresOn >= today ? addDays(expiresOn, 1) : today;
  return planEnd(start, count);
}

module.exports = {
  limits,
  PLAN_MONTHS,
  id,
  admissionBody,
  renewalBody,
  duePaymentBody,
  saleBody,
  enquiryBody,
  memberEditBody,
  membersQuery,
  paymentsQuery,
  gymBody,
  staffBody,
  todayInIndia,
  addMonths,
  addDays,
  planEnd,
  renewedUntil,
};
