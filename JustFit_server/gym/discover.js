// Gym Hub › Discover Gyms and a gym's page (phase 3, 2026-11-09): every branch on justFit for a
// signed-in member to find and compare, read only. A branch shows only what its gym admin chose to
// show members: the public profile (about, facilities, hours, photos), the address and phone from
// Invoice details, the map place, the logo, and the plans and PT packages on its price list. Never
// a member, a payment, staff or anything else of the gym's. Images are read by id through these
// routes, scoped to the branch in the path; files come from names the server made.
const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const gymProfile = require("./gymProfile");
const logos = require("./logos");
const profileRules = require("./profileRules");
const rules = require("./discoverRules");

// Enough for every branch for now; the list is filtered and sorted in code (discoverRules)
const CANDIDATE_LIMIT = 500;
const logoFiles = covers.fileStore(logos.logoDir);
const photoFiles = covers.fileStore(gymProfile.photoDir);

const coverUrl = (gymId, photoId, key) => (photoId ? `/api/gyms/${gymId}/photos/${photoId}?v=${key.slice(0, 8)}` : null);
const logoUrl = (gymId, key) => (key ? `/api/gyms/${gymId}/logo?v=${key.slice(0, 8)}` : null);

/** GET /api/gyms: a page of branches for the member's search, filters and sort */
async function discover(pool, query) {
  const [gyms] = await pool.query(
    `SELECT g.id, b.name AS brand, g.name AS branch, g.area, g.city, g.about, g.facilities, g.opening_hours IS NOT NULL AS has_hours,
       g.latitude, g.longitude, b.logo_key,
       (SELECT COUNT(*) FROM gym_photos p WHERE p.gym_id = g.id) AS photo_count,
       (SELECT p.id FROM gym_photos p WHERE p.gym_id = g.id ORDER BY p.id LIMIT 1) AS cover_id,
       (SELECT p.image_key FROM gym_photos p WHERE p.gym_id = g.id ORDER BY p.id LIMIT 1) AS cover_key
     FROM gyms g JOIN gym_brands b ON b.id = g.brand_id
     ORDER BY g.id LIMIT ?`,
    [CANDIDATE_LIMIT],
  );
  const ids = gyms.map((g) => g.id);
  const [plans] = ids.length
    ? await pool.query("SELECT gym_id, duration, duration_unit, price FROM gym_catalog_items WHERE kind = 'plan' AND gym_id IN (?)", [ids])
    : [[]];
  const plansOf = new Map();
  for (const p of plans) plansOf.set(p.gym_id, [...(plansOf.get(p.gym_id) ?? []), p]);

  const candidates = gyms.map((g) => ({
    id: g.id, brand: g.brand, branch: g.branch, area: g.area, city: g.city, about: g.about,
    facilities: profileRules.readFacilities(g.facilities),
    hasHours: Number(g.has_hours) === 1,
    latitude: g.latitude === null ? null : Number(g.latitude),
    longitude: g.longitude === null ? null : Number(g.longitude),
    photoCount: Number(g.photo_count),
    planCount: (plansOf.get(g.id) ?? []).length,
    fromPrice: rules.fromPrice(plansOf.get(g.id) ?? []),
    coverUrl: coverUrl(g.id, g.cover_id, g.cover_key ?? ""),
    logoUrl: logoUrl(g.id, g.logo_key),
  }));
  const picked = rules.pickGyms(candidates, query);
  return {
    total: picked.total,
    page: picked.page,
    nextPage: picked.nextPage,
    priceCaps: rules.PRICE_CAPS,
    gyms: picked.results.map(({ gym, km }) => ({
      id: gym.id, name: gym.brand, branch: gym.branch, area: gym.area, city: gym.city,
      facilities: gym.facilities, fromPrice: gym.fromPrice, planCount: gym.planCount, photoCount: gym.photoCount,
      coverUrl: gym.coverUrl, logoUrl: gym.logoUrl, distanceKm: km,
    })),
  };
}

/** GET /api/gyms/:id: one branch's page */
async function gymPage(pool, gymId) {
  const [[[g]], [photos], [items]] = await Promise.all([
    pool.query(
      `SELECT g.id, b.name AS brand, g.name AS branch, g.area, g.city, g.address, g.phone, g.about, g.facilities, g.opening_hours,
         g.latitude, g.longitude, b.logo_key
       FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?`,
      [gymId],
    ),
    pool.query("SELECT id, image_key FROM gym_photos WHERE gym_id = ? ORDER BY id LIMIT ?", [gymId, profileRules.MAX_PHOTOS]),
    pool.query("SELECT id, kind, name, duration, duration_unit, price, details FROM gym_catalog_items WHERE gym_id = ? AND kind IN ('plan', 'pt')", [gymId]),
  ]);
  if (!g) throw new NotFoundError("That gym isn't on justFit any more.");
  return {
    id: g.id,
    name: g.brand,
    branch: g.branch,
    area: g.area,
    city: g.city,
    about: g.about ?? null,
    facilities: profileRules.readFacilities(g.facilities),
    hours: profileRules.readHours(g.opening_hours),
    contact: { address: g.address ?? null, phone: g.phone ?? null },
    location: g.latitude === null ? null : { latitude: Number(g.latitude), longitude: Number(g.longitude) },
    logoUrl: logoUrl(g.id, g.logo_key),
    photos: photos.map((p) => ({ id: p.id, url: coverUrl(g.id, p.id, p.image_key) })),
    plans: rules.comparePlans(items),
    pt: items
      .filter((i) => i.kind === "pt")
      .map((i) => ({ id: i.id, name: i.name, months: i.duration_unit === "months" ? i.duration : null, price: i.price, details: i.details ?? null }))
      .sort((a, b) => (a.months ?? 0) - (b.months ?? 0) || a.price - b.price),
  };
}

/** A branch's gallery photo, by the branch in the path and the photo's id */
async function photo(pool, gymId, photoId) {
  const [[row]] = await pool.query("SELECT image_key FROM gym_photos WHERE id = ? AND gym_id = ?", [photoId, gymId]);
  const file = row ? await photoFiles.read(row.image_key) : null;
  if (!file) throw new NotFoundError("That photo isn't there any more.");
  return file;
}

/** The logo of the gym the branch belongs to */
async function logo(pool, gymId) {
  const [[row]] = await pool.query("SELECT b.logo_key FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?", [gymId]);
  const file = row?.logo_key ? await logoFiles.read(row.logo_key) : null;
  if (!file) throw new NotFoundError("That gym has no logo.");
  return file;
}

module.exports = { discover, gymPage, photo, logo, send: covers.send };
