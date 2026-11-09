// Discover extras (Gym Hub ecosystem, 2026-11-10): featured gyms first when sorting by relevance, and
// the "has trainers" filter
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/discoverRules");

const gym = (id, over = {}) => ({ id, brand: `Gym ${id}`, branch: "Main", area: "Area", city: "Bengaluru", about: null, facilities: [], hasHours: false, latitude: null, longitude: null, photoCount: 0, planCount: 0, fromPrice: null, featured: false, trainerCount: 0, ...over });

describe("Discover extras", () => {
  it("puts featured gyms first when sorting by relevance", () => {
    const gyms = [gym(1), gym(2, { featured: true }), gym(3)];
    assert.deepEqual(rules.pickGyms(gyms, rules.discoverQuery({})).results.map((r) => r.gym.id), [2, 1, 3]);
  });

  it("keeps only gyms with trainers when asked", () => {
    const gyms = [gym(1, { trainerCount: 2 }), gym(2), gym(3, { trainerCount: 1 })];
    assert.deepEqual(rules.pickGyms(gyms, rules.discoverQuery({ trainers: "1" })).results.map((r) => r.gym.id), [1, 3]);
    assert.equal(rules.pickGyms(gyms, rules.discoverQuery({ trainers: "0" })).total, 3);
  });
});
