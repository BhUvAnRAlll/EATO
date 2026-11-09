// Gym Hub › ask to join (phase 4, 2026-11-09; pure, unit-tested): what a member sends when they ask
// a gym to call them about a plan, the plan as the gym will read it, and the request's state in
// the member's own words. There is no payment: the request is a lead in the gym's Enquiries.
const { ValidationError } = require("../profile");

const NOTE_MAX = 200; // gym_enquiries.note
const OPEN_LIMIT = 10; // open requests a member may have across gyms at once
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// POST /api/gyms/:id/requests { itemId?, note? }: the plan or PT package picked (or none: "just
// ask"), and an optional line for the gym (a good time to call, a question)
function joinBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the request as an object.");
  for (const key of Object.keys(body)) if (!["itemId", "note"].includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
  let itemId = null;
  if (body.itemId !== undefined && body.itemId !== null) {
    if (!Number.isInteger(body.itemId) || body.itemId < 1) throw new ValidationError("Pick one of this gym's plans.");
    itemId = body.itemId;
  }
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") throw new ValidationError("Write the message as text.");
    const text = body.note.replace(/\s+/g, " ").trim();
    if (CONTROL.test(text)) throw new ValidationError("The message has characters we can't show.");
    if (text.length > NOTE_MAX) throw new ValidationError(`Keep the message to ${NOTE_MAX} characters.`);
    note = text || null;
  }
  return { itemId, note };
}

const rupees = (n) => `₹${n.toLocaleString("en-IN")}`;
const lengthText = (duration, unit) => (unit === "days" ? `${duration} ${duration === 1 ? "Day" : "Days"}` : duration ? `${duration} ${duration === 1 ? "Month" : "Months"}` : null);

// "Gold · 3 Months · ₹4,500", "PT · 12 sessions · 1 Month · ₹5,000"
function planLabel(item) {
  return [item.kind === "pt" ? `PT · ${item.name}` : item.name, lengthText(item.duration, item.duration_unit), rupees(item.price)].filter(Boolean).join(" · ").slice(0, 120);
}

// The gym's enquiry status as the member sees it: never the gym's notes or follow-up dates
const STATE = { new: "sent", follow_up: "in_touch", joined: "joined", lost: "closed" };
const requestState = (status) => STATE[status] ?? "sent";
const isOpen = (status) => status === "new" || status === "follow_up";

module.exports = { NOTE_MAX, OPEN_LIMIT, joinBody, planLabel, requestState, isOpen };
