// Delivery addresses' rules (pure, unit-tested): what a member may send for an address, and the
// pincode check. The map pin's coordinates are kept with the address but never stand in for it:
// the house or flat, the street and area and the pincode are always typed and checked by the
// member, and deliveries are matched on the pincode.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");

const KINDS = ["home", "work", "other"];
// A member's saved addresses, at most
const MAX_ADDRESSES = 20;
// India's bounding box: an address outside it can't be delivered by justFit
const INDIA = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const PINCODE = /^[1-9][0-9]{5}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

const FIELDS = ["kind", "receiverName", "receiverPhone", "house", "street", "landmark", "city", "pincode", "formattedAddress", "latitude", "longitude", "instructions", "makeDefault"];

// One line of text: spaces collapsed, no control characters, within its length
function text(value, { label, min, max, optional = false }) {
  if (value === undefined || value === null || (optional && value === "")) {
    if (optional) return null;
    throw new ValidationError(`Add the ${label}.`);
  }
  if (typeof value !== "string") throw new ValidationError(`The ${label} must be text.`);
  if (CONTROL.test(value.replace(/[\r\n\t]/g, " "))) throw new ValidationError(`The ${label} has characters we can't use.`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length === 0) {
    if (optional) return null;
    throw new ValidationError(`Add the ${label}.`);
  }
  if (clean.length < min) throw new ValidationError(`The ${label} is too short.`);
  if (clean.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return clean;
}

function coordinate(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError("Pick the place on the map again.");
  if (value < min || value > max) throw new ValidationError("justFit delivers in India only. Pick a place in India.");
  return Math.round(value * 1e6) / 1e6;
}

function pincode(value) {
  if (typeof value !== "string" || !PINCODE.test(value.trim())) throw new ValidationError("Enter the 6-digit pincode.");
  return value.trim();
}

// POST and PUT /api/addresses: every field each time (an edit sends the whole address)
function addressBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the address.");
  if (Object.keys(body).some((key) => !FIELDS.includes(key))) throw new ValidationError("That request has fields we don't use.");
  if (!KINDS.includes(body.kind)) throw new ValidationError("Pick Home, Work or Other.");
  if (body.makeDefault !== undefined && typeof body.makeDefault !== "boolean") throw new ValidationError("That request isn't valid.");
  let receiverPhone;
  try {
    receiverPhone = normalizePhone(body.receiverPhone);
  } catch {
    throw new ValidationError("Enter the receiver's 10-digit mobile number.");
  }
  return {
    kind: body.kind,
    receiverName: text(body.receiverName, { label: "receiver's name", min: 2, max: 60 }),
    receiverPhone,
    house: text(body.house, { label: "house or flat", min: 1, max: 120 }),
    street: text(body.street, { label: "street and area", min: 3, max: 160 }),
    landmark: text(body.landmark, { label: "landmark", min: 2, max: 120, optional: true }),
    city: text(body.city, { label: "city", min: 2, max: 80, optional: true }),
    pincode: pincode(body.pincode),
    formattedAddress: text(body.formattedAddress, { label: "map address", min: 3, max: 300 }),
    latitude: coordinate(body.latitude, INDIA.minLat, INDIA.maxLat),
    longitude: coordinate(body.longitude, INDIA.minLng, INDIA.maxLng),
    instructions: text(body.instructions, { label: "delivery instructions", min: 2, max: 200, optional: true }),
    makeDefault: body.makeDefault === true,
  };
}

// GET /api/addresses/serviceable?pincode=
function serviceableQuery(query = {}) {
  if (Object.keys(query).some((key) => key !== "pincode")) throw new ValidationError("That request has fields we don't use.");
  return pincode(query.pincode);
}

function addressId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ValidationError("That address doesn't exist.");
  return Number(value);
}

module.exports = { KINDS, MAX_ADDRESSES, INDIA, addressBody, serviceableQuery, addressId, pincode };
