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
const MEMBER_FILTERS = ["all", "due", "overdue", "expiring", "expiring_soon", "expired", "in_today", "birthday"];
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

// The date an amount owed should be paid by: a real YYYY-MM-DD from today to a year ahead
function dueByDate(value, today = todayInIndia()) {
  const bad = () => new ValidationError("Pick the date the rest should be paid by: from today to a year ahead.");
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw bad();
  if (value < today || value > addDays(today, 365)) throw bad();
  return value;
}

// A fee and what was paid now; the rest is owed, by the date given (needed only when something is
// owed; ignored when it's paid in full)
function feeAndPaid(body) {
  const fee = rupees(body.fee, "plan fee");
  const paid = rupees(body.paid, "amount paid");
  if (paid > fee) throw new ValidationError("The amount paid can't be more than the plan fee.");
  const due = fee - paid;
  if (due > 0 && (body.dueBy === undefined || body.dueBy === null || body.dueBy === "")) throw new ValidationError("Pick the date the rest should be paid by.");
  return { fee, paid, due, dueBy: due > 0 ? dueByDate(body.dueBy) : null };
}

const GENDERS = ["male", "female", "other"];
// "" or missing → null; otherwise one of the allowed values
function optionalChoice(value, allowed, message) {
  if (value === undefined || value === null || value === "") return null;
  if (!allowed.includes(value)) throw new ValidationError(message);
  return value;
}
const gender = (value) => optionalChoice(value, GENDERS, "Pick male, female or other.");

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[A-Za-z]{2,}$/;
const blank = (value) => value === undefined || value === null || value === "";

// The optional details from Add New Member: email, height, weight, address, notes. Missing or ""
// is null. Only the keys sent are returned (so an edit changes only those).
function memberDetails(body) {
  const out = {};
  if (body.email !== undefined) {
    if (blank(body.email)) out.email = null;
    else if (typeof body.email !== "string" || body.email.length > 120 || !EMAIL.test(body.email.trim())) throw new ValidationError("Enter a valid email address.");
    else out.email = body.email.trim().toLowerCase();
  }
  if (body.heightCm !== undefined) {
    if (blank(body.heightCm)) out.heightCm = null;
    else if (!Number.isInteger(body.heightCm) || body.heightCm < 50 || body.heightCm > 250) throw new ValidationError("Enter the height in cm, from 50 to 250.");
    else out.heightCm = body.heightCm;
  }
  if (body.weightKg !== undefined) {
    if (blank(body.weightKg)) out.weightKg = null;
    else if (typeof body.weightKg !== "number" || !Number.isFinite(body.weightKg) || body.weightKg < 10 || body.weightKg > 300) throw new ValidationError("Enter the weight in kg, from 10 to 300.");
    else out.weightKg = Math.round(body.weightKg * 10) / 10;
  }
  for (const [key, max, label] of [["address", 200, "address"], ["notes", 300, "notes"]]) {
    if (body[key] === undefined) continue;
    if (blank(body[key])) { out[key] = null; continue; }
    if (typeof body[key] !== "string" || body[key].length > max * 2) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
    out[key] = cleanText(body[key], max) || null;
  }
  return out;
}

// A YYYY-MM-DD within [from, to], or the fallback when it's missing
function dateIn(value, { from, to, fallback, message }) {
  if (blank(value)) return fallback;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(message);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < from || value > to) throw new ValidationError(message);
  return value;
}

