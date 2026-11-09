// QR attendance's rules (pure, unit-tested): the branch's signed QR code, its location and
// geofence radius, the member's GPS reading and the distance between them, the dashboard's
// filters and the CSV export.
//
// The QR code is not a stored secret: it is an HMAC of the branch id and its QR version with a
// key derived from AUTH_SECRET (its own HKDF label). Regenerating bumps the version, so every
// older printout stops working at once. The code names the branch and nothing else: no member
// data, nothing to guess from.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const { ForbiddenError } = require("../errors");

const QR_PREFIX = "justfit://attendance";
const RADIUS = { min: 20, max: 1000, default: 100 }; // metres
const GPS = {
  worstAccuracy: 150, // metres: a fix vaguer than this can't place someone inside a 100 m circle
  maxAgeMs: 2 * 60 * 1000, // a reading older than this is stale
  maxAheadMs: 60 * 1000, // phone clocks drift a little, never minutes ahead
};
const MIN_VISIT_MS = 60 * 1000; // a check-out within a minute of checking in is a double scan
// An open visit is closed as 'no_checkout' at midnight, India time, on the day it was opened
// (2026-11-07, the user's rule; it was 12 hours after the check-in before): so 'inside' only ever
// means today's visits.
const STATUSES = ["inside", "completed", "no_checkout"];
const SOURCES = ["qr", "staff"];
const EXPORT_MAX_ROWS = 5000;
const RANGE_MAX_DAYS = 366;
const PAGE_SIZE = 50;

const OUTSIDE = "You are outside the gym's allowed attendance zone. Please move closer to the gym to check in.";
const OUTSIDE_OUT = "You are outside the gym's allowed attendance zone. Please move closer to the gym to check out.";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function onlyKeys(body, keys) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new ValidationError("That request has fields we don't use.");
}

// The key for QR codes: HKDF from AUTH_SECRET, labelled for this one use
function deriveQrKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "justfit-gym-qr", "gym qr v1", 32));
}

// 22 base64url characters (132 bits) for a branch's QR version
const qrToken = (key, gymId, version) => crypto.createHmac("sha256", key).update(`${gymId}.${version}`).digest("base64url").slice(0, 22);

const qrPayload = (key, gymId, version) => `${QR_PREFIX}?b=${gymId}&v=${version}&k=${qrToken(key, gymId, version)}`;

const NOT_OURS = "That isn't a justFit gym QR code. Scan the attendance QR code at your gym's front desk.";
// { gymId, version, token } from a scanned text; anything else is refused before the database
function parseQr(text) {
  if (typeof text !== "string" || text.length > 200) throw new ValidationError(NOT_OURS);
  const match = /^justfit:\/\/attendance\?b=([1-9]\d{0,8})&v=([1-9]\d{0,8})&k=([A-Za-z0-9_-]{22})$/.exec(text.trim());
  if (!match) throw new ValidationError(NOT_OURS);
  return { gymId: Number(match[1]), version: Number(match[2]), token: match[3] };
}

