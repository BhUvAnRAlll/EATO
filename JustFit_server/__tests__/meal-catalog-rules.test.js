// The Meals tab's catalogue rules (meals/catalogRules.js): categories, banners, coupons and what a
// coupon takes off an order, plus the extended meal and order bodies (meals/rules.js).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const c = require("../meals/catalogRules");
const rules = require("../meals/rules");
const { ValidationError } = require("../profile");

describe("meal catalogue rules: categories", () => {
  const tile = { kind: "tile", name: "Under ₹99", maxPrice: 99, badge: "Deal" };

  it("accepts a category that lists meals one way", () => {
    assert.deepEqual(c.categoryBody(tile), {
      kind: "tile", name: "Under ₹99", subtitle: null, badge: "Deal", matchTag: null, maxPricePaise: 9900, mealIds: [], featured: false, active: true, sortOrder: 0,
    });
    assert.equal(c.categoryBody({ kind: "food", name: "Meal Bowls", mealIds: ["paneer-bowl", "paneer-bowl", "dal-bowl"], featured: true }).mealIds.length, 2);
    assert.equal(c.categoryBody({ kind: "tile", name: "High Protein", matchTag: "high_protein" }).matchTag, "high_protein");
  });

  it("refuses a category with no way, two ways, or bad values", () => {
    for (const bad of [
      { kind: "tile", name: "Empty" }, { ...tile, matchTag: "gourmet" }, { ...tile, kind: "promo" }, { ...tile, name: "x" },
      { kind: "food", name: "Bowls", mealIds: ["../x"] }, { kind: "food", name: "Bowls", mealIds: "a" }, { ...tile, featured: "yes" },
      { ...tile, matchTag: "keto", maxPrice: undefined }, { ...tile, sortOrder: 5000 }, { ...tile, extra: 1 },
    ]) assert.throws(() => c.categoryBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("matches meals by tag, by price or by pick", () => {
    const meal = { id: "a", tags: ["high_protein"], pricePaise: 8900 };
    assert.equal(c.categoryHas({ matchTag: "high_protein" }, meal, new Set()), true);
    assert.equal(c.categoryHas({ matchTag: "gourmet" }, meal, new Set()), false);
    assert.equal(c.categoryHas({ maxPricePaise: 9900 }, meal, new Set()), true);
    assert.equal(c.categoryHas({ maxPricePaise: 5000 }, meal, new Set()), false);
    assert.equal(c.categoryHas({}, meal, new Set(["a"])), true);
    assert.equal(c.categoryHas({}, meal, new Set(["b"])), false);
  });
});

describe("meal catalogue rules: banners", () => {
  const banner = { title: "Specials of the Week", target: { kind: "tag", ref: "special" }, startsOn: "2026-11-09", endsOn: "2026-11-15" };

  it("accepts a banner and fills the button", () => {
    const b = c.bannerBody(banner);
    assert.equal(b.ctaLabel, "Explore now");
    assert.deepEqual(b.target, { kind: "tag", ref: "special" });
    assert.deepEqual(c.bannerBody({ ...banner, target: { kind: "category", ref: "12" } }).target, { kind: "category", ref: "12" });
  });

  it("refuses bad targets and days", () => {
    for (const bad of [
      { ...banner, target: { kind: "url", ref: "https://evil.example" } }, { ...banner, target: { kind: "tag", ref: "keto" } },
      { ...banner, target: { kind: "category", ref: "1 OR 1=1" } }, { ...banner, target: { kind: "meal", ref: "../../etc" } },
      { ...banner, endsOn: "2026-11-01" }, { ...banner, startsOn: "9-11-2026" }, { ...banner, title: "Hi" },
    ]) assert.throws(() => c.bannerBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("shows only while on and inside its days", () => {
    const b = { active: true, startsOn: "2026-11-09", endsOn: "2026-11-15" };
    assert.equal(c.showsOn(b, "2026-11-09"), true);
    assert.equal(c.showsOn(b, "2026-11-15"), true);
    assert.equal(c.showsOn(b, "2026-11-16"), false);
    assert.equal(c.showsOn(b, "2026-11-08"), false);
    assert.equal(c.showsOn({ ...b, active: false }, "2026-11-10"), false);
    assert.equal(c.showsOn({ active: true, startsOn: null, endsOn: null }, "2030-01-01"), true);
  });
});

describe("meal catalogue rules: coupons", () => {
  const save100 = c.couponBody({ code: "save100", title: "50% off up to ₹100", kind: "percent", percentOff: 50, maxDiscount: 100, minOrder: 149, endsOn: "2026-11-30" });

  it("keeps a coupon in paise with an upper-case code", () => {
    assert.equal(save100.code, "SAVE100");
    assert.equal(save100.maxDiscountPaise, 10000);
    assert.equal(save100.minOrderPaise, 14900);
    assert.equal(save100.flatOffPaise, null);
    assert.equal(c.couponBody({ code: "FLAT50", title: "₹50 off", kind: "flat", flatOff: 50, maxDiscount: 10 }).maxDiscountPaise, null, "no cap on a flat coupon");
  });

  it("refuses bad coupons", () => {
    for (const bad of [
      { code: "AB", title: "Short", kind: "flat", flatOff: 10 }, { code: "SAVE-100", title: "Dash", kind: "flat", flatOff: 10 },
      { code: "SAVE", title: "Too much", kind: "percent", percentOff: 95 }, { code: "SAVE", title: "None", kind: "flat" },
      { code: "SAVE", title: "Days", kind: "flat", flatOff: 10, startsOn: "2026-12-01", endsOn: "2026-11-01" },
      { code: "SAVE", title: "Kind", kind: "bogo", flatOff: 10 }, { code: "SAVE", title: "Extra", kind: "flat", flatOff: 10, uses: 3 },
    ]) assert.throws(() => c.couponBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("works out the discount with its cap, never more than the subtotal", () => {
    assert.equal(c.discountFor(save100, 14900), 7450);
    assert.equal(c.discountFor(save100, 50000), 10000, "capped at ₹100");
    assert.equal(c.discountFor({ kind: "flat", flatOffPaise: 5000 }, 3000), 3000);
    assert.equal(c.discountFor({ kind: "percent", percentOff: 10, maxDiscountPaise: null }, 999), 99, "rounded down");
  });

  it("says why a coupon can't be used", () => {
    const today = "2026-11-09";
    assert.equal(c.couponProblem(save100, { today, subtotalPaise: 20000, used: 0 }), null);
    assert.match(c.couponProblem(save100, { today, subtotalPaise: 10000, used: 0 }), /Add ₹49 more/);
    assert.match(c.couponProblem(save100, { today, subtotalPaise: 20000, used: 1 }), /already used/);
    assert.match(c.couponProblem(save100, { today: "2026-12-01", subtotalPaise: 20000, used: 0 }), /expired/);
    assert.match(c.couponProblem({ ...save100, startsOn: "2026-11-20" }, { today, subtotalPaise: 20000, used: 0 }), /starts on/);
    assert.match(c.couponProblem({ ...save100, active: false }, { today, subtotalPaise: 20000, used: 0 }), /isn't available/);
    assert.match(c.couponProblem(null, { today, subtotalPaise: 20000, used: 0 }), /isn't valid/);
    assert.deepEqual(c.couponLine(save100), { off: "50% off up to ₹100", above: "Above ₹149" });
  });

  it("keeps a first-order coupon for members who have never ordered", () => {
    const today = "2026-11-09";
    const welcome = c.couponBody({ code: "welcome75", title: "₹75 off your first order", kind: "flat", flatOff: 75, firstOrderOnly: true });
    assert.equal(welcome.firstOrderOnly, true);
    assert.equal(c.couponBody({ code: "FLAT50", title: "₹50 off", kind: "flat", flatOff: 50 }).firstOrderOnly, false, "off unless asked");
    assert.throws(() => c.couponBody({ code: "BAD1", title: "Bad one", kind: "flat", flatOff: 50, firstOrderOnly: "yes" }), ValidationError);
    assert.equal(c.couponProblem(welcome, { today, subtotalPaise: 20000, used: 0, orders: 0 }), null);
    assert.equal(c.couponProblem(welcome, { today, subtotalPaise: 20000, used: 0, orders: 1 }), "That coupon is for your first order.");
    assert.equal(c.couponProblem(save100, { today, subtotalPaise: 20000, used: 0, orders: 5 }), null, "other coupons don't care");
  });
});

describe("meal rules: the extended meal and order", () => {
  const meal = { name: "Paneer Bowl", diet: "vegetarian", calories: 520, proteinG: 32, carbsG: 48, fatG: 18, price: 249 };

  it("takes tags, serving size, ingredients, an original price and visibility", () => {
    const m = rules.mealBody({ ...meal, tags: ["special", "high_protein"], mrp: 299, servingSize: "1 bowl · 450 g", ingredients: "Paneer, rice", available: false });
    assert.deepEqual(m.tags, ["high_protein", "special"]);
    assert.equal(m.mrpPaise, 29900);
    assert.equal(m.available, false);
    assert.equal(rules.mealBody(meal).available, true);
    for (const bad of [{ ...meal, mrp: 249 }, { ...meal, tags: ["keto"] }, { ...meal, tags: ["special", "special"] }, { ...meal, available: "no" }]) {
      assert.throws(() => rules.mealBody(bad), ValidationError, JSON.stringify(bad));
    }
  });

  it("reads a coupon code on an order and a quote", () => {
    const items = [{ mealId: "paneer-bowl", quantity: 1 }];
    assert.equal(rules.quoteBody({ items, couponCode: " save100 " }).couponCode, "SAVE100");
    assert.equal(rules.quoteBody({ items }).couponCode, null);
    for (const couponCode of ["SA", "SAVE 100", "x' OR '1'='1", 100]) assert.throws(() => rules.quoteBody({ items, couponCode }), ValidationError);
    assert.throws(() => rules.quoteBody({ items, total: 1 }), ValidationError);
  });
});
