// A branch's public profile (Gym Hub phase 2, 2026-11-09; pure, unit-tested): the description,
// the facilities and the opening hours the gym admin fills in from Settings › Public profile, and
// that members will see when they discover gyms. Facility ids and the weekdays come from the lists
// below, never from the request.
const { ValidationError } = require("../profile");
const { normalizePhone } = require("../auth/phone");

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

// Gym Profile Management (phase 1, 2026-11-09): the gym's own facilities, special closures, more
// ways to reach the branch, and what members may see, section by section
const CUSTOM_MAX = 10;
const CUSTOM_NAME_MAX = 40;
const CLOSURES_MAX = 20;
const CLOSURE_NOTE_MAX = 60;
const EMAIL_MAX = 120;
const URL_MAX = 200;
// The sections of a gym's page the gym admin can switch on or off for members (all on by default).
// The app shows the same list (lib/gymProfile.ts SECTIONS).
const SECTIONS = ["photos", "about", "facilities", "hours", "address", "contact", "links", "plans", "pt"];
const LINKS = ["website", "instagram", "facebook"];
const CONTACT_KEYS = ["whatsapp", "email", ...LINKS];
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Instagram and Facebook links must be on their own sites
const LINK_HOSTS = { instagram: ["instagram.com"], facebook: ["facebook.com", "fb.com"] };
const LINK_LABEL = { website: "website", instagram: "Instagram link", facebook: "Facebook link" };

// The gym's own facilities: [{ name, on }], names once each (any case), never a built-in one's label
function customFacilities(value) {
  if (!Array.isArray(value) || value.length > CUSTOM_MAX) throw new ValidationError(`Add up to ${CUSTOM_MAX} facilities of your own.`);
  const builtIn = FACILITIES.map(([, label]) => label.toLowerCase());
  const seen = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((k) => !["name", "on"].includes(k))) throw new ValidationError("Send each facility as a name and on or off.");
    const name = typeof entry.name === "string" ? entry.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 2 || name.length > CUSTOM_NAME_MAX || CONTROL.test(name)) throw new ValidationError(`Name each facility in 2 to ${CUSTOM_NAME_MAX} characters.`);
    if (typeof entry.on !== "boolean") throw new ValidationError("Switch each facility on or off.");
    const key = name.toLowerCase();
    if (builtIn.includes(key)) throw new ValidationError(`${name} is already on the list. Tick it there.`);
    if (seen.has(key)) throw new ValidationError(`${name} is there twice.`);
    seen.add(key);
    return { name, on: entry.on };
  });
}

// Special closures: [{ date, note }], today to a year ahead, once each, sorted by date
function closures(value, today) {
  if (!Array.isArray(value) || value.length > CLOSURES_MAX) throw new ValidationError(`Add up to ${CLOSURES_MAX} closures.`);
  const last = addDays(today, 365);
  const seen = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((k) => !["date", "note"].includes(k))) throw new ValidationError("Send each closure as a date and a note.");
    if (typeof entry.date !== "string" || !DATE.test(entry.date) || !realDate(entry.date)) throw new ValidationError("Pick each closure's date.");
    if (entry.date < today || entry.date > last) throw new ValidationError("Closures can be from today to a year ahead.");
    if (seen.has(entry.date)) throw new ValidationError("That date is there twice.");
    seen.add(entry.date);
    return { date: entry.date, note: optionalText(entry.note, CLOSURE_NOTE_MAX, "closure's note") };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
const realDate = (date) => new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// What members may see: { photos: true, … } with every section, on or off
function showBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Switch each section on or off.");
  for (const key of Object.keys(value)) if (!SECTIONS.includes(key)) throw new ValidationError(`Unexpected section: ${key}.`);
  return Object.fromEntries(SECTIONS.map((key) => {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new ValidationError("Switch each section on or off.");
    return [key, value[key] !== false];
  }));
}

