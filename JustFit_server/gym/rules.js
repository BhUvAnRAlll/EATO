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
  catalog: 100, // items per branch
};
// A plan's length: whole months (1-24) or days (1-365)
const PLAN_UNITS = { months: 24, days: 365 };
const METHODS = ["online", "cash"];
const SALE_KINDS = { supplement: "Supplement", merchandise: "Merchandise", other: "Product" };
const MEMBER_FILTERS = ["all", "due", "expiring", "expiring_soon", "expired", "in_today", "birthday"];
const PAYMENT_KINDS = ["admission", "renewal", "due", "pt", "service", "sale"];

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

// { unit, duration } from a body's `unit` ("months" or "days") and `duration`
function planLength(body) {
  if (!Object.hasOwn(PLAN_UNITS, body.unit)) throw new ValidationError("Pick the duration type: months or days.");
  const max = PLAN_UNITS[body.unit];
  if (!Number.isInteger(body.duration) || body.duration < 1 || body.duration > max) throw new ValidationError(`Enter a duration of 1 to ${max} ${body.unit}.`);
  return { unit: body.unit, duration: body.duration };
}

// "" or missing → null; otherwise a real YYYY-MM-DD between 1920 and today
function optionalDob(value, today = todayInIndia()) {
  if (value === undefined || value === null || value === "") return null;
  const bad = () => new ValidationError("Enter the date of birth as a real date, for example 15-08-1995.");
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw bad();
  if (value < "1920-01-01" || value > today) throw bad();
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
  onlyKeys(body, ["name", "phone", "dob", "unit", "duration", "fee", "paid", "method"]);
  return { name: requiredText(body.name, "member's name", limits.name), phone: optionalPhone(body.phone), dob: optionalDob(body.dob), ...planLength(body), ...feeAndPaid(body), method: method(body.method) };
}

// A member renewing their plan
function renewalBody(body) {
  onlyKeys(body, ["unit", "duration", "fee", "paid", "method"]);
  return { ...planLength(body), ...feeAndPaid(body), method: method(body.method) };
}

// Part or all of what a member owes
function duePaymentBody(body) {
  onlyKeys(body, ["amount", "method"]);
  return { amount: rupees(body.amount, "amount"), method: method(body.method) };
}

// Personal training a member paid for: the package ("12 sessions", "1 month with Ravi")
function ptBody(body) {
  onlyKeys(body, ["package", "amount", "method"]);
  return { package: requiredText(body.package, "PT package", 60), amount: rupees(body.amount, "amount"), method: method(body.method) };
}

// A service sold (a steam bath, a diet plan, a body scan)
function serviceBody(body) {
  onlyKeys(body, ["item", "amount", "method"]);
  return { item: requiredText(body.item, "service", limits.name), amount: rupees(body.amount, "amount"), method: method(body.method) };
}

// A product sold (supplements, merchandise)
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
  onlyKeys(body, ["name", "phone", "dob"]);
  const out = {};
  if (body.name !== undefined) out.name = requiredText(body.name, "member's name", limits.name);
  if (body.phone !== undefined) out.phone = optionalPhone(body.phone);
  if (body.dob !== undefined) out.dob = optionalDob(body.dob);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name, the phone number or the date of birth.");
  return out;
}

function membersQuery(query = {}) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!MEMBER_FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, due, expiring, expiring soon, expired, in today or birthdays.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > limits.search) throw new ValidationError(`Search for at most ${limits.search} characters.`);
  return { filter, search };
}

// Newest first, 50 at a time; `before` is the last id of the previous page
function paymentsQuery(query = {}) {
  const kind = query.kind === undefined || query.kind === "" ? null : query.kind;
  if (kind !== null && !PAYMENT_KINDS.includes(kind)) throw new ValidationError("Pick a type: admission, renewal, due, PT, service or product.");
  const before = query.before === undefined || query.before === "" ? null : id(String(query.before), "page");
  const today = query.today === "1";
  return { kind, before, today };
}

