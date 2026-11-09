// Kitchens' rules (pure, unit-tested in __tests__/kitchen-rules.test.js): what the Super Admin may
// send for a kitchen, its status, its staff roster, and the meal-operations dashboard's day
// (Meal Operations phase 1, 2026-11-10; MEAL-OPERATIONS-PLAN.md). Kitchens are internal: members
// never see them. Kitchen staff are a roster only (no logins yet, the user's choice).
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");
const profileRules = require("../gym/profileRules");

const STATUSES = ["active", "inactive", "temporarily_closed", "maintenance"];
const STAFF_ROLES = ["manager", "chef", "prep"];
const MAX_PINCODES = 100;
const MAX_STAFF = 60;
const limits = {
  name: { min: 2, max: 80 }, contactName: { min: 2, max: 60 }, address: { min: 5, max: 200 }, area: { max: 60 }, city: { min: 2, max: 40 },
  note: { min: 3, max: 200 }, staffNote: { max: 120 }, maxDailyOrders: { min: 1, max: 5000 }, prepCapacity: { min: 1, max: 1000 }, radiusKm: { min: 0.5, max: 50 },
};
const INDIA = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const PINCODE = /^[1-9][0-9]{5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
const IST_OFFSET_MS = 330 * 60 * 1000;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}
function text(value, label, { min = 1, max, required = true } = {}) {
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
function whole(value, label, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
function coordinate(value, min, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new ValidationError("Pick the kitchen's place in India.");
  return Math.round(value * 1e6) / 1e6;
}

/** The kitchen's code, from its id: KIT-0001 */
const kitchenCode = (id) => `KIT-${String(id).padStart(4, "0")}`;

/** Serviceable pincodes: 1 to 100 six-digit pincodes, each once, sorted */
function pincodes(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError("Add at least one pincode the kitchen serves.");
  if (value.length > MAX_PINCODES) throw new ValidationError(`A kitchen can serve up to ${MAX_PINCODES} pincodes.`);
  for (const p of value) if (typeof p !== "string" || !PINCODE.test(p.trim())) throw new ValidationError("Write each pincode as 6 digits.");
  return [...new Set(value.map((p) => p.trim()))].sort();
}

const KITCHEN_FIELDS = ["name", "contactName", "phone", "email", "address", "area", "city", "pincode", "latitude", "longitude", "hours", "pincodes", "maxDailyOrders", "prepCapacity", "radiusKm"];

/**
 * POST /api/admin/kitchen/kitchens and PUT …/:id (every field each time; the photo rides along as
 * `photo` / `removePhoto`, split off by the route): the kitchen's details, hours, the pincodes it
 * serves and its capacity. Its status changes on its own route, with a note.
 */
function kitchenBody(body) {
  onlyFields(body, KITCHEN_FIELDS);
  const latitude = coordinate(body.latitude, INDIA.minLat, INDIA.maxLat);
  const longitude = coordinate(body.longitude, INDIA.minLng, INDIA.maxLng);
  if ((latitude === null) !== (longitude === null)) throw new ValidationError("Give both the latitude and the longitude, or neither.");
  if (typeof body.pincode !== "string" || !PINCODE.test(body.pincode.trim())) throw new ValidationError("Write the kitchen's pincode as 6 digits.");
  if (typeof body.radiusKm !== "number" || !Number.isFinite(body.radiusKm) || body.radiusKm < limits.radiusKm.min || body.radiusKm > limits.radiusKm.max) {
    throw new ValidationError(`The delivery radius must be from ${limits.radiusKm.min} to ${limits.radiusKm.max} km.`);
  }
  const hours = profileRules.openingHours(body.hours ?? undefined);
  if (hours === null) throw new ValidationError("Send the opening hours for each day.");
  return {
    name: text(body.name, "kitchen's name", limits.name),
    contactName: text(body.contactName, "contact person", limits.contactName),
    phone: normalizePhone(body.phone),
    email: profileRules.email(body.email),
    address: text(body.address, "address", limits.address),
    area: text(body.area, "area", { ...limits.area, required: false }),
    city: text(body.city, "city", limits.city),
    pincode: body.pincode.trim(),
    latitude,
    longitude,
    hours,
    pincodes: pincodes(body.pincodes),
    maxDailyOrders: whole(body.maxDailyOrders, "Orders a day", limits.maxDailyOrders),
    prepCapacity: whole(body.prepCapacity, "Meals a meal time", limits.prepCapacity),
    radiusKm: Math.round(body.radiusKm * 10) / 10,
  };
}

/** POST …/kitchens/:id/status { status, note }: a note is needed for anything but active */
function statusBody(body) {
  onlyFields(body, ["status", "note"]);
  if (!STATUSES.includes(body.status)) throw new ValidationError("Pick Active, Inactive, Temporarily closed or Under maintenance.");
  const note = text(body.note, "reason", { ...limits.note, required: body.status !== "active" });
  return { status: body.status, note };
}

/** A staff member on the roster: { name, phone, role, available, note? } */
function staffBody(body) {
  onlyFields(body, ["name", "phone", "role", "available", "note"]);
  if (!STAFF_ROLES.includes(body.role)) throw new ValidationError("Pick Kitchen manager, Chef or Preparation staff.");
  if (typeof body.available !== "boolean") throw new ValidationError("Say whether they are available.");
  return {
    name: text(body.name, "name", limits.contactName),
    phone: normalizePhone(body.phone),
    role: body.role,
    available: body.available,
    note: text(body.note, "note", { ...limits.staffNote, required: false }),
  };
}

const positiveId = (value, label) => {
  const id = Number(value);
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || !Number.isSafeInteger(id)) throw new ValidationError(`That ${label} isn't valid.`);
  return id;
};

/** India's date and minutes past midnight now */
function indiaNow(now = Date.now()) {
  const d = new Date(now + IST_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), day: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getUTCDay()] };
}

