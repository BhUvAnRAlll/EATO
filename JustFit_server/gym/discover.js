// Gym Hub › Discover Gyms and a gym's page (phase 3, 2026-11-09): every branch on justFit for a
// signed-in member to find and compare, read only. A branch shows only what its gym admin chose to
// show members: since Gym Profile Management (2026-11-09) that is the published copy of its profile
// (about, facilities, hours and closures, contacts and links, photos in order) with the sections
// switched off left out, never the draft; plus the map place, the logo, and the plans and PT
// packages on its price list. Before migration 2026-12-21 the profile is read as it is. Never
// a member, a payment, staff or anything else of the gym's. Images are read by id through these
// routes, scoped to the branch in the path; files come from names the server made.
const { NotFoundError } = require("../errors");
const covers = require("../fitness/covers");
const gymProfile = require("./gymProfile");
const logos = require("./logos");
const profileRules = require("./profileRules");
const rules = require("./discoverRules");
const { todayInIndia } = require("./rules");
const { activeOnly, hasPlanOptions } = require("./service");

// Enough for every branch for now; the list is filtered and sorted in code (discoverRules)
const CANDIDATE_LIMIT = 500;
const logoFiles = covers.fileStore(logos.logoDir);
const photoFiles = covers.fileStore(gymProfile.photoDir);

const coverUrl = (gymId, photoId, key) => (photoId ? `/api/gyms/${gymId}/photos/${photoId}?v=${key.slice(0, 8)}` : null);
const logoUrl = (gymId, key) => (key ? `/api/gyms/${gymId}/logo?v=${key.slice(0, 8)}` : null);

// Whether migration 2026-12-21 has run (published_profile, gym_photos.sort_order): asked once, and
// again a minute later while it's missing, so Discover keeps working before it
let publishing = { has: false, at: 0 };
async function hasPublishing(db) {
  if (publishing.has || Date.now() - publishing.at < 60000) return publishing.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms' AND COLUMN_NAME = 'published_profile'");
  publishing = { has: Number(row.n) > 0, at: Date.now() };
  return publishing.has;
}

// A branch that never published shows its name, place, plans and PT only
const NOTHING = { about: null, facilities: [], custom: [], hours: null, closures: [], contact: { address: null, phone: null, whatsapp: null, email: null, website: null, instagram: null, facebook: null }, photos: [], show: profileRules.showBody({}) };

/**
 * What members may see of a branch: the published copy (or, before the migration, the profile as it
 * is), with switched-off sections emptied. row: the gyms row; photoIds: its gallery in order.
 */
function memberProfile(row, photoIds, withPublishing, today) {
  const profile = withPublishing ? profileRules.readPublished(row.published_profile, photoIds, today) ?? NOTHING : profileRules.snapshot(row, photoIds, today);
  return profileRules.forMembers(profile);
}

// Every branch's gallery ids in order (and keys, for the cover's URL)
async function galleries(pool, ids, withPublishing) {
  if (ids.length === 0) return new Map();
  const [rows] = await pool.query(`SELECT gym_id, id, image_key FROM gym_photos WHERE gym_id IN (?) ORDER BY ${withPublishing ? "sort_order, id" : "id"}`, [ids]);
  const out = new Map();
  for (const r of rows) out.set(r.gym_id, [...(out.get(r.gym_id) ?? []), r]);
  return out;
}

