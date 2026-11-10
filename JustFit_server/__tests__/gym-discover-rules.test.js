const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/discoverRules");

const TUMKUR = { latitude: 13.3379, longitude: 77.1173 };
const gym = (over) => ({
  id: 1, brand: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru", facilities: [], fromPrice: null,
  latitude: null, longitude: null, photoCount: 0, about: null, hasHours: false, planCount: 0, ...over,
});

describe("Discover Gyms rules", () => {
  it("reads the query, with defaults", () => {
    assert.deepEqual(rules.discoverQuery({}), { search: "", facilities: [], maxPrice: null, sort: "relevance", near: null, page: 1, trainers: false, type: null });
    assert.equal(rules.discoverQuery({ trainers: "1" }).trainers, true);
    assert.throws(() => rules.discoverQuery({ trainers: "yes" }), /understand/);
    assert.deepEqual(
      rules.discoverQuery({ search: "  forma   tumkur ", facilities: "parking,cardio,parking", maxPrice: "1500", sort: "distance", lat: "13.33791", lng: "77.11734", page: "2" }),
      { search: "forma tumkur", facilities: ["parking", "cardio"], maxPrice: 1500, sort: "distance", near: { latitude: 13.338, longitude: 77.117 }, page: 2, trainers: false, type: null },
    );
  });

  it("refuses what it doesn't expect", () => {
    for (const [query, message] of [
      [{ gymId: "2" }, /fields we don't use/],
      [{ search: ["a", "b"] }, /understand/],
      [{ search: "x".repeat(61) }, /up to 60/],
      [{ search: "bell\u0007" }, /up to 60/],
      [{ facilities: "pool" }, /from the list/],
      [{ facilities: "cardio' OR 1=1" }, /from the list/],
      [{ maxPrice: "1234" }, /price from the list/],
      [{ maxPrice: "abc" }, /price from the list/],
      [{ sort: "price" }, /relevance or distance/],
      [{ sort: "distance" }, /Allow your location/],
      [{ lat: "13.3" }, /isn't in India/],
      [{ lat: "51.5", lng: "-0.12" }, /isn't in India/],
      [{ lat: "13.3", lng: "x" }, /isn't in India/],
      [{ page: "0" }, /doesn't exist/],
      [{ page: "51" }, /doesn't exist/],
      [{ page: "1.5" }, /doesn't exist/],
    ]) assert.throws(() => rules.discoverQuery(query), message, JSON.stringify(query));
  });

  it("works out prices a month and the cheapest plan", () => {
    assert.equal(rules.perMonth({ duration: 3, duration_unit: "months", price: 4500 }), 1500);
    assert.equal(rules.perMonth({ duration: 15, duration_unit: "days", price: 600 }), 1200);
    assert.equal(rules.fromPrice([]), null);
    assert.equal(rules.fromPrice([{ duration: 1, duration_unit: "months", price: 1800 }, { duration: 12, duration_unit: "months", price: 12000 }]), 1000);
  });

  it("matches every word, the gym's name highest", () => {
    assert.equal(rules.matchScore(gym(), ""), 0);
    assert.equal(rules.matchScore(gym(), "forma"), 40);
    assert.equal(rules.matchScore(gym(), "orma"), 20);
    assert.equal(rules.matchScore(gym(), "forma tumakuru"), 50);
    assert.equal(rules.matchScore(gym(), "forma bengaluru"), null);
  });

  it("filters, sorts and pages", () => {
    const gyms = [
      gym({ id: 1, brand: "Zen Fitness", branch: "Hebbal", city: "Bengaluru", facilities: ["cardio"], fromPrice: 2500, latitude: 13.03, longitude: 77.59 }),
      gym({ id: 2, brand: "Forma", branch: "Tumkur", facilities: ["cardio", "parking"], fromPrice: 1200, latitude: TUMKUR.latitude, longitude: TUMKUR.longitude, photoCount: 2, about: "x", planCount: 3 }),
      gym({ id: 3, brand: "Apex", branch: "Mysuru", city: "Mysuru", facilities: ["parking"], fromPrice: null }),
    ];
    const q = (over) => ({ ...rules.discoverQuery({}), ...over });
    assert.deepEqual(rules.pickGyms(gyms, q({})).results.map((r) => r.gym.id), [2, 3, 1], "a filled-in profile first, then by name");
    assert.deepEqual(rules.pickGyms(gyms, q({ facilities: ["parking"] })).results.map((r) => r.gym.id), [2, 3]);
    assert.deepEqual(rules.pickGyms(gyms, q({ maxPrice: 1500 })).results.map((r) => r.gym.id), [2], "no plans never passes a price cap");
    assert.deepEqual(rules.pickGyms(gyms.map((g) => ({ ...g, types: g.id === 3 ? ["yoga"] : [] })), q({ type: "yoga" })).results.map((r) => r.gym.id), [3], "the kind of gym");
    assert.equal(rules.discoverQuery({ type: "yoga" }).type, "yoga");
    assert.throws(() => rules.discoverQuery({ type: "swimming" }), /kind of gym/);
    assert.deepEqual(rules.pickGyms(gyms, q({ search: "bengaluru" })).results.map((r) => r.gym.id), [1]);
    const near = rules.pickGyms(gyms, q({ sort: "distance", near: TUMKUR }));
    assert.deepEqual(near.results.map((r) => r.gym.id), [2, 1, 3], "nearest first, no location last");
    assert.equal(near.results[0].km, 0);
    assert.ok(near.results[1].km > 50 && near.results[1].km < 80);
    assert.equal(near.results[2].km, null);

    const many = Array.from({ length: 45 }, (_, i) => gym({ id: i + 1, branch: `Branch ${String(i).padStart(2, "0")}` }));
    const first = rules.pickGyms(many, q({}));
    assert.deepEqual([first.total, first.results.length, first.nextPage], [45, 20, 2]);
    const last = rules.pickGyms(many, q({ page: 3 }));
    assert.deepEqual([last.results.length, last.nextPage], [5, null]);
  });

  it("lays plans out to compare, shortest first, with the saving a month", () => {
    const plans = rules.comparePlans([
      { id: 1, kind: "plan", name: "Annual", duration: 12, duration_unit: "months", price: 12000, details: "Steam" },
      { id: 2, kind: "plan", name: "Monthly", duration: 1, duration_unit: "months", price: 1500 },
      { id: 3, kind: "pt", name: "PT", duration: 1, duration_unit: "months", price: 5000 },
      { id: 4, kind: "plan", name: "Quarter", duration: 3, duration_unit: "months", price: 4200 },
    ]);
    assert.deepEqual(plans.map((p) => [p.name, p.perMonth, p.savesPerMonth, p.details]), [["Monthly", 1500, 0, null], ["Quarter", 1400, 100, null], ["Annual", 1000, 500, "Steam"]]);
    assert.deepEqual(rules.comparePlans([]), []);
  });
});
