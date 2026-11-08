// Gym expenses' input rules (pure, unit-tested): what Manage › Expense may send. Each expense is
// one of a fixed list of categories (Other needs a title), who was paid, cash or online, the
// amount in whole rupees, the day it was spent (a year back to today) and an optional note.
const { ValidationError } = require("../profile");
const rules = require("./rules");

// In the order the app shows them
const CATEGORIES = ["rent", "salary", "electricity", "water", "equipment", "maintenance", "cleaning", "marketing", "stock", "other"];
const METHODS = ["online", "cash"];
const MONTHS_BACK = 24;
const FIELDS = ["category", "title", "paidTo", "method", "amount", "spentOn", "note"];

const blank = (value) => value === undefined || value === null || value === "";

// "" or missing → null; otherwise cleaned text of 1 to `max` characters
function optionalText(value, label, max) {
  if (blank(value)) return null;
  if (typeof value !== "string" || value.length > max * 2) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  const text = rules.cleanText(value, max + 1);
  if (text.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return text || null;
}

// POST /api/gym/expenses and PUT /api/gym/expenses/:id: the whole expense (an edit sends every
// field again, so what is saved is always exactly what the sheet showed)
function expenseBody(body, today = rules.todayInIndia()) {
  rules.onlyKeys(body, FIELDS);
  if (!CATEGORIES.includes(body.category)) throw new ValidationError("Pick what the money was spent on.");
  if (!METHODS.includes(body.method)) throw new ValidationError("Pick online or cash.");
  if (!Number.isInteger(body.amount) || body.amount < 1 || body.amount > rules.limits.amount) {
    throw new ValidationError("Enter the amount in whole rupees, at least ₹1, up to ₹10,00,000.");
  }
  const title = body.category === "other" ? rules.requiredText(body.title, "what it was for", rules.limits.name) : optionalText(body.title, "title", rules.limits.name);
  const spentOn = blank(body.spentOn) ? today : body.spentOn;
  const bad = () => new ValidationError("Pick the day it was spent: from a year ago to today.");
  if (typeof spentOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) throw bad();
  const date = new Date(`${spentOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== spentOn) throw bad();
  if (spentOn < rules.addDays(today, -365) || spentOn > today) throw bad();
  return {
    category: body.category,
    title,
    paidTo: optionalText(body.paidTo, "name of who was paid", rules.limits.name),
    method: body.method,
    amount: body.amount,
    spentOn,
    note: optionalText(body.note, "note", rules.limits.note),
  };
}

// "2026-11" → the first and last day of that month
function monthRange(month) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

// "2026-11" moved by `count` months
function shiftMonth(month, count) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

// GET /api/gym/expenses?month=YYYY-MM&category=&search=&page=: one month (this month by default,
// up to 24 months back), one category or all, a search over the title, who was paid and the note
function expensesQuery(query = {}, today = rules.todayInIndia()) {
  const thisMonth = today.slice(0, 7);
  const month = blank(query.month) ? thisMonth : query.month;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > thisMonth || month < shiftMonth(thisMonth, -MONTHS_BACK)) {
    throw new ValidationError(`Pick a month from the last ${MONTHS_BACK} months.`);
  }
  const category = blank(query.category) || query.category === "all" ? null : query.category;
  if (category !== null && !CATEGORIES.includes(category)) throw new ValidationError("Pick a category, or all.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > rules.limits.search) throw new ValidationError(`Search for at most ${rules.limits.search} characters.`);
  let page = 1;
  if (!blank(query.page)) {
    if (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page)) throw new ValidationError("That page isn't valid.");
    page = Number(query.page);
  }
  return { month, ...monthRange(month), category, search, page };
}

module.exports = { CATEGORIES, MONTHS_BACK, expenseBody, expensesQuery, monthRange, shiftMonth };