/** GET /api/gyms: a page of branches for the member's search, filters and sort */
async function discover(pool, query, today = todayInIndia()) {
  const withPublishing = await hasPublishing(pool);
  const [gyms] = await pool.query(
    `SELECT g.id, b.name AS brand, g.name AS branch, g.area, g.city, ${withPublishing ? "g.published_profile" : "g.about, g.facilities, g.opening_hours"},
       g.latitude, g.longitude, b.logo_key
     FROM gyms g JOIN gym_brands b ON b.id = g.brand_id
     ORDER BY g.id LIMIT ?`,
    [CANDIDATE_LIMIT],
  );
  const ids = gyms.map((g) => g.id);
  const [[plans], photosOf] = await Promise.all([
    ids.length ? pool.query(`SELECT gym_id, duration, duration_unit, price FROM gym_catalog_items WHERE kind = 'plan' AND gym_id IN (?)${await activeOnly(pool)}`, [ids]) : [[]],
    galleries(pool, ids, withPublishing),
  ]);
  const plansOf = new Map();
  for (const p of plans) plansOf.set(p.gym_id, [...(plansOf.get(p.gym_id) ?? []), p]);

  const candidates = gyms.map((g) => {
    const gallery = photosOf.get(g.id) ?? [];
    const seen = memberProfile(g, gallery.map((p) => p.id), withPublishing, today);
    const cover = gallery.find((p) => p.id === seen.photos[0]);
    const branchPlans = seen.showPlans ? plansOf.get(g.id) ?? [] : [];
    return {
      id: g.id, brand: g.brand, branch: g.branch, area: g.area, city: g.city, about: seen.about,
      facilities: seen.facilities,
      hasHours: seen.hours !== null,
      latitude: g.latitude === null || !seen.showLocation ? null : Number(g.latitude),
      longitude: g.longitude === null || !seen.showLocation ? null : Number(g.longitude),
      photoCount: seen.photos.length,
      planCount: branchPlans.length,
      fromPrice: rules.fromPrice(branchPlans),
      coverUrl: cover ? coverUrl(g.id, cover.id, cover.image_key) : null,
      logoUrl: logoUrl(g.id, g.logo_key),
    };
  });
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

/**
 * A branch's page from what members may see (seen: profileRules.forMembers), its gallery rows,
 * catalogue items and how to reach its images (photoUrl, logo)
 */
function pageOf(g, seen, gallery, items, urls) {
  const byId = new Map(gallery.map((p) => [p.id, p]));
  return {
    id: g.id,
    name: g.brand,
    branch: g.branch,
    area: g.area,
    city: g.city,
    about: seen.about,
    facilities: seen.facilities,
    customFacilities: seen.custom,
    hours: seen.hours,
    closures: seen.closures,
    contact: seen.contact,
    location: g.latitude === null || !seen.showLocation ? null : { latitude: Number(g.latitude), longitude: Number(g.longitude) },
    logoUrl: urls.logo,
    photos: seen.photos.filter((id) => byId.has(id)).map((id) => ({ id, url: urls.photo(byId.get(id)) })),
    plans: seen.showPlans ? rules.comparePlans(items) : [],
    pt: seen.showPt
      ? items
        .filter((i) => i.kind === "pt")
        .map((i) => ({ id: i.id, name: i.name, months: i.duration_unit === "months" ? i.duration : null, price: i.price, details: i.details ?? null, benefits: rules.readBenefits(i.benefits), order: Number(i.sort_order ?? 0) }))
        .sort((a, b) => rules.byGymOrder(a.order, b.order) || (a.months ?? 0) - (b.months ?? 0) || a.price - b.price)
        .map(({ order, ...p }) => p)
      : [],
  };
}
const PAGE_GYM = (columns) => `SELECT g.id, b.name AS brand, g.name AS branch, g.area, g.city, ${columns}, g.latitude, g.longitude, b.logo_key
  FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?`;
// The branch's plans and PT packages members may see: active ones only, with benefits, the gym's
// Best value and its order once migration 2026-12-24 has run
const pageItems = async (pool, gymId) => {
  const options = await hasPlanOptions(pool);
  return pool.query(
    `SELECT id, kind, name, duration, duration_unit, price, details${options ? ", benefits, best_value, sort_order" : ""}
     FROM gym_catalog_items WHERE gym_id = ? AND kind IN ('plan', 'pt')${options ? " AND status = 'active'" : ""}`,
    [gymId],
  );
};

/** GET /api/gyms/:id: one branch's page, as published */
async function gymPage(pool, gymId, today = todayInIndia()) {
  const withPublishing = await hasPublishing(pool);
  const [[[g]], gallery, [items]] = await Promise.all([
    pool.query(PAGE_GYM(withPublishing ? "g.published_profile, g.published_at" : "g.about, g.facilities, g.opening_hours, g.address, g.phone"), [gymId]),
    galleries(pool, [gymId], withPublishing).then((m) => m.get(gymId) ?? []),
    pageItems(pool, gymId),
  ]);
  if (!g) throw new NotFoundError("That gym isn't on justFit any more.");
  const seen = memberProfile(g, gallery.map((p) => p.id), withPublishing, today);
  return {
    ...pageOf(g, seen, gallery, items, { logo: logoUrl(g.id, g.logo_key), photo: (p) => coverUrl(g.id, p.id, p.image_key) }),
    updatedAt: withPublishing && g.published_at ? new Date(g.published_at).toISOString() : null,
  };
}

/**
 * GET /api/gym/profile/preview: the gym's own page as members would see it once the draft is
 * published, for the branch's portal logins; images through the portal's routes
 */
async function previewPage(pool, gym, today = todayInIndia()) {
  const [[[g]], { row, photos }, [items]] = await Promise.all([
    pool.query(PAGE_GYM("g.id AS gym_id"), [gym.id]),
    gymProfile.draftOf(pool, gym.id),
    pageItems(pool, gym.id),
  ]);
  if (!g) throw new NotFoundError("That branch doesn't exist any more.");
  const seen = profileRules.forMembers(profileRules.snapshot(row, photos.map((p) => p.id), today));
  return {
    ...pageOf(g, seen, photos, items, {
      logo: g.logo_key ? `/api/gym/logo?v=${g.logo_key.slice(0, 8)}` : null,
      photo: (p) => `/api/gym/profile/photos/${p.id}?v=${p.image_key.slice(0, 8)}`,
    }),
    updatedAt: null,
  };
}

/** A branch's gallery photo, by the branch in the path and the photo's id: only a published one */
async function photo(pool, gymId, photoId, today = todayInIndia()) {
  const withPublishing = await hasPublishing(pool);
  const [[[g]], gallery] = await Promise.all([
    pool.query(`SELECT id, ${withPublishing ? "published_profile" : "about"} FROM gyms WHERE id = ?`, [gymId]),
    galleries(pool, [gymId], withPublishing).then((m) => m.get(gymId) ?? []),
  ]);
  const shown = g ? memberProfile(g, gallery.map((p) => p.id), withPublishing, today).photos : [];
  const row = shown.includes(photoId) ? gallery.find((p) => p.id === photoId) : null;
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

module.exports = { discover, gymPage, previewPage, photo, logo, hasPublishing, send: covers.send };