// True when the code is the branch's current one (old versions and forged tokens fail)
function qrMatches(key, qr, currentVersion) {
  if (!currentVersion || qr.version !== currentVersion) return false;
  const expected = Buffer.from(qrToken(key, qr.gymId, qr.version));
  const given = Buffer.from(qr.token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Great-circle distance in metres (haversine)
function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const coordinate = (value, max, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > max) throw new ValidationError(`Enter a valid ${label}.`);
  return Math.round(value * 1e6) / 1e6;
};

// The admin's settings: where the branch is and how far from it attendance counts
function locationBody(body) {
  onlyKeys(body, ["latitude", "longitude", "radiusM"]);
  const latitude = coordinate(body.latitude, 90, "latitude");
  const longitude = coordinate(body.longitude, 180, "longitude");
  if (latitude === 0 && longitude === 0) throw new ValidationError("Pick the gym's location on the map.");
  if (!Number.isInteger(body.radiusM) || body.radiusM < RADIUS.min || body.radiusM > RADIUS.max) {
    throw new ValidationError(`Set the attendance radius between ${RADIUS.min} and ${RADIUS.max} metres.`);
  }
  return { latitude, longitude, radiusM: body.radiusM };
}

const NO_GPS = "We couldn't read your location. Turn on location (GPS) and try again.";
// A member's scan: the QR text and the phone's GPS reading. Nothing here is trusted as proof on
// its own: the server checks the code, the reading's age and accuracy, and the distance itself.
function scanBody(body, { withPosition }) {
  onlyKeys(body, withPosition ? ["qr", "latitude", "longitude", "accuracy", "mocked", "capturedAt"] : ["qr"]);
  const qr = parseQr(body.qr);
  if (!withPosition) return { qr };
  if (body.latitude === undefined || body.longitude === undefined) throw new ValidationError(NO_GPS);
  const position = {
    latitude: coordinate(body.latitude, 90, "location"),
    longitude: coordinate(body.longitude, 180, "location"),
  };
  if (typeof body.accuracy !== "number" || !Number.isFinite(body.accuracy) || body.accuracy <= 0 || body.accuracy > 100_000) {
    throw new ValidationError(NO_GPS);
  }
  if (body.mocked !== undefined && typeof body.mocked !== "boolean") throw new ValidationError(NO_GPS);
  if (!Number.isInteger(body.capturedAt) || body.capturedAt <= 0) throw new ValidationError(NO_GPS);
  return { qr, position: { ...position, accuracy: Math.round(body.accuracy), mocked: body.mocked === true, capturedAt: body.capturedAt } };
}

// Inside the circle, with a fresh, precise, real reading; answers the distance in whole metres
function judgePosition(gym, position, { now = Date.now(), checkingOut = false } = {}) {
  if (gym.latitude === null || gym.longitude === null) {
    throw new ForbiddenError("This gym hasn't set its location for QR attendance yet. Please check in at the front desk.");
  }
  if (position.mocked) throw new ForbiddenError("Your phone is using a mock location. Turn off any location-changing app and try again.");
  if (position.capturedAt < now - GPS.maxAgeMs || position.capturedAt > now + GPS.maxAheadMs) {
    throw new ForbiddenError("Your location reading is out of date. Please scan again.");
  }
  if (position.accuracy > GPS.worstAccuracy) {
    throw new ForbiddenError("Your GPS signal is too weak to confirm you're at the gym. Step near a window or the entrance and try again.");
  }
  const distance = Math.round(distanceMeters({ latitude: Number(gym.latitude), longitude: Number(gym.longitude) }, position));
  if (distance > gym.radiusM) throw new ForbiddenError(checkingOut ? OUTSIDE_OUT : OUTSIDE);
  return distance;
}

// Whole minutes between two instants (never negative)
const durationMinutes = (from, to) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(value, label) {
  if (typeof value !== "string" || !ISO_DAY.test(value)) throw new ValidationError(`Pick a valid ${label} date.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ValidationError(`Pick a valid ${label} date.`);
  return value;
}

const dayGap = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// The dashboard's history: a date range (default today), a status, a search, a member, a page.
// Inside is today's visits only (an open visit never outlives its day), so that status fixes the
// range to today, whatever range came with it.
function historyQuery(query = {}, today) {
  const allowed = ["from", "to", "status", "search", "memberId", "page"];
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw new ValidationError("That request has fields we don't use.");
  let to = query.to === undefined ? today : day(query.to, "end");
  let from = query.from === undefined ? to : day(query.from, "start");
  if (from > to) throw new ValidationError("The start date must be on or before the end date.");
  if (dayGap(from, to) >= RANGE_MAX_DAYS) throw new ValidationError("Pick a range of at most one year.");
  let status = "all";
  if (query.status !== undefined) {
    if (![...STATUSES, "all"].includes(query.status)) throw new ValidationError("Pick inside, completed, no check-out or all.");
    status = query.status;
  }
  if (status === "inside") { from = today; to = today; }
  let search = "";
  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.length > 60) throw new ValidationError("Keep the search to 60 characters.");
    search = query.search.replace(/\s+/g, " ").trim();
  }
  let memberId = null;
  if (query.memberId !== undefined) {
    if (typeof query.memberId !== "string" || !/^[1-9]\d{0,9}$/.test(query.memberId)) throw new ValidationError("That member link isn't valid.");
    memberId = Number(query.memberId);
  }
  let page = 1;
  if (query.page !== undefined) {
    if (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page)) throw new ValidationError("That page isn't valid.");
    page = Number(query.page);
  }
  return { from, to, status, search, memberId, page };
}

// Staff & Trainers (2026-11-09): the visits list's range (today, the last 7 or the last 30 days,
// counted back from today), a search by name and a page. Nothing else is accepted.
const TEAM_RANGES = { today: 1, week: 7, month: 30 };
function teamQuery(query = {}, today) {
  const allowed = ["range", "search", "page"];
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw new ValidationError("That request has fields we don't use.");
  const range = query.range === undefined ? "today" : query.range;
  if (typeof range !== "string" || !Object.hasOwn(TEAM_RANGES, range)) throw new ValidationError("Pick today, the last 7 days or the last 30 days.");
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (TEAM_RANGES[range] - 1) * 86400000).toISOString().slice(0, 10);
  let search = "";
  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.length > 60) throw new ValidationError("Keep the search to 60 characters.");
    search = query.search.replace(/\s+/g, " ").trim();
  }
  let page = 1;
  if (query.page !== undefined) {
    if (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page)) throw new ValidationError("That page isn't valid.");
    page = Number(query.page);
  }
  return { range, from, to: today, search, page };
}

// A CSV cell: quoted, and a leading = + - @ (a spreadsheet formula) neutralised
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) || text !== String(value) ? `"${text.replace(/"/g, '""')}"` : text;
}

