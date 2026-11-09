// Members' meal problems and how the Super Admin works them (pure, unit-tested in
// __tests__/issue-rules.test.js; Meal Operations phase 6, 2026-11-10)
const { ValidationError } = require("../profile");

const CATEGORIES = ["cancellation", "refund", "missing_meal", "wrong_meal", "damaged_food", "late_delivery", "failed_delivery", "subscription", "other"];
const STATUSES = ["open", "in_progress", "resolved", "rejected"];
const ACTIONS = ["assign", "progress", "note", "resolve", "reject", "reopen"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}
function text(value, label, max, { min = 1, required = true } = {}) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new ValidationError(`Add the ${label}.`);
    return null;
  }
  if (typeof value !== "string" || CONTROL.test(value)) throw new ValidationError(`Write the ${label} as plain text.`);
  const clean = value.trim().replace(/[ \t]+/g, " ");
  if (clean.length < min) throw new ValidationError(`The ${label} is too short.`);
  if (clean.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return clean;
}

const issueCode = (id) => `ISS-${String(id).padStart(4, "0")}`;

/** POST /api/meal-issues { orderId? | subscriptionId?, category, description } (the photo rides along) */
function issueBody(body) {
  onlyFields(body, ["orderId", "subscriptionId", "category", "description"]);
  if (!CATEGORIES.includes(body.category)) throw new ValidationError("Pick what went wrong.");
  const orderId = body.orderId === undefined || body.orderId === null ? null : body.orderId;
  const subscriptionId = body.subscriptionId === undefined || body.subscriptionId === null ? null : body.subscriptionId;
  if ((orderId === null) === (subscriptionId === null)) throw new ValidationError("Say which order or meal plan it's about.");
  for (const id of [orderId, subscriptionId]) if (id !== null && (typeof id !== "string" || !UUID.test(id))) throw new ValidationError("That order or plan isn't valid.");
  return {
    orderId: orderId?.toLowerCase() ?? null,
    subscriptionId: subscriptionId?.toLowerCase() ?? null,
    category: body.category,
    description: text(body.description, "description", 600, { min: 10 }),
  };
}

/**
 * POST /admin/kitchen/issues/:id/:action — assign (to the caller), progress, note { note }, resolve
 * { note, refund? } (rupees, at most the order's total), reject { note }, reopen. → the change.
 */
function actionBody(action, body, issue, maxRefund) {
  if (!ACTIONS.includes(action)) throw new ValidationError("That isn't an action on an issue.");
  onlyFields(body ?? {}, ["note", "refund"]);
  const closed = issue.status === "resolved" || issue.status === "rejected";
  if (action === "reopen") {
    if (!closed) throw new ValidationError("Only a closed issue can be reopened.");
    return { status: "open", note: text(body?.note, "note", 300, { required: false }) };
  }
  if (closed) throw new ValidationError("This issue is closed. Reopen it first.");
  if (action === "assign") return { status: issue.status === "open" ? "in_progress" : issue.status, assign: true, note: null };
  if (action === "progress") return { status: "in_progress", note: text(body?.note, "note", 300, { required: false }) };
  if (action === "note") return { status: issue.status, note: text(body?.note, "note", 300, { min: 3 }) };
  if (action === "reject") return { status: "rejected", note: text(body?.note, "reason", 300, { min: 3 }) };
  let refundPaise = null;
  if (body?.refund !== undefined && body.refund !== null) {
    if (!Number.isInteger(body.refund) || body.refund < 1) throw new ValidationError("A refund is a whole number of rupees.");
    if (maxRefund !== null && body.refund > maxRefund) throw new ValidationError(`A refund can be at most ₹${maxRefund}, what was paid.`);
    refundPaise = body.refund * 100;
  }
  return { status: "resolved", note: text(body?.note, "resolution note", 300, { min: 3 }), refundPaise };
}

/** ?status=&search= for the admin's list */
function listQuery(query) {
  onlyFields(query, ["status", "search"]);
  const status = query.status ?? null;
  if (status !== null && !STATUSES.includes(status)) throw new ValidationError("Pick a status from the list.");
  if (query.search !== undefined && typeof query.search !== "string") throw new ValidationError("Search with text.");
  return { status, search: (query.search ?? "").trim().slice(0, 40) };
}

module.exports = { CATEGORIES, STATUSES, ACTIONS, issueCode, issueBody, actionBody, listQuery };
