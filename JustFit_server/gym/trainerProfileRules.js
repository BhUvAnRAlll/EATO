// Trainer profiles (Gym Profile Management phase 3, 2026-11-09; pure, unit-tested): what the gym
// writes about each trainer login for members. The availability is a week like the gym's opening
// hours (profileRules.openingHours). Nothing here reads the database.
const { ValidationError } = require("../profile");
const profileRules = require("./profileRules");

const LIST_MAX = 8;
const SPECIALIZATION_MAX = 40;
const CERTIFICATION_MAX = 80;
const BIO_MAX = 500;
const YEARS_MAX = 60;
const KEYS = ["specializations", "years", "certifications", "bio", "availability", "active"];
const CONTROL = /[\u0000-\u001F\u007F]/;

// A short list: each entry tidied, 2 to max characters, once each (any case), at most 8
function shortList(value, max, what) {
  if (!Array.isArray(value) || value.length > LIST_MAX) throw new ValidationError(`List up to ${LIST_MAX} ${what}.`);
  const seen = new Set();
  return value.map((entry) => {
    const text = typeof entry === "string" ? entry.trim().replace(/\s+/g, " ") : "";
    if (text.length < 2 || text.length > max || CONTROL.test(text)) throw new ValidationError(`Write each of the ${what} in 2 to ${max} characters.`);
    if (seen.has(text.toLowerCase())) throw new ValidationError(`"${text}" is there twice.`);
    seen.add(text.toLowerCase());
    return text;
  });
}

// PUT /profile/trainers/:userId: any of the fields, at least one
function trainerProfileBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the profile as an object.");
  for (const key of Object.keys(body)) if (!KEYS.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
  const out = {};
  if (body.specializations !== undefined) out.specializations = shortList(body.specializations, SPECIALIZATION_MAX, "specialisations");
  if (body.certifications !== undefined) out.certifications = shortList(body.certifications, CERTIFICATION_MAX, "certifications");
  if (body.years !== undefined) {
    if (body.years !== null && !(Number.isInteger(body.years) && body.years >= 0 && body.years <= YEARS_MAX)) throw new ValidationError(`Enter the years of experience as a whole number from 0 to ${YEARS_MAX}.`);
    out.years = body.years;
  }
  if (body.bio !== undefined) out.bio = profileRules.optionalText(body.bio, BIO_MAX, "bio");
  if (body.availability !== undefined) out.availability = profileRules.openingHours(body.availability);
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new ValidationError("Say whether members see this trainer.");
    out.active = body.active;
  }
  if (Object.keys(out).length === 0) throw new ValidationError("Change something in the profile first.");
  return out;
}

const parsed = (stored) => {
  if (typeof stored !== "string") return stored ?? null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};
// A stored list read back: what the rules allow, else empty
function readList(stored, max) {
  try {
    return shortList(parsed(stored) ?? [], max, "entries");
  } catch {
    return [];
  }
}

// A trainer's name for members: their account's name, or null when they have none yet (a profile
// without a name can't be shown)
const displayName = (fullName) => (typeof fullName === "string" && fullName.trim().length >= 2 ? fullName.trim().slice(0, 80) : null);

/** A profile row (with users.full_name) as the gym and members read it */
function profileOf(row) {
  return {
    specializations: readList(row?.specializations, SPECIALIZATION_MAX),
    years: row?.years_experience ?? null,
    certifications: readList(row?.certifications, CERTIFICATION_MAX),
    bio: row?.bio ?? null,
    availability: profileRules.readHours(row?.availability ?? null),
    active: Number(row?.active ?? 0) === 1,
  };
}

module.exports = { LIST_MAX, SPECIALIZATION_MAX, CERTIFICATION_MAX, BIO_MAX, YEARS_MAX, trainerProfileBody, readList, displayName, profileOf };
