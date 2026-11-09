// Gym Hub › Discover Gyms (phase 3, 2026-11-09; pure, unit-tested): the query a member sends, how a
// branch is matched, scored and sorted, and the plans as members compare them. Every branch on
// justFit is listed (the user's decision); nothing here reads the database.
const { ValidationError } = require("../profile");
const { distanceMeters } = require("./attendanceRules");
const { FACILITY_IDS } = require("./profileRules");

const PAGE_SIZE = 20;
const SEARCH_MAX = 60;
const SORTS = ["relevance", "distance"];
// "Plans from" caps the member can pick, in rupees a month
const PRICE_CAPS = [1000, 1500, 2000, 3000, 5000];
const QUERY_KEYS = ["search", "facilities", "maxPrice", "sort", "lat", "lng", "page"];

const CONTROL = /[\u0000-\u001F\u007F]/;
const number = (value) => (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN);

// GET /api/gyms?search=&facilities=a,b&maxPrice=&sort=&lat=&lng=&page=
function discoverQuery(query = {}) {
  for (const key of Object.keys(query)) if (!QUERY_KEYS.includes(key)) throw new ValidationError("That request has fields we don't use.");
  for (const key of QUERY_KEYS) if (query[key] !== undefined && typeof query[key] !== "string") throw new ValidationError("That request isn't one we understand.");
  const search = (query.search ?? "").trim().replace(/\s+/g, " ");
  if (search.length > SEARCH_MAX || CONTROL.test(search)) throw new ValidationError(`Search with up to ${SEARCH_MAX} letters.`);

  const facilities = query.facilities ? [...new Set(query.facilities.split(","))] : [];
  if (facilities.some((id) => !FACILITY_IDS.includes(id))) throw new ValidationError("Pick the facilities from the list.");

  let maxPrice = null;
  if (query.maxPrice !== undefined && query.maxPrice !== "") {
    maxPrice = number(query.maxPrice);
    if (!PRICE_CAPS.includes(maxPrice)) throw new ValidationError("Pick a price from the list.");
  }

  const sort = query.sort ?? "relevance";
  if (!SORTS.includes(sort)) throw new ValidationError("Sort by relevance or distance.");

  // Where the member is: both or neither, inside India's box, rounded to about 100 m (never stored)
  let near = null;
  if (query.lat !== undefined || query.lng !== undefined) {
    const latitude = number(query.lat);
    const longitude = number(query.lng);
    if (!(latitude >= 6 && latitude <= 37.5 && longitude >= 68 && longitude <= 97.5)) throw new ValidationError("That location isn't in India.");
    near = { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
  }
  if (sort === "distance" && !near) throw new ValidationError("Allow your location to sort by distance.");

  let page = 1;
  if (query.page !== undefined) {
    page = number(query.page);
    if (!Number.isInteger(page) || page < 1 || page > 50) throw new ValidationError("That page doesn't exist.");
  }
  return { search, facilities, maxPrice, sort, near, page };
}

// A plan's price a month, in whole rupees (a plan saved in days counts its days as months of 30)
function perMonth(item) {
  const months = item.duration_unit === "days" ? item.duration / 30 : item.duration;
  return months > 0 ? Math.round(item.price / months) : null;
}

// The cheapest membership plan a month, or null when the branch lists none
function fromPrice(plans) {
  const prices = plans.map(perMonth).filter((p) => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

// How well a branch matches the words: its name first, then the branch, then the place
function matchScore(gym, search) {
  if (!search) return 0;
  const words = search.toLowerCase().split(" ");
  const fields = [[gym.brand, 40], [gym.branch, 25], [gym.area, 15], [gym.city, 10]];
  let score = 0;
  for (const word of words) {
    let best = 0;
    for (const [value, weight] of fields) {
      const text = String(value ?? "").toLowerCase();
      if (text.startsWith(word)) best = Math.max(best, weight);
      else if (text.includes(word)) best = Math.max(best, weight / 2);
    }
    if (best === 0) return null; // every word must be found somewhere
    score += best;
  }
  return score;
}

// A filled-in profile ranks a little higher: members can judge it
const completeness = (gym) => (gym.photoCount > 0 ? 3 : 0) + (gym.about ? 2 : 0) + (gym.hasHours ? 1 : 0) + (gym.planCount > 0 ? 2 : 0);

/**
 * The page of branches to show. gyms: every candidate with brand, branch, area, city, facilities,
 * fromPrice, latitude/longitude, photoCount, about, hasHours, planCount. Distance is in km to one
 * decimal when the member's location is known and the branch has one.
 */
function pickGyms(gyms, q) {
  const found = [];
  for (const gym of gyms) {
    const match = matchScore(gym, q.search);
    if (match === null) continue;
    if (q.facilities.some((id) => !gym.facilities.includes(id))) continue;
    if (q.maxPrice !== null && (gym.fromPrice === null || gym.fromPrice > q.maxPrice)) continue;
    const km = q.near && gym.latitude !== null ? Math.round(distanceMeters(q.near, { latitude: gym.latitude, longitude: gym.longitude }) / 100) / 10 : null;
    found.push({ gym, match, km });
  }
  const byName = (a, b) => `${a.gym.brand} ${a.gym.branch}`.localeCompare(`${b.gym.brand} ${b.gym.branch}`) || a.gym.id - b.gym.id;
  const byDistance = (a, b) => (a.km === null) - (b.km === null) || (a.km ?? 0) - (b.km ?? 0);
  found.sort(q.sort === "distance"
    ? (a, b) => byDistance(a, b) || b.match - a.match || byName(a, b)
    : (a, b) => b.match - a.match || completeness(b.gym) - completeness(a.gym) || byDistance(a, b) || byName(a, b));
  const start = (q.page - 1) * PAGE_SIZE;
  return { total: found.length, page: q.page, nextPage: found.length > start + PAGE_SIZE ? q.page + 1 : null, results: found.slice(start, start + PAGE_SIZE) };
}

// The branch's plans as members compare them, shortest first: the price, a month, and how much a
// month less than the shortest plan (savings), with what each includes
function comparePlans(items) {
  const plans = items
    .filter((i) => i.kind === "plan")
    .map((i) => ({ id: i.id, name: i.name, months: i.duration_unit === "months" ? i.duration : null, days: i.duration_unit === "days" ? i.duration : null, price: i.price, perMonth: perMonth(i), details: i.details ?? null }))
    .sort((a, b) => (a.months ?? a.days / 30) - (b.months ?? b.days / 30) || a.price - b.price);
  const base = plans[0]?.perMonth ?? null;
  return plans.map((p) => ({ ...p, savesPerMonth: base !== null && p.perMonth !== null && p.perMonth < base ? base - p.perMonth : 0 }));
}

module.exports = { PAGE_SIZE, PRICE_CAPS, SORTS, discoverQuery, perMonth, fromPrice, matchScore, pickGyms, comparePlans };