// A new member (their ID is made by the server) and their first payment: the plan's fee, an
// optional one-time admission amount and a discount make the amount payable; what's collected now
// is paid on the payment date, the rest is owed by the due date. The plan starts on the joining date.
function admissionBody(body, today = todayInIndia()) {
  onlyKeys(body, ["name", "phone", "dob", "gender", "email", "heightCm", "weightKg", "address", "notes", "unit", "duration", "fee", "admissionFee", "discount", "paid", "method", "dueBy", "joinedOn", "paidOn"]);
  const plan = rupees(body.fee, "plan fee");
  const admissionFee = blank(body.admissionFee) ? 0 : rupees(body.admissionFee, "admission amount", { min: 0 });
  const discount = blank(body.discount) ? 0 : rupees(body.discount, "discount", { min: 0 });
  if (discount > plan + admissionFee) throw new ValidationError("The discount can't be more than the plan and admission amounts.");
  const payable = plan + admissionFee - discount;
  if (payable < 1) throw new ValidationError("The amount payable must be at least ₹1.");
  const paid = rupees(body.paid, "amount collected");
  if (paid > payable) throw new ValidationError("The amount collected can't be more than the amount payable.");
  const due = payable - paid;
  if (due > 0 && blank(body.dueBy)) throw new ValidationError("Pick the date the rest should be paid by.");
  return {
    name: requiredText(body.name, "member's name", limits.name),
    phone: optionalPhone(body.phone),
    dob: optionalDob(body.dob),
    gender: gender(body.gender),
    email: null, heightCm: null, weightKg: null, address: null, notes: null,
    ...memberDetails(body),
    ...planLength(body),
    fee: plan,
    admissionFee,
    discount,
    payable,
    paid,
    due,
    dueBy: due > 0 ? dueByDate(body.dueBy, today) : null,
    method: method(body.method),
    joinedOn: dateIn(body.joinedOn, { from: addDays(today, -365), to: addDays(today, 60), fallback: today, message: "Pick a joining date from a year ago to two months ahead." }),
    paidOn: dateIn(body.paidOn, { from: addDays(today, -365), to: today, fallback: today, message: "Pick a payment date from a year ago to today." }),
  };
}

// Member IDs: three letters of the gym's name, three of the branch's, and the branch's running
// number, e.g. FOR-TUM-0001. Letters only, upper case; GYM / BR when a name has no letters.
function memberCode(gymName, branchName, number) {
  const part = (name, fallback) => (String(name).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || fallback);
  return `${part(gymName, "GYM")}-${part(branchName, "BR")}-${String(number).padStart(4, "0")}`;
}

// A member renewing their plan
function renewalBody(body) {
  onlyKeys(body, ["unit", "duration", "fee", "paid", "method", "dueBy"]);
  return { ...planLength(body), ...feeAndPaid(body), method: method(body.method) };
}

// Part or all of what a member owes; with part, optionally a new date for the rest
function duePaymentBody(body, today = todayInIndia()) {
  onlyKeys(body, ["amount", "method", "dueBy", "paidOn"]);
  const out = {
    amount: rupees(body.amount, "amount"),
    method: method(body.method),
    paidOn: dateIn(body.paidOn, { from: addDays(today, -365), to: today, fallback: today, message: "Pick a collected date from a year ago to today." }),
  };
  if (body.dueBy !== undefined && body.dueBy !== null && body.dueBy !== "") out.dueBy = dueByDate(body.dueBy);
  return out;
}

// Personal training a member paid for: the package ("12 sessions", "1 month with Ravi") and the
// period it covers (months or days, following on from a PT period still running)
function ptBody(body) {
  onlyKeys(body, ["package", "amount", "method", "unit", "duration"]);
  return { package: requiredText(body.package, "PT package", 60), amount: rupees(body.amount, "amount"), method: method(body.method), ...planLength(body) };
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
  if (!blank(body.note) && typeof body.note !== "string") throw new ValidationError("Enter the note as text.");
  const note = blank(body.note) ? "" : cleanText(body.note.slice(0, limits.note * 2), limits.note);
  return { name: requiredText(body.name, "name", limits.name), phone: optionalPhone(body.phone), note: note || null };
}

// A member's name and phone, corrected
function memberEditBody(body) {
  onlyKeys(body, ["name", "phone", "dob", "gender", "email", "heightCm", "weightKg", "address", "notes"]);
  const out = { ...memberDetails(body) };
  if (body.gender !== undefined) out.gender = gender(body.gender);
  if (body.name !== undefined) out.name = requiredText(body.name, "member's name", limits.name);
  if (body.phone !== undefined) out.phone = optionalPhone(body.phone);
  if (body.dob !== undefined) out.dob = optionalDob(body.dob);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name, the phone number, the date of birth, the gender or the details.");
  return out;
}