// A link: https only (a bare "forma.in" gets https://), at most 200 characters, a real host; null clears
function link(value, kind) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError(`Write the ${LINK_LABEL[kind]} as text.`);
  let text = value.trim();
  if (text === "") return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError(`That ${LINK_LABEL[kind]} doesn't look right.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError(`The ${LINK_LABEL[kind]} must start with https://.`);
  if (url.username || url.password || !url.hostname.includes(".")) throw new ValidationError(`That ${LINK_LABEL[kind]} doesn't look right.`);
  url.protocol = "https:";
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (LINK_HOSTS[kind] && !LINK_HOSTS[kind].includes(host)) throw new ValidationError(`Use a link on ${LINK_HOSTS[kind][0]}.`);
  const out = url.toString();
  if (out.length > URL_MAX) throw new ValidationError(`Keep the ${LINK_LABEL[kind]} to ${URL_MAX} characters.`);
  return out;
}

function email(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError("Write the email as text.");
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (text.length > EMAIL_MAX || !EMAIL.test(text) || CONTROL.test(text)) throw new ValidationError("That email doesn't look right.");
  return text;
}

const whatsapp = (value) => (value === null || value === undefined || (typeof value === "string" && value.trim() === "") ? null : normalizePhone(value));

// PATCH /profile: any of the fields; at least one. today: India's date (closures start from it;
// gym/rules.js todayInIndia, passed in because rules.js reads this file)
const PROFILE_KEYS = ["about", "facilities", "hours", "custom", "closures", "show", ...CONTACT_KEYS];
function profileBody(body, today) {
  onlyKeys(body, PROFILE_KEYS);
  const out = {};
  if (body.about !== undefined) out.about = optionalText(body.about, ABOUT_MAX, "description");
  if (body.facilities !== undefined) out.facilities = facilities(body.facilities);
  if (body.hours !== undefined) out.hours = openingHours(body.hours);
  if (body.custom !== undefined) out.custom = customFacilities(body.custom);
  if (body.closures !== undefined) out.closures = closures(body.closures, today);
  if (body.show !== undefined) out.show = showBody(body.show);
  if (body.whatsapp !== undefined) out.whatsapp = whatsapp(body.whatsapp);
  if (body.email !== undefined) out.email = email(body.email);
  for (const kind of LINKS) if (body[kind] !== undefined) out[kind] = link(body[kind], kind);
  if (Object.keys(out).length === 0) throw new ValidationError("Change something in the profile first.");
  return out;
}

// PUT /profile/photos/order { ids }: the branch's photo ids, each once, in the new order
function photoOrder(body, existing) {
  onlyKeys(body, ["ids"]);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !existing.includes(id))) {
    throw new ValidationError("Send every photo once, in the order you want.");
  }
  return ids;
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
const parsed = (stored) => (typeof stored === "string" ? safeJson(stored) : stored ?? null);

