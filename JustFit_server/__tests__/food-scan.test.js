// Food photo scan (macro/foodScan.js): the photo checks and the clean-up of the model's
// answer. Pure functions, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { checkFoodPhoto, normalizeFoodScan, scanFood, scanLimits, FoodScanError } = require("../macro/foodScan.js");
const { validateMeal, limits } = require("../macro/validate.js");
const { uploadLimits } = require("../bodyComposition/upload.js");

const toBase64 = (bytes, padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const photo = (over = {}) => ({ data: toBase64(JPEG, 64), mediaType: "image/jpeg", ...over });

describe("Food photo checks (server)", () => {
  it("accepts a photo, with or without a note", () => {
    const plain = checkFoodPhoto(photo());
    assert.equal(plain.ok, true);
    assert.equal(plain.hint, "");
    const noted = checkFoodPhoto(photo({ hint: "  two rotis\nand dal " }));
    assert.equal(noted.hint, "two rotis and dal");
  });

  it("cuts a long note to the limit", () => {
    assert.equal(checkFoodPhoto(photo({ hint: "a".repeat(500) })).hint.length, scanLimits.hintLength);
  });

  it("refuses PDFs, mislabelled files and other types", () => {
    assert.equal(checkFoodPhoto({ data: toBase64(PDF, 64), mediaType: "application/pdf" }).status, 415);
    assert.equal(checkFoodPhoto({ data: toBase64(PDF, 64), mediaType: "image/jpeg" }).status, 415);
    assert.equal(checkFoodPhoto({ data: toBase64([0x4d, 0x5a, 0x90, 0x00], 64), mediaType: "image/jpeg" }).status, 415);
  });

  it("refuses an oversized photo", () => {
    assert.equal(checkFoodPhoto(photo({ data: toBase64(JPEG, uploadLimits.maxImageBytes + 1) })).status, 413);
  });

  it("refuses malformed requests and unexpected fields", () => {
    for (const body of [null, [], "x", {}, { data: 1, mediaType: "image/jpeg" }, photo({ data: "not base64!!" }), photo({ hint: 5 }), photo({ userId: "user_other" })]) {
      const result = checkFoodPhoto(body);
      assert.equal(result.ok, false);
      assert.equal(result.status, 400);
    }
  });
});

describe("Food scan clean-up (server)", () => {
  it("turns the model's answer into a meal the diary accepts", () => {
    const scan = normalizeFoodScan({
      isFood: true,
      title: "Idli and sambar",
      items: [
        { name: "Idli", quantity: 3, unit: "piece", kcal: 174.26, proteinG: 6, carbsG: 36, fatG: 0.6 },
        { name: "Sambar", quantity: 200, unit: "ml", kcal: 130, proteinG: 6, carbsG: 18, fatG: 4 },
      ],
    });
    assert.equal(scan.title, "Idli and sambar");
    assert.equal(scan.items[0].kcal, 174.3);
    const meal = validateMeal({ date: new Date().toISOString().slice(0, 10), slot: "breakfast", title: scan.title, loggedAt: Date.now(), items: scan.items }, Date.now());
    assert.equal(meal.items.length, 2);
  });

  it("keeps every value inside the diary's limits", () => {
    const scan = normalizeFoodScan({
      isFood: true,
      title: "x".repeat(300),
      items: [{ name: "Thali\u0000", quantity: -4, unit: "bowl", kcal: 99999, proteinG: -1, carbsG: Number.NaN, fatG: 5000 }],
    });
    const [item] = scan.items;
    assert.equal(scan.title.length, limits.nameLength);
    assert.equal(item.name, "Thali");
    assert.ok(item.quantity > 0);
    assert.equal(item.unit, "serving");
    assert.equal(item.kcal, limits.kcalMax);
    assert.equal(item.proteinG, 0);
    assert.equal(item.carbsG, 0);
    assert.equal(item.fatG, limits.macroMax);
  });

  it("drops unnamed foods, caps the count and fills a missing title", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: i === 0 ? " " : `Food ${i}`, quantity: 1, unit: "g", kcal: 1, proteinG: 0, carbsG: 0, fatG: 0 }));
    const scan = normalizeFoodScan({ isFood: true, title: "", items: many });
    assert.equal(scan.items.length, scanLimits.maxItems - 1);
    assert.ok(scan.title.startsWith("Food 1, Food 2"));
  });

  it("answers 422 when there is no food", () => {
    for (const raw of [{ isFood: false, title: "", items: [] }, { isFood: true, title: "Plate", items: [] }, null, { isFood: true }]) {
      assert.throws(() => normalizeFoodScan(raw), (error) => error instanceof FoodScanError && error.status === 422);
    }
  });

  it("uses the fixed answer in tests, without calling OpenAI", async () => {
    const scan = await scanFood({ base64: "x", mediaType: "image/jpeg", hint: "" }, { NODE_ENV: "test", AI_PROVIDER: "fake" });
    assert.equal(scan.items.length, 3);
  });
});

describe("food estimate (Manual Entry's Estimate with AI)", () => {
  const { checkEstimateRequest, normalizeEstimate, estimateFood } = require("../macro/foodScan.js");

  it("accepts a name, an amount and g, ml or piece; trims and cleans the name", () => {
    assert.deepEqual(checkEstimateRequest({ name: "  Paneer\nbutter masala ", quantity: 200, unit: "g" }), { ok: true, name: "Paneer butter masala", quantity: 200, unit: "g" });
    assert.equal(checkEstimateRequest({ name: "Roti", quantity: 2, unit: "piece" }).ok, true);
  });

  it("refuses a missing name, a bad amount or unit, extra fields and non-objects with a 400", () => {
    for (const body of [null, [], "x", { name: "a", quantity: 1, unit: "g" }, { name: "Dal", quantity: 0, unit: "g" }, { name: "Dal", quantity: "100", unit: "g" },
      { name: "Dal", quantity: 100, unit: "cup" }, { name: "Dal", quantity: limits.quantityMax + 1, unit: "g" }, { name: "Dal", quantity: 100, unit: "g", userId: "x" }]) {
      const r = checkEstimateRequest(body);
      assert.equal(r.ok, false, JSON.stringify(body));
      assert.equal(r.status, 400);
    }
  });

  it("caps the model's numbers and refuses an answer that isn't food (422)", () => {
    assert.deepEqual(normalizeEstimate({ isFood: true, kcal: 250.44, proteinG: -3, carbsG: 30, fatG: 1e9 }), { kcal: 250.4, proteinG: 0, carbsG: 30, fatG: limits.macroMax });
    assert.throws(() => normalizeEstimate({ isFood: false, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }), (e) => e instanceof FoodScanError && e.status === 422);
    assert.throws(() => normalizeEstimate({ isFood: true, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }), (e) => e instanceof FoodScanError && e.status === 422);
  });

  it("answers a fixed estimate in tests and records the call", async () => {
    const recorded = [];
    const estimate = await estimateFood({ name: "Dal", quantity: 100, unit: "g" }, { NODE_ENV: "test", AI_PROVIDER: "fake" }, { record: async (r) => recorded.push(r) });
    assert.deepEqual(estimate, { kcal: 240, proteinG: 8, carbsG: 30, fatG: 10 });
    assert.equal(recorded[0].status, "ok");
  });
});
