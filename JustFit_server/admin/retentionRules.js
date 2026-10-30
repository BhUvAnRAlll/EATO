// Pure rules for Super Admin › App Usage, phase 3 (no database, no network), unit-tested
// directly: how retention is read off a cohort's activity, how the member list is checked and
// sorted, and how a feature's detail query is checked.
const { ValidationError } = require("../profile");
const { FEATURES } = require("./usageRules");

// The days after joining that the retention table reports
const RETENTION_DAYS = [1, 7, 30];
// Cohorts: members grouped by the week (or month) they joined, this many back
const COHORT_LIMITS = { week: 8, month: 6 };
const COHORT_UNITS = ["week", "month"];

const MEMBER_SORTS = ["last_active", "sessions", "interactions", "active_days", "name"];
const MEMBER_PAGE = 25;
const limits = { search: 80, maxPage: 10000 };

/**
 * Day-N retention for one cohort: the share of its members who did anything on or after day N
 * (counted from the day they joined), or null while the cohort is too young for that day to
 * have arrived. `active` is a list of { userId, daysAfterJoin } rows for the cohort.
 */
function retentionFor(cohortSize, activeRows, day, cohortAgeDays) {
  if (cohortSize === 0 || cohortAgeDays < day) return null;
  const kept = new Set(activeRows.filter((r) => Number(r.daysAfterJoin) >= day).map((r) => r.userId)).size;
  return Math.round((kept / cohortSize) * 100);
}

// Weekly or monthly retention: how many distinct members active in each later period
function cohortQuery(query) {
  const unit = query.unit === undefined || query.unit === "" ? "week" : query.unit;
  if (!COHORT_UNITS.includes(unit)) throw new ValidationError("Pick a cohort unit: week or month.");
  return { unit, cohorts: COHORT_LIMITS[unit] };
}

// The member list's query: search (a name or an id), sort, page
function membersQuery(query) {
  const sort = query.sort === undefined || query.sort === "" ? "last_active" : query.sort;
  if (!MEMBER_SORTS.includes(sort)) throw new ValidationError("Pick a sort: last_active, sessions, interactions, active_days or name.");
  let search = query.search === undefined || query.search === null ? "" : String(query.search).trim();
  if (search.length > limits.search) throw new ValidationError(`A search can be at most ${limits.search} characters.`);
  const page = query.page === undefined || query.page === "" ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > limits.maxPage) throw new ValidationError("That page doesn't exist.");
  return { sort, search, page, limit: MEMBER_PAGE, offset: (page - 1) * MEMBER_PAGE };
}

// A feature id from the path: only ids from the catalogue, never free text
function featureId(value) {
  const feature = FEATURES.find((f) => f.id === value);
  if (!feature) throw new ValidationError("That isn't a feature App Usage tracks.");
  return feature;
}

// A member's most-used feature from their per-feature counts (ties: the first in catalogue order)
function mostUsed(counts) {
  let best = null;
  for (const f of FEATURES) {
    const n = Number(counts[f.id] ?? 0);
    if (n > 0 && (best === null || n > best.uses)) best = { id: f.id, label: f.label, uses: n };
  }
  return best;
}

module.exports = { RETENTION_DAYS, COHORT_LIMITS, COHORT_UNITS, MEMBER_SORTS, MEMBER_PAGE, limits, retentionFor, cohortQuery, membersQuery, featureId, mostUsed };