function readCustom(stored) {
  try {
    return customFacilities(parsed(stored) ?? []);
  } catch {
    return [];
  }
}
// Closures still to come (past ones drop off by themselves)
function readClosures(stored, today) {
  const value = parsed(stored);
  if (!Array.isArray(value)) return [];
  return value
    .filter((c) => c && typeof c.date === "string" && DATE.test(c.date) && c.date >= today)
    .map((c) => ({ date: c.date, note: typeof c.note === "string" && c.note ? c.note.slice(0, CLOSURE_NOTE_MAX) : null }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, CLOSURES_MAX);
}
function readShow(stored) {
  try {
    const value = parsed(stored);
    return value ? showBody(Object.fromEntries(Object.entries(value).filter(([k]) => SECTIONS.includes(k)))) : showBody({});
  } catch {
    return showBody({});
  }
}
const textOrNull = (v) => (typeof v === "string" && v ? v : null);

/**
 * The profile as members would see it, from the draft columns (a gyms row with about, facilities,
 * opening_hours, custom_facilities, closures, profile_show, address, phone, whatsapp, email, website,
 * instagram, facebook) and the gallery's ids in order. Built the same way for the draft and the
 * published copy, so the two can be compared.
 */
function snapshot(row, photoIds, today) {
  return {
    about: row.about ?? null,
    facilities: readFacilities(row.facilities),
    custom: readCustom(row.custom_facilities).filter((c) => c.on).map((c) => c.name),
    hours: readHours(row.opening_hours),
    closures: readClosures(row.closures, today),
    contact: {
      address: textOrNull(row.address),
      phone: textOrNull(row.phone),
      whatsapp: textOrNull(row.whatsapp),
      email: textOrNull(row.email),
      website: textOrNull(row.website),
      instagram: textOrNull(row.instagram),
      facebook: textOrNull(row.facebook),
    },
    photos: [...photoIds],
    show: readShow(row.profile_show),
  };
}

/**
 * The published copy read back for members: only what was published, past closures dropped, photos
 * deleted since left out (photos: null, from the 2026-12-21 migration, is the gallery as it is now),
 * show: null is every section on. null when never published.
 */
function readPublished(stored, photoIds, today) {
  const value = parsed(stored);
  if (!value || typeof value !== "object") return null;
  const contact = value.contact && typeof value.contact === "object" ? value.contact : {};
  return {
    about: textOrNull(value.about),
    facilities: readFacilities(value.facilities),
    custom: Array.isArray(value.custom) ? value.custom.filter((n) => typeof n === "string" && n).slice(0, CUSTOM_MAX) : [],
    hours: readHours(value.hours),
    closures: readClosures(value.closures, today),
    contact: Object.fromEntries(["address", "phone", ...CONTACT_KEYS].map((k) => [k, textOrNull(contact[k])])),
    photos: Array.isArray(value.photos) ? value.photos.filter((id) => photoIds.includes(id)) : [...photoIds],
    show: readShow(value.show),
  };
}

// The published copy with the sections switched off emptied: what a member's page may carry
function forMembers(profile) {
  const on = profile.show;
  return {
    about: on.about ? profile.about : null,
    facilities: on.facilities ? profile.facilities : [],
    custom: on.facilities ? profile.custom : [],
    hours: on.hours ? profile.hours : null,
    closures: on.hours ? profile.closures : [],
    contact: {
      address: on.address ? profile.contact.address : null,
      phone: on.contact ? profile.contact.phone : null,
      whatsapp: on.contact ? profile.contact.whatsapp : null,
      email: on.contact ? profile.contact.email : null,
      website: on.links ? profile.contact.website : null,
      instagram: on.links ? profile.contact.instagram : null,
      facebook: on.links ? profile.contact.facebook : null,
    },
    photos: on.photos ? profile.photos : [],
    showLocation: on.address,
    showPlans: on.plans,
    showPt: on.pt,
  };
}

// draft: never published; published: members see the draft as it is; changed: edits not published yet
function publishState(draft, published) {
  if (!published) return "draft";
  return JSON.stringify(draft) === JSON.stringify(published) ? "published" : "changed";
}

// What must be there before publishing, each { id, label, done }; required ones block Publish
function checklist(draft, { hasLocation }) {
  return [
    { id: "about", label: "A description", required: true, done: Boolean(draft.about) },
    { id: "photos", label: "At least one photo", required: true, done: draft.photos.length > 0 },
    { id: "hours", label: "Opening hours", required: true, done: draft.hours !== null },
    { id: "phone", label: "A phone or WhatsApp number", required: true, done: Boolean(draft.contact.phone || draft.contact.whatsapp) },
    { id: "place", label: "The address or the place on the map", required: true, done: Boolean(draft.contact.address || hasLocation) },
    { id: "facilities", label: "Facilities", required: false, done: draft.facilities.length + draft.custom.length > 0 },
  ];
}
const publishProblem = (list) => {
  const missing = list.filter((item) => item.required && !item.done).map((item) => item.label.toLowerCase());
  return missing.length ? `Add ${missing.join(", ")} before publishing.` : null;
};

module.exports = {
  ABOUT_MAX, DETAILS_MAX, MAX_PHOTOS, FACILITIES, FACILITY_IDS, DAYS, SECTIONS, CUSTOM_MAX, CLOSURES_MAX,
  optionalText, facilities, openingHours, customFacilities, closures, showBody, link, email, profileBody, photoOrder,
  readFacilities, readHours, readCustom, readClosures, readShow, snapshot, readPublished, forMembers, publishState, checklist, publishProblem,
};
