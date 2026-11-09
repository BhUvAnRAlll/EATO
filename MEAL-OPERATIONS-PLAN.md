# Meal Operations System: current state, gaps and build plan

Written 2026-11-10 against the "JustFit – Complete Meal Management System" brief and the user's
three member-app screens (Meals with Order Meals / Meal Subscription, My Subscription, Plan
Details). Nothing here is built yet. Each phase needs its own approval, and each marked migration is
run by hand.

## Progress

The user's answers (2026-11-10): **no new logins yet**, so the Super Admin runs kitchens and
delivery themselves and staff roles come later; start with **the brief's Phase 1**; **test payment
and foreground-only rider location**. Then "rebuild the current Meals tab to match the image", and
"build the dummy payment the way Razorpay will be integrated". The user asked for work to continue
overnight without stopping.

| Step | State |
| --- | --- |
| Meals tab rebuilt from the image (phone 1) | Built 2026-11-10; no migration |
| Razorpay-shaped dummy payment | Built 2026-11-10; migration `2026-12-28-meal-payments.sql` to run by hand |
| Phase 1: kitchens + Super Admin dashboard | Built 2026-11-10 (no logins: roster only); migration `2026-12-30-kitchens.sql` to run by hand |
| Phase 2: menu per kitchen + inventory | Next |

## 1. What exists today (meal ordering, 2026-11-09)

| Brief area | Already built | Where |
| --- | --- | --- |
| Menu | Meals with photo, diet (veg / non-veg / egg / vegan), tags (bestseller, gourmet, high protein, special), serving, ingredients, kcal and macros, price and struck price, show / hide, delete | `meals/catalog.js`, `admin/meals/` |
| Categories, banners, coupons | Tiles and food categories, dated banners, coupons (% or ₹, min order, uses per member, dates) | `meals/catalogRules.js` |
| Delivery slots | Breakfast / lunch / dinner times, one set for everyone; each closes 2 h before | `meal_delivery_slots` |
| Serviceable areas | Pincode list, CLI only | `delivery_pincodes`, `npm run delivery-pincode` |
| Member ordering | Storefront, search, cart (≤3 a meal), day (today + 6), slot, address, coupon, test payment, one `clientId` per order (no duplicates) | `(tabs)/meals.tsx`, `meals/service.js` |
| Order steps | placed → preparing → out_for_delivery → delivered, cancel with reason; the step moves only from the step the admin saw; delivered logs to Macro | `orders.status` |
| Super Admin orders | One day, To do / Delivered / Cancelled / All, by slot, one advance button | `admin/(tabs)/orders.tsx` |
| Audit | `admin_audit_log` `meal.*`, `order.*` | |
| Not there at all | Kitchens, inventory, recipes, kitchen roles, delivery partners, assignment, subscriptions, slot capacity, holidays, issues / refunds, reports, a real payment | |

The Super Admin is the menu, the kitchen and the delivery person today (the user's choice of
2026-11-09). The brief replaces that with kitchens, kitchen staff and riders.

## 2. Decisions the brief leaves open (asked 2026-11-10)

1. **New roles** (answered: not yet; the Super Admin does it all for now). The brief's Kitchen Manager, Chef / Kitchen Staff, Delivery Manager and Delivery
   Partner change the role model. Proposal: two new `users.role` values, `kitchen` and `rider`, plus
   a `kitchen_staff` link table with a `kind` (manager, chef, staff) and a `delivery_staff` kind
   (manager, partner), set up by the Super Admin by sign-in number (as gym Staff are, with invites
   for numbers that have never signed in). Each gets its own area in the same app (`app/kitchen/`,
   `app/rider/`), as the gym portal is.
2. **Money.** Still a test payment for orders and subscriptions until PhonePe is set up. Refunds are
   recorded decisions (amount, reason, who) with no money moving.
3. **Rider location.** The rider's phone sends its location only while the rider app is open with a
   delivery underway (foreground, every ~30 s). No background tracking. Members see the step and an
   ETA, not a live map.
4. **Desktop.** No separate web dashboard: the Super Admin screens get a wider two-column layout on
   tablets and the web build. Reports export to Excel through the existing `gym/xlsx.js`.

## 3. Phases

Each phase ships with server rules (pure, unit-tested), routes behind `requireUser` + role checks,
per-user limits, audit, e2e tests on `justfit_test`, and the client screens.

| # | Phase | Migration | Main pieces |
| --- | --- | --- | --- |
| 1 | Kitchens and Super Admin dashboard | `kitchens`, `kitchen_pincodes`, `kitchen_hours`, `kitchen_staff`, roles | Kitchen registration (all brief fields, status Active / Inactive / Temporarily closed / Maintenance), kitchen page, staff by phone, dashboard with order, kitchen, delivery and subscription counts, date and kitchen filters |
| 2 | Menu per kitchen and inventory | `kitchen_meals` (availability per kitchen), `ingredients`, `kitchen_stock`, `stock_moves` (purchase, use, waste, transfer), `meal_recipes` | Meal prep time, low-calorie tag, Egg diet (exists as eggetarian), duplicate meal; inventory dashboard, alerts for low stock and expiry; a meal is unavailable where its kitchen can't make it |
| 3 | Orders through the kitchen | `orders` gains `kitchen_id`, the brief's steps, `order_events` (timeline), slot capacity, holidays | Automatic kitchen assignment (pincode → hours → status → meal availability → stock → workload → distance), manual override, accept / reject, kitchen operations screen with timers, stock consumed on Preparation started (override with a reason) |
| 4 | Delivery | `delivery_partners`, `deliveries`, `rider_locations` (latest only) | Rider registration, availability, capacity, auto / manual assignment, rider app with accept → at kitchen → picked up → out for delivery → at customer → delivered, failure reasons and resolution, proof photo |
| 5 | Meal subscriptions | `meal_plans`, `meal_plan_lengths` (7 / 28 / 90 days), `meal_subscriptions`, `subscription_days` | The user's three screens: Order Meals / Meal Subscription switch, My Subscription card (meals used, Pause, Change Plan, Delivery, Manage), Explore plans, Plan Details with lengths and savings; daily scheduler creates kitchen orders; a meal counts as used only when delivered |
| 6 | Customers, issues and reports | `support_issues`, `issue_events`, `refunds` | Customer page, issues with evidence photo and assignment, refund decisions with audit, business / kitchen / delivery / subscription reports with Excel export |
| 7 | End to end | none | The brief's whole workflow and its test list (several kitchens and riders, stock shortage, closure, rider unavailable, failed delivery, pause / resume, renewal, duplicates, network failures) |

Existing orders stay valid: `placed` becomes New, `preparing` Preparing, and orders placed before
phase 3 have no kitchen.
