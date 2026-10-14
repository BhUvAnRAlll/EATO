// Unit tests for the home screen content validators (home.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const home = require("../home.js");

const validPromotion = () => ({
  title: "Chef-prepared meals",
  eyebrow: "CHEF-PREPARED",
  headline: "Healthy meals for a stronger you",
  description: "Nutritious, chef-prepared meals delivered to your doorstep.",
  imageUrl: "asset:hero-meals",
  ctaLabel: "Order Now",
  ctaDestination: "explore",
});

const rejects = (body, pattern) => assert.throws(() => home.validatePromotion(body), (error) => error.status === 400 && pattern.test(error.message));

describe("validatePromotion", () => {
  it("accepts a complete promotion and fills in the defaults", () => {
    const row = home.validatePromotion(validPromotion());
    assert.equal(row.title, "Chef-prepared meals");
    assert.equal(row.image_url, "asset:hero-meals");
    assert.equal(row.cta_action, "open_screen");
    assert.equal(row.status, "draft");
    assert.equal(row.rotation_interval_seconds, 2);
    assert.equal(row.text_align, "left");
    assert.equal(row.image_position, "right");
    assert.equal(row.starts_at, null);
    assert.equal(row.secondary_cta_label, null);
  });

  it("trims text and enforces the column lengths", () => {
    assert.equal(home.validatePromotion({ ...validPromotion(), title: "  Spaced  " }).title, "Spaced");
    rejects({ ...validPromotion(), title: "" }, /Title is required/);
    rejects({ ...validPromotion(), headline: "x".repeat(81) }, /Headline is too long/);
    rejects({ ...validPromotion(), description: 42 }, /Description is required/);
  });

  it("rejects unexpected fields, so nothing unknown reaches the database", () => {
    rejects({ ...validPromotion(), displayOrder: 1 }, /unexpected field: displayOrder/);
    rejects({ ...validPromotion(), createdBy: "user_x" }, /unexpected field: createdBy/);
    rejects([], /Send the promotion as an object/);
    rejects(null, /Send the promotion as an object/);
  });

  it("only allows screens from the allowlist as destinations", () => {
    rejects({ ...validPromotion(), ctaDestination: "javascript:alert(1)" }, /Button destination isn't a valid choice/);
    rejects({ ...validPromotion(), ctaDestination: "/admin" }, /Button destination isn't a valid choice/);
    rejects({ ...validPromotion(), ctaAction: "run_script" }, /Button action isn't a valid choice/);
    for (const destination of home.DESTINATIONS) {
      assert.equal(home.validatePromotion({ ...validPromotion(), ctaDestination: destination }).cta_destination, destination);
    }
  });

  it("accepts bundled images and https URLs only", () => {
    assert.equal(home.validatePromotion({ ...validPromotion(), imageUrl: "https://cdn.example.com/a.jpg" }).image_url, "https://cdn.example.com/a.jpg");
    rejects({ ...validPromotion(), imageUrl: "asset:not-bundled" }, /bundled images/);
    rejects({ ...validPromotion(), imageUrl: "http://cdn.example.com/a.jpg" }, /https URL/);
    rejects({ ...validPromotion(), imageUrl: "https://user:pw@cdn.example.com/a.jpg" }, /https URL/);
    rejects({ ...validPromotion(), imageUrl: "javascript:alert(1)" }, /https URL/);
    rejects({ ...validPromotion(), imageUrl: "not a url" }, /bundled image or an https URL/);
  });

  it("keeps the secondary button whole: label and destination together or not at all", () => {
    rejects({ ...validPromotion(), secondaryCtaLabel: "Learn more" }, /both a label and a destination/);
    rejects({ ...validPromotion(), secondaryCtaDestination: "plans" }, /both a label and a destination/);
    const row = home.validatePromotion({ ...validPromotion(), secondaryCtaLabel: "Learn more", secondaryCtaDestination: "plans" });
    assert.equal(row.secondary_cta_label, "Learn more");
    assert.equal(row.secondary_cta_action, "open_screen");
    assert.equal(row.secondary_cta_destination, "plans");
  });

  it("limits the rotation interval to whole seconds between 1 and 30", () => {
    assert.equal(home.validatePromotion({ ...validPromotion(), rotationIntervalSeconds: 5 }).rotation_interval_seconds, 5);
    rejects({ ...validPromotion(), rotationIntervalSeconds: 0 }, /between 1 and 30/);
    rejects({ ...validPromotion(), rotationIntervalSeconds: 31 }, /between 1 and 30/);
    rejects({ ...validPromotion(), rotationIntervalSeconds: 2.5 }, /between 1 and 30/);
    rejects({ ...validPromotion(), rotationIntervalSeconds: "2" }, /between 1 and 30/);
  });

  it("checks the schedule window", () => {
    const row = home.validatePromotion({ ...validPromotion(), startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" });
    assert.ok(row.starts_at instanceof Date && row.ends_at instanceof Date);
    rejects({ ...validPromotion(), startsAt: "2026-10-31T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" }, /end date must be after/);
    rejects({ ...validPromotion(), startsAt: "next tuesday" }, /isn't a valid date/);
    assert.equal(home.validatePromotion({ ...validPromotion(), startsAt: "" }).starts_at, null);
  });

  it("validates colours, alignment and status", () => {
    assert.equal(home.validatePromotion({ ...validPromotion(), backgroundColor: "#1a322a" }).background_color, "#1A322A");
    rejects({ ...validPromotion(), backgroundColor: "red" }, /hex colour/);
    rejects({ ...validPromotion(), textAlign: "justify" }, /Text alignment/);
    rejects({ ...validPromotion(), imagePosition: "top" }, /Image position/);
    rejects({ ...validPromotion(), status: "scheduled" }, /Status isn't a valid choice/);
    assert.equal(home.validatePromotion({ ...validPromotion(), status: "published" }).status, "published");
  });
});

describe("effectiveStatus and ids", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const row = (overrides) => ({ status: "published", starts_at: null, ends_at: null, ...overrides });

  it("derives scheduled and ended from a published promotion's window", () => {
    assert.equal(home.effectiveStatus(row({}), now), "published");
    assert.equal(home.effectiveStatus(row({ starts_at: new Date("2026-11-01T00:00:00Z") }), now), "scheduled");
    assert.equal(home.effectiveStatus(row({ ends_at: new Date("2026-10-01T00:00:00Z") }), now), "ended");
    assert.equal(home.effectiveStatus(row({ status: "draft", starts_at: new Date("2026-11-01T00:00:00Z") }), now), "draft");
    assert.equal(home.effectiveStatus(row({ status: "disabled" }), now), "disabled");
  });

  it("accepts only positive integer ids from the route", () => {
    assert.equal(home.promotionId("7"), 7);
    for (const bad of ["0", "-1", "1.5", "1 OR 1=1", "1;DROP TABLE promotions", "abc", "", "99999999999"]) {
      assert.throws(() => home.promotionId(bad), /isn't valid/);
    }
  });
});

const validContent = () => ({
  nutritionHeading: "Today's Nutrition",
  nutritionActionLabel: "Edit Goal",
  popularHeading: "Popular Meals",
  popularActionLabel: "View all",
  todayHeading: "Today",
  todayActionLabel: "View all",
  showTodaySection: true,
  quickActions: [
    { id: "meals", title: "Meals", subtitle: "Browse menu", icon: "meals", destination: "explore" },
    { id: "plans", title: "Plans", subtitle: "For your goals", icon: "plans", destination: "plans" },
  ],
  popularMealIds: ["grilled-chicken-bowl", "salmon-bowl"],
});

const rejectsContent = (body, pattern) => assert.throws(() => home.validateHomeContent(body), (error) => error.status === 400 && pattern.test(error.message));

describe("validateHomeContent", () => {
  it("accepts the editable labels, quick actions and popular meals", () => {
    const row = home.validateHomeContent(validContent());
    assert.equal(row.nutrition_heading, "Today's Nutrition");
    assert.equal(row.show_today_section, true);
    assert.equal(row.quick_actions.length, 2);
    assert.deepEqual(row.popular_meal_ids, ["grilled-chicken-bowl", "salmon-bowl"]);
  });

  it("only allows icons and destinations from the allowlists", () => {
    rejectsContent({ ...validContent(), quickActions: [{ id: "x", title: "X", subtitle: "Y", icon: "skull", destination: "explore" }] }, /icon isn't a valid choice/);
    rejectsContent({ ...validContent(), quickActions: [{ id: "x", title: "X", subtitle: "Y", icon: "meals", destination: "https://evil.example" }] }, /destination isn't a valid choice/);
    rejectsContent({ ...validContent(), quickActions: [{ id: "x", title: "X", subtitle: "Y", icon: "meals", destination: "explore", onPress: "alert(1)" }] }, /unexpected field: onPress/);
  });

  it("keeps quick action ids unique and the lists short", () => {
    const action = { id: "same", title: "A", subtitle: "B", icon: "meals", destination: "explore" };
    rejectsContent({ ...validContent(), quickActions: [action, action] }, /ids must be unique/);
    rejectsContent({ ...validContent(), quickActions: Array.from({ length: 7 }, (_, i) => ({ ...action, id: `a${i}` })) }, /At most 6 quick actions/);
    rejectsContent({ ...validContent(), popularMealIds: Array.from({ length: 11 }, (_, i) => `meal-${i}`) }, /At most 10 popular meals/);
    rejectsContent({ ...validContent(), popularMealIds: ["a", "a"] }, /only be listed once/);
    rejectsContent({ ...validContent(), popularMealIds: ["x'; DROP TABLE meals"] }, /list of meal ids/);
  });

  it("rejects wrong types and unknown fields", () => {
    rejectsContent({ ...validContent(), showTodaySection: "yes" }, /true or false/);
    rejectsContent({ ...validContent(), quickActions: "none" }, /must be a list/);
    rejectsContent({ ...validContent(), caloriesTarget: 2000 }, /unexpected field: caloriesTarget/);
    rejectsContent({ ...validContent(), popularHeading: "x".repeat(41) }, /too long/);
  });
});