/** The dashboard's day: ?day=YYYY-MM-DD, a year either side of today; today when left out */
function dashboardQuery(query, now = Date.now()) {
  onlyFields(query, ["day", "format"]);
  const today = indiaNow(now).date;
  const day = query.day ?? today;
  if (typeof day !== "string" || !DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new ValidationError("Pick a day like 2026-11-10.");
  }
  const diff = Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (diff > 366) throw new ValidationError("Pick a day within a year of today.");
  const format = query.format ?? "xlsx";
  if (!["xlsx", "csv"].includes(format)) throw new ValidationError("Format must be xlsx or csv.");
  return { day, today, format };
}

/** The UTC epoch seconds an India day starts and ends at (for created_at ranges) */
function dayBounds(day) {
  const start = Date.parse(`${day}T00:00:00+05:30`) / 1000;
  return { start, end: start + 86_400 };
}

/** Whether a kitchen is open at an India day and minute, from its hours */
function openAt(hours, dayKey, minutes) {
  const sessions = hours?.[dayKey] ?? [];
  return sessions.some(([open, close]) => {
    const [oh, om] = open.split(":").map(Number);
    const [ch, cm] = close.split(":").map(Number);
    return minutes >= oh * 60 + om && minutes < ch * 60 + cm;
  });
}

/**
 * An open order is delayed once its delivery window has ended: an earlier day, or today after the
 * meal time's end
 */
function isDelayed(order, today, minutesNow) {
  if (!["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery"].includes(order.status)) return false;
  if (order.date < today) return true;
  if (order.date > today || !order.slotEndsAt) return false;
  const [h, m] = order.slotEndsAt.split(":").map(Number);
  return minutesNow > h * 60 + m;
}

module.exports = {
  STATUSES, STAFF_ROLES, MAX_PINCODES, MAX_STAFF, limits, kitchenCode, pincodes, kitchenBody, statusBody, staffBody, positiveId,
  indiaNow, dashboardQuery, dayBounds, openAt, isDelayed, onlyFields,
};
