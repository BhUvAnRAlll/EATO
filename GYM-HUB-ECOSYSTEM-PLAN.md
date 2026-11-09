# Gym Hub ecosystem: current state, gaps and build plan

Written 2026-11-09 against the "JustFit – Complete Gym Hub Ecosystem" brief. Nothing in this file is
built yet; each phase below needs its own approval (and, where marked, a migration run by hand).

## Progress

The user answered on 2026-11-09 that the brief's flow overrides earlier decisions: gyms register
themselves and the Super Admin approves them, the gym roles are the brief's six, notifications follow
section 9.

| Step | State |
| --- | --- |
| Gym registration and approval (G1, G2; built as the first phase) | **Built** 2026-11-10: registration in the member app, Super Admin review with reasons and history, Discover shows approved + published only, suspension closes the portal and check-ins. Migration `2026-12-27-gym-registration.sql` to run by hand. Not yet: PDF picking on the phone (needs `expo-document-picker`, your approval), notifications of each step (phase 7), G3 sensitive-change approval |
| Live crowd and best time to visit (G4, G5) | **Built** 2026-11-10: live estimate and forecast on the member's membership page and the gym's Attendance, Crowd settings. Migration `2026-12-29-gym-crowd.sql` to run by hand |
| Membership states and pause policy (G6, G7) | **Built** 2026-11-10: suspend / cancel / reactivate with reasons, no check-in or pause while inactive, per-branch pause limits, rejection reasons required. Migration `2027-01-01-gym-membership-standing.sql` to run by hand |
| Attendance corrections and streaks (G8) | **Built** 2026-11-10: add a missed visit or correct times with a required reason, corrections history, member streak and weekly visits. Migration `2027-01-02-gym-attendance-corrections.sql` |
| Gym roles (G9) | **Built** 2026-11-10: Gym Owner, Gym Admin, Manager, Receptionist, Attendance Staff, Trainer as permission presets; invites keep their role. Migration `2027-01-03-gym-role-presets.sql` |
| Notifications (G10) | **Built** 2026-11-10: in-app inbox for members, gym teams and admins, per-category preferences, deduped, daily ending/ended round. No push (needs a push service decision). Migration `2027-01-04-notifications.sql` |
| Super Admin dashboard, staff, suspension, ownership (G11, G12, G15) | **Built** 2026-11-10: gym analytics with charts and cities, all-staff directory, account suspension (sessions revoked, sign-in refused), audited ownership transfer. Migration `2027-01-07-account-suspensions.sql` |
| Complaints and platform settings (G13, G14) | **Built** 2026-11-10: members report gyms; admins assign, note, resolve with history; registration on/off, required documents, default pause limits and crowd levels. Migration `2027-01-20-complaints-and-settings.sql` |
| Discover and plan extras (part of G16-G18) | **Built** 2026-11-10: featured gyms first with a badge, Has trainers filter, trainer counts on cards, duplicate a plan (starts inactive). Migration `2027-01-21-featured-gyms.sql` |
| Still to build | Plan terms and eligibility, facility images, a rating filter (needs the uncommitted reviews work), gym type, report exports, push notifications (needs a decision), PDF picking (needs `expo-document-picker` approval) |

## 1. What exists today

| Brief area | Already built | Where |
| --- | --- | --- |
| Member Gym Hub home | Two tabs: Discover Gyms and My Memberships; Check in or out button | `app/(user)/gym-hub/index.tsx` |
| My Memberships | A card per membership on the account's verified phone, any gym: badge, plan, dates, progress, dues | `gym/memberHub.js` |
| One membership | Plan, renewal (front desk), attendance stats + month calendar + visits, pauses, payments; scoped to that gym | `gym-hub/[id].tsx` |
| Explore gyms | Search, Near me (rounded location, never stored), filters (sort, price cap, facilities), 20 a page | `components/gymHub/DiscoverGyms.tsx`, `gym/discover.js` |
| Gym details | Photos, logo, open now, call, directions, about, facilities, hours, plans with benefits and Best value, PT, trainers, address | `GymPageView.tsx` |
| Reviews | Members (current or past) of that branch only, 1-5 stars, gym replies or hides words | **uncommitted in the working tree** (phase 4) |
| Asking to join | Plan or PT enquiry into the gym's Enquiries; no payment | `gym/joinRequests.js` |
| Attendance | QR + GPS (fresh, precise, not mocked, inside the radius), one open visit, duration worked out, open visits closed as `no_checkout` at India midnight, staff manual check-in/out, history with filters, Excel export | `gym/attendance.js` |
| Busy hours | Tomorrow's expected check-ins per hour from 4 same weekdays; "not enough data" when < 2 weeks | `predictionRules.busyHours` |
| Inside now | Count of open visits (gym side only) | Attendance dashboard |
| Pauses | Member request (1-90 days, reason), staff approve / reject with note and `decided_by`, staff pause, expiry extended, check-in refused while paused, one open pause | `gym/pauses.js` |
| Gym portal | Dashboard, members (paged, filters, photo, Member ID), add / edit / renew / PT / dues, enquiries with scoring, catalogue (plans: benefits, best value, active / inactive / archived, order), expenses, invoices, SMS, templates, predictions | `app/gym/` |
| Gym profile | Draft → preview → publish; photos (8), facilities (+10 custom), hours, closures, contacts, per-section visibility | `app/gym/profile/` |
| Trainers | Trainer logins with a profile: photo, skills, years, certifications, bio, availability, shown / hidden | `gym/trainerProfiles.js` |
| Staff and permissions | Owner, Staff (`gym_admin`), Trainer (`trainer`); per-Staff options per area, checked server-side on every route; branches per person | `gym/staffRules.js` |
| Audit | Activity log of every gym-portal write (owner reads it); `admin_audit_log` for Super Admin | `gym/activity.js` |
| Super Admin gyms | List, create a gym + branches, edit, SMS credits, link / unlink gym admins | `admin/gyms.js`, `app/admin/gyms/` |