// A branch's name and where it is
function branchFields(body, creating) {
  const out = {};
  if (creating || body.branch !== undefined) out.branch = requiredText(body.branch, "branch name", limits.name);
  if (creating || body.area !== undefined) out.area = requiredText(body.area, "area", limits.area);
  if (creating || body.city !== undefined) out.city = requiredText(body.city, "city", limits.city);
  return out;
}

// A gym, as the justFit admin creates it (the gym's name and its first branch) or edits one branch
// (the gym's name, shared by its branches, and the branch's own name and place)
function gymBody(body, { creating }) {
  onlyKeys(body, ["name", "branch", "area", "city"]);
  const out = {};
  if (creating || body.name !== undefined) out.name = requiredText(body.name, "gym's name", limits.name);
  Object.assign(out, branchFields(body, creating));
  if (Object.keys(out).length === 0) throw new ValidationError("Change the gym's name, the branch name, the area or the city.");
  return out;
}

// Another branch of a gym, added by the justFit admin
function branchBody(body) {
  onlyKeys(body, ["branch", "area", "city"]);
  return branchFields(body, true);
}

// What a gym admin may change themselves: their branch's name and place, and their own name
function gymDetailsBody(body) {
  onlyKeys(body, ["branch", "area", "city", "adminName"]);
  const out = branchFields(body, false);
  if (body.adminName !== undefined) out.adminName = requiredText(body.adminName, "your name", limits.name);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the branch name, its area or city, or your name.");
  return out;
}

// A catalogue item: a membership plan (with its length in months or days), a PT package, a service
// or a product, and its price
const CATALOG_KINDS = ["plan", "pt", "service", "product"];
function catalogBody(body, { creating }) {
  onlyKeys(body, creating ? ["kind", "name", "unit", "duration", "price"] : ["name", "unit", "duration", "price"]);
  const out = {};
  if (creating) {
    if (!CATALOG_KINDS.includes(body.kind)) throw new ValidationError("Pick what it is: a plan, PT, a service or a product.");
    out.kind = body.kind;
  }
  if (creating || body.name !== undefined) out.name = requiredText(body.name, "name", limits.name);
  const hasLength = body.unit !== undefined || body.duration !== undefined;
  if (hasLength) Object.assign(out, planLength(body));
  if (creating || body.price !== undefined) out.price = rupees(body.price, "price");
  if (creating && out.kind === "plan" && !hasLength) throw new ValidationError("Enter the plan's duration.");
  if (creating && out.kind !== "plan" && hasLength) throw new ValidationError("Only plans have a duration.");
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name, the duration or the price.");
  return out;
}

// The branch a gym admin switches to
function switchBody(body) {
  onlyKeys(body, ["branchId"]);
  if (!Number.isInteger(body.branchId) || body.branchId < 1) throw new ValidationError("That branch doesn't exist.");
  return { branchId: body.branchId };
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

// A plan starting on `startDate` covers `count` months (up to the day before the same date) or
// `count` days (the start day included)
const planEnd = (startDate, count, unit = "months") => (unit === "days" ? addDays(startDate, count - 1) : addDays(addMonths(startDate, count), -1));

// A renewal starts the day after the current plan ends, or today if it already ended
function renewedUntil(expiresOn, today, count, unit = "months") {
  const start = expiresOn >= today ? addDays(expiresOn, 1) : today;
  return planEnd(start, count, unit);
}

module.exports = {
  limits,
  PLAN_UNITS,
  planLength,
  id,
  admissionBody,
  renewalBody,
  duePaymentBody,
  ptBody,
  serviceBody,
  saleBody,
  enquiryBody,
  memberEditBody,
  optionalDob,
  membersQuery,
  paymentsQuery,
  gymBody,
  branchBody,
  gymDetailsBody,
  switchBody,
  catalogBody,
  staffBody,
  todayInIndia,
  addMonths,
  addDays,
  planEnd,
  renewedUntil,
};
