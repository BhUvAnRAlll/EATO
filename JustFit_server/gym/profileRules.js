// A branch's public profile (Gym Hub phase 2, 2026-11-09; pure, unit-tested): the description,
// the facilities and the opening hours the gym admin fills in from Settings › Public profile, and
// that members will see when they discover gyms. Facility ids and the weekdays come from the lists
// below, never from the request.
const { ValidationError } = require("../profile");

const ABOUT_MAX = 500;
const DETAILS_MAX = 300;
const MAX_PHOTOS = 8;
const MAX_SESSIONS = 2;

// What a gym may say it has: [id, label]. The app shows the same labels (lib/gymProfile.ts).
const FACILITIES = [
  ["cardio", "Cardio machines"],
  ["weights", "Free weights"],
  ["machines", "Strength machines"],
  ["functional", "Functional training"],
  ["personal_training", "Personal training"],
  ["group_classes", "Group classes"],
  ["yoga", "Yoga"],
  ["zumba", "Zumba / dance"],
  ["steam", "Steam / sauna"],
  ["lockers", "Lockers"],
  ["showers", "Showers"],
  ["changing_rooms", "Changing rooms"],
  ["ac", "Air conditioned"],
  ["parking", "Parking"],
  ["drinking_water", "Drinking water"],
  ["wifi", "Wi-Fi"],
  ["women_batch", "Women-only batch"],
  ["supplements", "Supplement counter"],
];
const FACILITY_IDS = FACILITIES.map(([id]) => id);
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Letters in any script, numbers, spaces and ordinary punctuation; no control characters
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const onlyKeys = (body, keys) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the profile as an object.");
  for (const key of Object.keys(body)) if (!keys.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
};
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Optional free text: trimmed, inner runs of blank lines squeezed, "" → null
function optionalText(value, max, what) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError(`Write the ${what} as text.`);
  const text = value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text === "") return null;
  if (CONTROL.test(text)) throw new ValidationError(`The ${what} has characters we can't show.`);
  if (text.length > max) throw new ValidationError(`Keep the ${what} to ${max} characters.`);
  return text;
}

// A list of facility ids, each once, in the list's order; [] is "none"
function facilities(value) {
  if (!Array.isArray(value)) throw new ValidationError("Pick the facilities from the list.");
  for (const id of value) if (!FACILITY_IDS.includes(id)) throw new ValidationError("Pick the facilities from the list.");
  return FACILITY_IDS.filter((id) => value.includes(id));
}

// { mon: [["05:30","11:00"], ["16:00","22:00"]], …, sun: [] }: every day given, up to two sessions
// a day, each opening before it closes, the second after the first; [] is closed that day.
// null clears the hours (not given).
function openingHours(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Send the opening hours for each day.");
  for (const key of Object.keys(value)) if (!DAYS.includes(key)) throw new ValidationError(`Unexpected day: ${key}.`);
  const out = {};
  for (const day of DAYS) {
    const sessions = value[day];
    if (!Array.isArray(sessions)) throw new ValidationError("Give the hours for every day (an empty list when closed).");
    if (sessions.length > MAX_SESSIONS) throw new ValidationError(`A day can have up to ${MAX_SESSIONS} sessions.`);
    let lastClose = -1;
    out[day] = sessions.map((session) => {
      if (!Array.isArray(session) || session.length !== 2 || !session.every((t) => typeof t === "string" && TIME.test(t))) {
        throw new ValidationError("Write each time like 05:30 or 22:00.");
      }
      const [open, close] = session.map(minutes);
      if (open >= close) throw new ValidationError("Each session must open before it closes.");
      if (open <= lastClose) throw new ValidationError("A day's second session must start after the first one ends.");
      lastClose = close;
      return [session[0], session[1]];
    });
  }
  return out;
}

// PATCH /profile: any of about, facilities, hours; at least one
function profileBody(body) {
  onlyKeys(body, ["about", "facilities", "hours"]);
  const out = {};
  if (body.about !== undefined) out.about = optionalText(body.about, ABOUT_MAX, "description");
  if (body.facilities !== undefined) out.facilities = facilities(body.facilities);
  if (body.hours !== undefined) out.hours = openingHours(body.hours);
  if (Object.keys(out).length === 0) throw new ValidationError("Change the description, the facilities or the opening hours.");
  return out;
}

// A stored JSON column read back: the list or object, or null for anything we didn't write
function readFacilities(stored) {
  const value = typeof stored === "string" ? safeJson(stored) : stored;
  return Array.isArray(value) ? FACILITY_IDS.filter((id) => value.includes(id)) : [];
}
function readHours(stored) {
  const value = typeof stored === "string" ? safeJson(stored) : stored;
  try {
    return value ? openingHours(value) : null;
  } catch {
    return null;
  }
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { ABOUT_MAX, DETAILS_MAX, MAX_PHOTOS, FACILITIES, FACILITY_IDS, DAYS, optionalText, facilities, openingHours, profileBody, readFacilities, readHours };