function membersQuery(query = {}) {
  const filter = query.filter === undefined || query.filter === "" ? "all" : query.filter;
  if (!MEMBER_FILTERS.includes(filter)) throw new ValidationError("Pick a filter: all, due, overdue, expiring, expiring soon, expired, in today or birthdays.");
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

// A catalogue item: a membership plan (with its length in months or days), a PT package (with a
// length too, so picking it fills the PT period), a service or a product (with how many are in
// stock, or none to not count them), and its price
const CATALOG_KINDS = ["plan", "pt", "service", "product"];
const MAX_STOCK = 100_000;
const HAS_LENGTH = ["plan", "pt"];
function catalogBody(body, { creating }) {
  onlyKeys(body, creating ? ["kind", "name", "unit", "duration", "price", "stock"] : ["name", "unit", "duration", "price", "stock"]);
  const out = {};
  if (creating) {
    if (!CATALOG_KINDS.includes(body.kind)) throw new ValidationError("Pick what it is: a plan, PT, a service or a product.");
    out.kind = body.kind;
  }
  if (creating || body.name !== undefined) out.name = requiredText(body.name, "name", limits.name);
  const hasLength = body.unit !== undefined || body.duration !== undefined;
  if (hasLength) Object.assign(out, planLength(body));
  if (creating || body.price !== undefined) out.price = rupees(body.price, "price");
  if (body.stock !== undefined) {
    if (blank(body.stock)) out.stock = null;
    else if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > MAX_STOCK) throw new ValidationError(`Enter the stock as a whole number from 0 to ${MAX_STOCK.toLocaleString("en-IN")}.`);
    else out.stock = body.stock;
  }
  if (creating && HAS_LENGTH.includes(out.kind) && !hasLength) throw new ValidationError(`Enter the ${out.kind === "pt" ? "PT package's" : "plan's"} duration.`);
  if (creating && !HAS_LENGTH.includes(out.kind) && hasLength) throw new ValidationError("Only plans and PT packages have a duration.");
  if (creating && out.kind !== "product" && body.stock !== undefined) throw new ValidationError("Only products have stock.");
  if (Object.keys(out).length === 0) throw new ValidationError("Change the name, the duration, the price or the stock.");
  return out;
}

// A product sold or a service added to a member from their ⋯ (the GymOps designs): the catalogue
// item (its price is read on the server, never sent), how many (products only), a discount, what
// was collected now, how and when; the rest is owed by `dueBy` (checked once the price is known)
function memberSaleBody(body, { product }, today = todayInIndia()) {
  onlyKeys(body, product ? ["itemId", "quantity", "discount", "paid", "method", "paidOn", "dueBy"] : ["itemId", "discount", "paid", "method", "paidOn", "dueBy"]);
  const what = product ? "product" : "service";
  if (!Number.isInteger(body.itemId) || body.itemId < 1) throw new ValidationError(`Pick the ${what}.`);
  let quantity = 1;
  if (product && !(Number.isInteger(body.quantity) && body.quantity >= 1 && body.quantity <= 100)) throw new ValidationError("Enter a quantity from 1 to 100.");
  if (product) quantity = body.quantity;
  return {
    itemId: body.itemId,
    quantity,
    discount: blank(body.discount) ? 0 : rupees(body.discount, "discount", { min: 0 }),
    paid: rupees(body.paid, "amount collected"),
    method: method(body.method),
    paidOn: dateIn(body.paidOn, { from: addDays(today, -365), to: today, fallback: today, message: "Pick a payment date from a year ago to today." }),
    dueBy: blank(body.dueBy) ? null : dueByDate(body.dueBy, today),
  };
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
  memberCode,
  memberDetails,
  renewalBody,
  duePaymentBody,
  ptBody,
  serviceBody,
  saleBody,
  enquiryBody,
  memberEditBody,
  optionalDob,
  dueByDate,
  membersQuery,
  paymentsQuery,
  gymBody,
  branchBody,
  gymDetailsBody,
  switchBody,
  catalogBody,
  memberSaleBody,
  staffBody,
  todayInIndia,
  addMonths,
  addDays,
  planEnd,
  renewedUntil,
};