## 2. Gaps against the brief

| # | Gap | Size | Needs |
| --- | --- | --- | --- |
| G1 | **Gym approval status** (draft, submitted, pending review, approved, rejected, suspended) on the gym; Discover shows only approved **and** published | M | migration; existing gyms set to approved so nothing disappears |
| G2 | **Gym self-registration** (business, contact, location, documents) and the Super Admin review queue (approve, reject with reason, request documents / changes, suspend with reason, reactivate) | L | migration; **private document uploads** (stored on the server's disk, read only by Super Admin and that gym's owner) |
| G3 | **Sensitive profile changes needing approval** (e.g. the gym name) | M | which fields count as sensitive is your call |
| G4 | **Live crowd** on the member's membership page: open visits now, capacity, %, Low / Moderate / Busy / Very busy, last updated; clearly separate "live" from "forecast" (today's quietest / busiest, best time tomorrow, hourly graph, weekly heatmap); unavailable state without capacity or data | M | migration (`capacity`, thresholds, average stay on `gyms`); reuses attendance + busy-hours rules |
| G5 | **Gym crowd settings** screen (capacity, thresholds, average stay) | S | with G4 |
| G6 | **Member statuses** Suspended and Cancelled set by the gym, refused at check-in; Pending / Rejected shown from join requests | M | migration on `gym_members` |
| G7 | **Pause policy** per gym (max pauses, max days a year), "remaining eligibility", rejection reason **required** | S | migration |
| G8 | **Attendance corrections**: edit times / add a missed visit with a mandatory reason, correction history; streak and weekly visits on the member side | M | migration (corrections table) |
| G9 | **Gym roles** Manager, Receptionist, Attendance Staff | S | proposal: presets over today's per-option permissions (no new `users.role` values) |
| G10 | **Notifications**: the member's Notifications screen is a placeholder; no push server | L | migration (an in-app inbox table); push is a separate decision |
| G11 | **Super Admin dashboard and analytics** for gyms (counts by status, members, memberships, attendance, growth, by city) and report exports | M | none beyond G1 |
| G12 | **Super Admin members / staff views** across gyms; **account suspension** (no suspended state on `users` today) | M | migration; auth must refuse a suspended account |
| G13 | **Complaints / reported gyms**: report a gym, assign, notes, resolve, history | M | migration |
| G14 | **Platform settings** (default facilities, thresholds, pause policy, document requirements) | M | migration |
| G15 | **Ownership transfer** (audited) | S | none |
| G16 | Discover extras: filter by rating, trainers, gym type; featured gyms; recommendations | S-M | "gym type" needs a column; featured needs a Super Admin switch |
| G17 | Plan extras: duplicate a plan, terms, eligibility, access restrictions | S | migration for the text fields |
| G18 | Facility images and order | S | migration |

## 3. Where the brief conflicts with decisions already made

These need your answer before the affected phase; I won't override them silently.

1. **Who creates gyms.** Today only the Super Admin creates a gym and links its admin. The brief wants gyms to register themselves and wait for approval.
2. **Roles.** Today there are Owner, Staff (permissions per person) and Trainer. Making Manager, Receptionist and Attendance Staff into presets of the existing options keeps one tested permission system. Making them real roles means changing the role model, which needs your approval.
3. **Payments.** There are none, and the brief agrees, so plans stay display-only and joining stays an enquiry.
4. **Notifications.** No push server exists, and the project uses no paid Expo services. My proposal is an in-app inbox plus the SMS already built. Real push (FCM / APNs directly) would be a separate decision.
5. **"Never combine gyms" and "Gym A never sees Gym B".** Every query is already scoped this way, and each new route will get tests that try to cross between gyms.
6. **Documents.** Uploaded documents would be the first private files that aren't photos. They need their own folder and must never appear in any member route.

## 4. Proposed order (one phase at a time, each tested and reported before the next)

| Phase | Contents | Migration |
| --- | --- | --- |
| 0 | Commit the reviews phase that is already in the working tree (tests first) | already written |
| 1 | **Live crowd + best time to visit** (G4, G5): the most visible member feature, built on existing data | yes |
| 2 | **Gym approval status + Super Admin review queue** (G1, part of G2): approve / reject / suspend / reactivate with reasons, Discover gated, audited | yes |
| 3 | **Gym self-registration with documents** (rest of G2, G3) | yes |
| 4 | **Membership states + pause policy** (G6, G7) | yes |
| 5 | **Attendance corrections + member streaks** (G8) | yes |
| 6 | **Role presets** (G9) | no |
| 7 | **Notifications inbox** (G10) | yes |
| 8 | **Super Admin dashboard, members / staff, account suspension, reports** (G11, G12, G15) | yes |
| 9 | **Complaints** (G13) and **platform settings** (G14) | yes |
| 10 | Discover and plan extras (G16-G18) | small |
| 11 | Cross-portal end-to-end pass: phones at 320 / 390 / 430, keyboard, back, offline, slow network, double taps | no |

Each phase follows the repository's rules: server checks only (never a hidden button), parameterised
queries, per-user limits, audit rows, unit + e2e + UI tests on `justfit_test`, the 27-point security
pass, and a report listing what is done, what is pending and what is blocked.