const STATUS_LABELS = { inside: "Inside", completed: "Completed", no_checkout: "No check-out" };
const SOURCE_LABELS = { qr: "QR scan", staff: "Staff" };
const CSV_HEADER = ["Date", "Member ID", "Member", "Check-in", "Check-out", "Duration (min)", "Status", "Checked in by", "Distance at check-in (m)"];

// One visit as the report's row (the CSV and the Excel file share it); numbers stay numbers
function exportRow(v) {
  return [
    v.date, v.memberCode, v.memberName, v.checkInTime, v.checkOutTime ?? null, v.durationMin ?? null,
    STATUS_LABELS[v.status] ?? v.status, SOURCE_LABELS[v.inSource] ?? v.inSource, v.checkInDistanceM ?? null,
  ];
}

function toCsv(visits) {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const v of visits) lines.push(exportRow(v).map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// The Excel report (2026-11-09): the same columns, widths in characters
const SHEET_WIDTHS = [12, 14, 24, 20, 20, 15, 14, 14, 22];
function toSheet(visits) {
  return { sheetName: "Attendance", header: CSV_HEADER, rows: visits.map(exportRow), widths: SHEET_WIDTHS };
}

// ?format= on the export: csv (the default, as before) or xlsx; the rest is the history's query
function exportQuery(query = {}, today) {
  const { format, ...rest } = query;
  if (format !== undefined && format !== "csv" && format !== "xlsx") throw new ValidationError("Pick csv or xlsx.");
  return { format: format ?? "csv", query: historyQuery(rest, today) };
}

// The Statistics chart (2026-11-07, the user's request: the graph follows the period). Today is
// by hour, India time, from 5 am to 10 pm plus any earlier or later hour with a visit (the busy
// hours card's convention); the last 7 and 30 days are one bar per day ending today.
const CHART_HOURS = { from: 5, to: 22 };
const IST_OFFSET_MS = 330 * 60 * 1000;
const hourInIndia = (msValue) => new Date(Number(msValue) + IST_OFFSET_MS).getUTCHours();
function chartHours(inMsList) {
  const visits = new Array(24).fill(0);
  for (const value of inMsList) visits[hourInIndia(value)] += 1;
  const first = Math.min(CHART_HOURS.from, visits.findIndex((n) => n > 0) === -1 ? CHART_HOURS.from : visits.findIndex((n) => n > 0));
  let last = CHART_HOURS.to;
  for (let h = 23; h > CHART_HOURS.to; h -= 1) if (visits[h] > 0) { last = h; break; }
  return Array.from({ length: last - first + 1 }, (_, i) => ({ hour: first + i, visits: visits[first + i] }));
}
// Milliseconds from `now` to the next midnight in India (never 0: at midnight itself, a full day)
function msUntilIndiaMidnight(now = Date.now()) {
  const sinceMidnight = (now + IST_OFFSET_MS) % 86400000;
  return 86400000 - sinceMidnight;
}

function chartDays(byDay, today, days, addDays) {
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - (days - 1));
    return { day, visits: byDay.get(day) ?? 0 };
  });
}

module.exports = {
  CHART_HOURS,
  chartHours,
  chartDays,
  QR_PREFIX,
  RADIUS,
  GPS,
  MIN_VISIT_MS,
  msUntilIndiaMidnight,
  STATUSES,
  SOURCES,
  EXPORT_MAX_ROWS,
  PAGE_SIZE,
  OUTSIDE,
  OUTSIDE_OUT,
  deriveQrKey,
  qrToken,
  qrPayload,
  parseQr,
  qrMatches,
  distanceMeters,
  locationBody,
  scanBody,
  judgePosition,
  durationMinutes,
  historyQuery,
  TEAM_RANGES,
  teamQuery,
  csvCell,
  exportRow,
  toSheet,
  exportQuery,
  toCsv,
};
