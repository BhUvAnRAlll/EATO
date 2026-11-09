// Delivery partners and deliveries (pure, unit-tested in __tests__/delivery-rules.test.js; Meal
// Operations phase 4, 2026-11-10). No rider logins yet: the Super Admin records every step.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");

const VEHICLES = ["bike", "scooter", "bicycle", "car", "on_foot"];
const ID_STATUSES = ["pending", "verified", "rejected"];
// A delivery's steps, in order (failed can come from any step before delivered)
const STEPS = ["assigned", "accepted", "at_kitchen", "picked_up", "out_for_delivery", "at_customer", "delivered"];
const FAILURES = ["customer_unavailable", "wrong_address", "customer_rejected", "partner_issue", "other"];
// The order steps a partner can be given an order at (cooking or ready, never once it's left)
const ASSIGNABLE = ["preparing", "quality_check", "ready"];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
const PINCODE = /^[1-9][0-9]{5}$/;

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
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length < min) throw new ValidationError(`The ${label} is too short.`);
  if (clean.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return clean;
}

/** POST|PUT /delivery/partners { name, phone, vehicle, vehicleNumber?, idStatus, active, available, maxOrders, pincodes, note? } */
function partnerBody(body) {
  onlyFields(body, ["name", "phone", "vehicle", "vehicleNumber", "idStatus", "active", "available", "maxOrders", "pincodes", "note"]);
  if (!VEHICLES.includes(body.vehicle)) throw new ValidationError("Pick a bike, scooter, bicycle, car or on foot.");
  if (!ID_STATUSES.includes(body.idStatus)) throw new ValidationError("Pick the ID check: pending, verified or rejected.");
  for (const key of ["active", "available"]) if (typeof body[key] !== "boolean") throw new ValidationError(`Say whether they are ${key}.`);
  if (!Number.isInteger(body.maxOrders) || body.maxOrders < 1 || body.maxOrders > 10) throw new ValidationError("Orders at once must be from 1 to 10.");
  if (!Array.isArray(body.pincodes) || body.pincodes.length === 0 || body.pincodes.length > 100) throw new ValidationError("Add the pincodes they cover (1 to 100).");
  for (const p of body.pincodes) if (typeof p !== "string" || !PINCODE.test(p.trim())) throw new ValidationError("Write each pincode as 6 digits.");
  let vehicleNumber = text(body.vehicleNumber, "vehicle number", 16, { required: false, min: 4 });
  if (vehicleNumber) {
    vehicleNumber = vehicleNumber.toUpperCase().replace(/\s+/g, " ");
    if (!/^[A-Z0-9 -]+$/.test(vehicleNumber)) throw new ValidationError("Write the vehicle number with letters and digits, like KA 01 AB 1234.");
  }
  return {
    name: text(body.name, "name", 60, { min: 2 }),
    phone: normalizePhone(body.phone),
    vehicle: body.vehicle,
    vehicleNumber,
    idStatus: body.idStatus,
    active: body.active,
    available: body.available,
    maxOrders: body.maxOrders,
    pincodes: [...new Set(body.pincodes.map((p) => p.trim()))].sort(),
    note: text(body.note, "note", 120, { required: false }),
  };
}

/** The step after this one, or null */
function nextStep(status) {
  const i = STEPS.indexOf(status);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

/** POST …/delivery/advance { from } */
function advanceBody(body) {
  onlyFields(body, ["from"]);
  const to = nextStep(body.from);
  if (!to) throw new ValidationError("That delivery can't move on from there.");
  return { from: body.from, to };
}

/** POST …/delivery/fail { reason, note? }: "other" needs a note */
function failBody(body) {
  onlyFields(body, ["reason", "note"]);
  if (!FAILURES.includes(body.reason)) throw new ValidationError("Pick why the delivery failed.");
  return { reason: body.reason, note: text(body.note, "note", 200, { required: body.reason === "other", min: 3 }) };
}

/** POST …/delivery/assign { partnerId? }: left out, the best free partner is picked */
function assignBody(body) {
  onlyFields(body ?? {}, ["partnerId"]);
  if (body?.partnerId === undefined) return { partnerId: null };
  if (!Number.isInteger(body.partnerId) || body.partnerId < 1) throw new ValidationError("Pick a delivery partner.");
  return { partnerId: body.partnerId };
}

/**
 * Why a partner can't take an order, or null. `p`: { active, available, idStatus, pincodes: Set,
 * carrying, maxOrders }
 */
function partnerProblem(p, pincode) {
  if (!p.active) return "inactive";
  if (p.idStatus !== "verified") return "ID not verified";
  if (!p.available) return "not available";
  if (!p.pincodes.has(pincode)) return "doesn't cover this pincode";
  if (p.carrying >= p.maxOrders) return "carrying as many orders as they can";
  return null;
}

/** The free partner with the fewest orders on the way (then the lowest id), or null */
function choosePartner(partners, pincode) {
  return partners.filter((p) => partnerProblem(p, pincode) === null).sort((a, b) => a.carrying - b.carrying || a.id - b.id)[0] ?? null;
}

module.exports = { VEHICLES, ID_STATUSES, STEPS, FAILURES, ASSIGNABLE, partnerBody, nextStep, advanceBody, failBody, assignBody, partnerProblem, choosePartner };
