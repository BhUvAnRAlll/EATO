# AGENTS.md

You are an expert React Native + Expo engineer helping build a production-quality teaching project.

You write clean, simple, maintainable code. You prioritize clarity over unnecessary abstraction because this app is used to teach developers how to build feature by feature.

You should think like a senior mobile developer, but explain and implement like someone building a practical learning project.

---

## Brand (renamed 2026-10-26, spelling and end-to-end rename 2026-10-30)

The app was EATO, became JustFit on 2026-10-26, and is spelled **justFit** (lowercase j) since
2026-10-30, everywhere; JUSTFIT in capitals stays (the logo word, the `JUSTFIT-OUT-` code).
Logo: the JF mark with the JUSTFIT word, red and black. What changed and what deliberately did not:

- Everything users see says justFit: screen text, server messages, share texts, the app name, icon,
  adaptive icon, splash, favicon and the in-app logo (`assets/images/justfit-logo.png`, shown by
  `BrandWordmark`). Expo identity: slug `justfit`, scheme `justfit` (with `eato` still registered so
  older links open the app), iOS bundle id `com.bhuvii3.justfit`. A new
  development build is needed.
- MySQL (renamed 2026-10-30): databases `justfit` and `justfit_test`, accounts `justfit_app` and
  `justfit_test`, demo accounts at `@demo.justfit.test`; the folders are `JustFit_client` and
  `JustFit_server`. The pass-signing label is `justfit-member-pass` (part of the key).

## Project Overview

We are building **justFit**, a fitness meal delivery and tracking mobile app for India, using Expo.

The repository has two apps side by side:

- `JustFit_client/` — the Expo app (this file's rules apply to it)
- `JustFit_server/` — a small Node.js + Express server in front of a MySQL database

justFit combines healthy meal delivery (single orders and subscriptions) with nutrition and training tracking. The user's fitness goal drives meal recommendations, and every meal they order is logged to their nutrition diary automatically.

Main areas of the app:

- **Onboarding**: welcome → sign up → setup: personal details (name, date of birth for the age, height, gender, weight, phone) → body composition (optional: Scan Body, instructions, two photos; no typed body fat %) → goal → activity and health conditions → food → lifestyle → calculated targets. No pincode step yet
- **Home**: calorie ring, today's deliveries, streak, XP
- **Food**: menu, meal detail, cart, checkout, order success, live order tracking
- **Subscribe**: plan picker, subscription builder, review, my subscription (skip days, wallet credit)
- **Nutrition**: food diary, water and supplement tracking, add food, barcode scan, photo scan, weight log
- **Training**: workout plans, active workout, summary, exercise library, cardio, progress charts. Since 2026-11-01 the Workout hub is the Workout tab (`app/(user)/(tabs)/workout.tsx`, route `/workout`), in the slot Community had; its day, session, preferences and rebuild screens stay under `app/(user)/workout/`
- **AI Coach**: intake (9 steps) → the Coach tab (hero, today's plan as a timeline of meals to log and today's workout, Week and Insights tabs) and the coach chat are built; daily follow-ups, weekly check-ins, Insights and the video coach are planned
- **Profile**: orders, wallet, coupons, addresses, goals, achievements, notifications, settings, Pro

This is primarily a learning project. The goal is to teach developers how to build a modern AI-powered Expo app feature by feature.

---

## Tech Stack

What is in use today:

- Expo (SDK 58) + React Native + TypeScript
- Expo Router (screens in `src/app/`; the app has no server-side API routes)
- NativeWind / Tailwind CSS
- Zustand for client state (the profile setup store)
- Phone sign-in (a 10-digit Indian mobile number and a 6-digit code by SMS), built in this repo:
  the Express server sends and checks the codes and keeps the sessions and roles in MySQL; the
  app keeps its session token in `expo-secure-store`. SMS goes through Fast2SMS (server-side,
  `JustFit_server/auth/sms.js`). Clerk was removed on 2026-10-29; see "Sign-in Rules" below
- OpenAI, server-side only: reading body composition reports (`JustFit_server/bodyComposition/extract.js`),
  Scan Food (`JustFit_server/macro/foodScan.js`) and the AI Coach's meals, note and chat (`JustFit_server/coach/`).
  `OPENAI_API_KEY` is a server secret in
  `JustFit_server/.env` only, never in the app's `.env` or an `EXPO_PUBLIC_*` variable
- Node.js + Express server (`JustFit_server/`) with a MySQL database (`mysql2`): every backend concern lives here

Planned, not yet wired in:

- Stream / GetStream for video and real-time communication
- Stream Vision Agents for the AI video coach

Do not introduce new major libraries unless there is a strong reason.

### Where things run

| Concern | Where | Why |
| --- | --- | --- |
| Sign in / out (one flow for new and returning members: mobile number → texted code) | `POST /api/auth/request-otp`, `POST /api/auth/verify-otp`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/logout-all` on the Express server (`JustFit_server/auth/`); the app's screens are `app/(auth)/sign-in.tsx` and `sign-up.tsx`, its session `store/auth.ts` | No passwords exist; codes and session tokens are stored only as hashes; the SMS key never leaves the server |
| Roles (`user`, `admin`, `gym_admin`, `trainer`) | MySQL `users.role`, read on every request; new accounts are always `user`; `npm run set-role -- <phone> <role>` in `JustFit_server` changes it (`gym_admin` needs migration `2026-11-18-gym-admin-role.sql`, `trainer` `2026-11-29-gym-staff-logins.sql`). Since 2026-11-05 a gym's admin also changes it through Staff / Admin Login: adding someone as Staff makes them `gym_admin`, as Trainer `trainer`; leaving their last branch makes them `user` (`gym/staff.js`, see the gym portal section) | The app can't promote itself; `requireAdmin` admits only `admin`; a gym admin can never give or take `admin` |
| Reading an uploaded body composition report (removed from the app's setup on 2026-10-25; the server route is still there, unused) | `POST /api/body-composition` on the Express server → OpenAI (`JustFit_server/bodyComposition/`) | Keeps `OPENAI_API_KEY` off the device; the file is never stored |
| Estimating body fat % from a front and a side photo (optional Body composition step `setup/body-composition.tsx`: Scan Body → `setup/scan-guide.tsx`: the instruction video only (`assets/videos/scan-instructions.mp4` via `constants/videos.ts`, played with `expo-video`, added 2026-10-25; autoplays on a loop with no controls, with sound on phones and muted on the web) and the privacy note. The written tips and pose drawings were removed at the user's request → `setup/body-scan.tsx` → the body composition report `setup/scan-report.tsx` (animated graphs in `components/setup/ReportGraphs.tsx` and `SegmentalChart.tsx`; graph ranges in `lib/bodyScanRules.ts`). The report lives in the setup store only (not saved yet), shows no model or technical wording, offers no download, and allows screenshots and screen recordings (the block added earlier on 2026-10-25 was removed at the user's request the same day; `lib/screenProtection.ts` and `expo-screen-capture` stay for reuse, unused. On iOS that block moves the whole app window into a secure layer, so never switch it on over the photo picker or mid-transition). There is no typed body fat field. After setup, Profile › Body composition › Scan Body runs the same screens with `?from=profile` (`lib/profileScan.ts`, pure and unit-tested): the report's Save to my profile shows the change, then on confirm saves through `POST /api/profile` with the targets recalculated; a user-entered target is kept) | `POST /api/body-composition/scan` on the Express server → the Forma scan server at `FORMA_SCAN_URL` (`JustFit_server/bodyComposition/scan.js`; a separate process, `Forma_BodyFat/forma_server.py`) | Photos pass through in memory and are never stored or logged; the answer is an estimate the user accepts as their body fat % (saved like a typed value, no `'scan'` report source yet). Forma's model is not validated against DEXA or InBody and the screen says so |
| Scan food in the Macro tab (Log food › Scan Food, `app/(user)/macro/scan.tsx`, added 2026-10-25): one photo plus an optional note → an editable estimate per food (kcal, protein, carbs, fat) → logged through `POST /api/macro/meals` as a `manual` meal (the `source` ENUM has no `scan` value) | `POST /api/macro/scan` on the Express server → OpenAI (`JustFit_server/macro/foodScan.js`, model from `ai/models.js` (`AI_MODEL_FOOD_SCAN`, default gpt-4.1-mini); photos only, upload rate budget; tests use `AI_PROVIDER=fake`) | Keeps `OPENAI_API_KEY` off the device; the photo is never stored or logged and scanning writes nothing |
| AI Coach (Coach tab, added 2026-10-26/27): the intake (`app/(user)/coach/intake/*`, 9 steps, saved once at the end with the "not medical advice" tick) and the plan. Make my plan → the workout from the existing engine (`workout/plans.js` `planFromCoach`: the intake's goal, level and days saved as the member's workout answers; the library narrowed by the main spot's equipment, high-risk lifts left out for joints or conditions; days trimmed to the session length, see `coach/planRules.js`), and one day of five Indian meals from OpenAI scaled to the member's `nutrition_targets`. Each meal logs once a day to Macro (`source = 'plan'`, `plan_log_key`) | `/api/coach/intake` and `/api/coach/plan` on the Express server (`JustFit_server/coach/`; tables `coach_profiles`, `coach_plans`, `coach_plan_meals`, `coach_plan_meal_items`, migrations `2026-10-30-coach-intake.sql` and `2026-10-31-coach-plans.sql`; making a plan is limited to 5 an hour per member; tests use `AI_PROVIDER=fake`) | Keeps `OPENAI_API_KEY` off the device; the exercises stay deterministic and from the library, and the model only writes the meals and the coach's note, which the server cleans and scales |
| Coach chat (2026-10-30): the Coach tab's ask box and quick questions open `app/(user)/coach/chat.tsx`; the conversation is saved on the server (chat history added 2026-11-02): the chat reads it once per app session (`store/coachChat.ts`, loading / empty / error states; cleared on sign-out and when the coach changes) and sends only the new message with a `clientId` (a UUID per send, so a retry is answered and saved once). A message the coach didn't answer is marked failed, stays on screen only (never saved, gone after a restart) and is sent again, under the same `clientId`, when tapped. Apply cards show only on replies from today. The tab's Change button (`components/coach/ChangeCoachSheet.tsx`) switches coach and style through `PUT /api/coach/intake/coach`, keeping every other answer; coach photos are face crops in `assets/images/coach-<id>-face.jpg`, drawn by `CoachAvatar` (a coach without one shows their initial). **Voice input (2026-11-06, approved):** the mic beside Send (`components/coach/MicButton.tsx`, `lib/useVoiceInput.ts`, pure rules in `lib/voiceInputRules.ts`) uses the phone's own recogniser through `expo-speech-recognition` (Apple's on iOS, Google's on Android, the browser's on the web; a native library, so a dev rebuild; plugin and permission texts in `app.json`): tap to listen, tap to stop; the words heard follow whatever was typed, in the box, never sent by themselves; English, Hindi and Kannada chips while listening (`store/voiceInput.ts` keeps the choice for the session only; a language the phone doesn't list is hidden, `getSupportedLocales`); errors are one line (`voiceErrorMessage`, Open Settings for a refused permission); leaving the screen or the app stops the mic. On the phone path nothing is recorded, uploaded, stored or paid for. **Server transcription (2026-11-06, approved):** for a language the phone's recogniser doesn't list (`voiceEngineFor`: an iPhone for Kannada), the mic records a clip instead (`lib/useVoiceClip.ts`, `expo-audio`, 64 kbps m4a, at most 30 s, read as base64 and deleted) and `coachApi.voice` posts it to `POST /api/coach/voice`; the row says "sent to justFit to transcribe" and the mic shows a spinner while the server works. The coach replies in the language of the member's latest message (`chatRules.js`). **Bold main points (2026-11-06):** every reply wraps its one to three main points in `**`, drawn semibold by `RevealText`; when the model marks none, `cleanReply` bolds the first sentence, so no reply arrives all in one weight | `GET /api/coach/chat` (the current conversation, 120 an hour) and `POST /api/coach/chat` (`JustFit_server/coach/chat.js`, saved history in `chatHistory.js`, pure rules in `chatRules.js`; tables `coach_chats` and `coach_chat_messages`, migration `2026-11-10-coach-chat-history.sql`): the server reads the saved conversation (the newest 20 lines, the model sees the newest 10), adds the member's intake, targets, today's Macro totals and plan, asks OpenAI for a short reply in the coach's style, and saves the message and reply together; 30 messages an hour per member, 16 kb body; tests use `AI_PROVIDER=fake`. `POST /api/coach/voice` (`coach/voice.js`, pure rules in `coach/voiceRules.js`): `{ data, mediaType, language }`, the clip checked by its bytes (m4a, wav, webm, mp3; 1 MB; the language one of en-IN, hi-IN, kn-IN), 20 an hour per member, the AI limits, then OpenAI's `gpt-4o-mini-transcribe` (feature `coach_voice`, about ₹0.25 a minute, recorded on AI Usage; migration `2026-12-03-coach-voice.sql` adds the ENUM value and the price row, before it the call is refused as unpriced) → `{ text }`; the clip is held in memory only and nothing is written | Each message is deleted 7 days after it was written (by `created_at`, timezone-proof; hidden from every read at once, deleted at startup, hourly and when the member opens the chat); a new coach starts a new conversation and the old one is never shown again; the text is never logged; identity only from the session; the model is told to give fitness guidance, not medical advice |
| AI usage and cost (Admin › Profile › AI Usage, 2026-10-30): `app/admin/profile.tsx` (the admin's profile and Sign out, opened from the Overview's header) → `app/admin/ai-usage/index.tsx` (all-time cards, the monthly budget, a day / 7 days / 30 days period with charts, by-feature and by-model breakdowns, one section per AI area), `history.tsx` (every call, search, filters, sort, 25 a page) and `budget.tsx` (the limit, alerts at 50 / 75 / 90 / 100 % and on a spike, acknowledging). Labels in `data/aiUsage.ts`, calls in `lib/aiUsage.ts`, charts are plain views (`components/admin/BarChart.tsx`) | `/api/admin/portal/ai-usage/*` (`JustFit_server/admin/aiUsage.js`, pure rules in `ai/rules.js`). Every AI module records each call through `ai/usage.tracker` (`ai/usage.js`): tables `ai_usage`, `ai_model_prices`, `ai_budget`, `ai_budget_alerts` (migration `2026-11-03-ai-usage.sql`); the recorder never throws and does nothing until the migration has run. Costs are in rupees: the model's dollar price (`ai_model_prices`, as OpenAI quotes it) at the exchange rate in `ai_budget.usd_to_inr` (editable on the budget screen, default ₹84) when the call is recorded | Admin-only on the server; a row holds who, feature, model, tokens, cost and outcome, never a prompt, photo or reply. Reaching the budget alerts and, unless `AI_BUDGET_HARD_STOP=off`, pauses every AI call for the rest of the month with a friendly message (`ai/limits.js`, 2026-10-31) |
| Profile and nutrition targets from setup | MySQL (`users`, `profiles`, `nutrition_targets`, `body_composition_reports`) via `POST /api/profile` and `GET /api/profile` on the Express server; `profiles.profile_complete` (returned by `/api/auth/me`) decides where the app opens | Server-verified identity, one transaction per save, the app's own calculator re-checks every record before it is stored |
| App data (meals, orders, diary, weigh-ins) | MySQL via the Express server (`JustFit_server/`) | Shared, queryable data that outlives one device |

Every Express route except the health check and the two sign-in routes verifies the caller's session token with `requireUser` (`JustFit_server/auth.js`) before doing anything. The sign-in routes are budgeted per IP address and per phone number instead.

### Gym Hub, member side (2026-11-09, phase 1 of 4)

Profile's Gym membership and Gym attendance rows became one **Gym Hub** row (`/gym-hub`; a
trainer sees "Gym check-in" instead, `/attendance`, and is kept out of `/gym-hub` and `/membership`).
`app/(user)/gym-hub/index.tsx`: Check in or out (opens the QR scanner, `/attendance`, unchanged),
then My Memberships: a card per membership on the account's verified number, any gym (badge, plan,
dates with a progress bar, dues). `gym-hub/[id].tsx`: the plan, Renewal (at the front desk),
Attendance (visit-day stats: this month, last 7 days, all, average stay; a month calendar with
‹ › back 24 months; the month's visits with India-time check-in and check-out), Pauses ("Paused N
times · D days added", the open request with Cancel, Pause Membership, the history) and Payments.
Words and the calendar grid in `lib/gymHubText.ts` (pure, unit-tested). Server:
`GET /api/membership/:memberId?month=YYYY-MM` (`gym/memberHub.js`, rules `gym/memberHubRules.js`,
`pauses.oneMembership`): matched by the account's phone like every `/api/membership` route; every
query is scoped to that gym_members row and its gym; read only, no migration. `/membership` now
redirects to `/gym-hub`; `/membership/pause`, `/attendance` and `justfit://attendance` work as before.
The user's decisions for the next phases: no payment in the app (picking a plan sends an enquiry
to the gym's Enquiries), Discover lists every gym; phase 2 gym public profile (migration), 3
Discover and Gym Details, 4 the plan enquiry. Tests: `__tests__/gym-member-hub-rules.test.js`,
`e2e/gym-member-hub.e2e.test.js`, the client's `lib/__tests__/gymHubText.test.ts`.

### Delivery addresses (2026-11-09)

Profile › Delivery addresses (and Home's "Deliver to · <pincode>" pill) is the member's address
book. The user's choices: the phone's own geocoder for search (no Google Places key, no cost),
deliveries decided by a pincode list, the selected address kept on the server.

- **Screens** (`app/(user)/addresses/`): `index.tsx` Saved Addresses (cards, the selected one
  outlined in red; tap or Deliver here selects, Edit, Delete asked once more; `?pick=1` goes back
  once one is chosen; Add New Address pinned at the bottom), `location.tsx` Select Delivery
  Location (`components/AddressMap.tsx`: react-native-maps with the pin fixed in the middle and the
  map moving under it, Google on both phones with the existing keys, a card on the web build;
  search and "Use current location" through `lib/deliveryLocation.ts` (expo-location: permission
  only when tapped; iOS points to Settings, Android shows its own "turn on location" prompt; a 15 s
  timeout falls back to the last known fix); the place under the pin is named by the phone's
  `reverseGeocodeAsync` (`addressRules.placeFromGeocode`, pure and unit-tested) with whether justFit
  delivers there; saved addresses listed; Confirm Location pinned; `?then=back&lat=&lng=` is the
  form's Change), `form.tsx` Add / Edit (`?id=`): receiver name and +91 mobile (pre-filled from the
  account), house/flat, apartment/street/area, optional landmark, city, pincode (checked live),
  Home / Work / Other, optional instructions, "Deliver to this address"; Save pinned above the
  keyboard. The picked place passes between them in `store/addressDraft.ts` (session only).
- **Server** `JustFit_server/addresses/` (`rules.js` pure, `service.js`, `routes.js`), mounted at
  `/api/addresses` behind `requireUser` and a per-user limit: `GET /` (`addresses`, `selectedId`,
  `max`), `POST /`, `PUT /:id` (every field), `DELETE /:id`, `POST /:id/default`,
  `GET /serviceable?pincode=`; changes 60 an hour (`ADDRESS_CHANGES_PER_HOUR`). Every query is scoped
  to `req.userId`; another member's id answers 404. The coordinates must be inside India and never
  replace the typed address. One selected address per member (`is_default`, a unique key on the
  generated `default_user_id`); the first is selected, deleting it selects the newest left; at most
  20. `service.deliverableAddress` is the check checkout must call (409 outside the list).
- **Tables** `user_addresses` and `delivery_pincodes` (migration
  `2026-12-16-delivery-addresses.sql`; before it the routes answer 503 naming it and Home's pill
  stays hidden). Pincodes are managed with `npm run delivery-pincode -- list | add <pincode> [area] |
  off <pincode>` in `JustFit_server` (no admin screen yet).
- **Not built:** checkout (none exists), Google Places autocomplete, an admin screen for pincodes,
  per-address delivery slots. Tests: `__tests__/address-rules.test.js`, `e2e/addresses.e2e.test.js`,
  the client's `lib/__tests__/addressRules.test.ts`.

### Gym admin portal (2026-11-04)

A portal for gym staff, separate from the removed gym owner portal and from the Super Admin.

- **Who:** role `gym_admin`, linked to one gym by a justFit admin (Super Admin › Gyms › a gym ›
  Link a gym admin, by sign-in number; that link is `gym_staff.kind = 'owner'`, needs the role
  from `npm run set-role` and never changes it), plus the Staff that gym admin adds (below). The
  app opens `app/gym/` (guarded in the root layout; `homeRouteFor` → `/gym`). The Super Admin's
  gym page lists and unlinks gym admins (owners) only.
- **Staff / Admin Login (2026-11-05, the user's plan):** the gym admin (owner only; Staff get a 403
  and don't see it) opens ☰ › Staff / Admin Login or + › Add Staff / Admin Login (`/gym/staff`,
  `?add=1` opens the sheet) and adds people by sign-in number as **Staff** (the portal, role
  `gym_admin`, `kind 'staff'`, everything but the team) or **Trainer** (the member app, role
  `trainer`, `kind 'trainer'`; see Trainers below). A number with an account is linked and its role changed in one
  transaction; one that has never signed in is saved in `gym_staff_invites` and joins when that
  number verifies a code (`applyInvites` inside `verifyOtp`'s transaction; only the proved
  number). Refused (409): a Super Admin, someone at another gym, someone already on the team or
  invited, Staff as Trainer or the other way round (one kind per account). Removing (⋯ › Remove,
  confirm) never applies to yourself or the owner; from the last branch the role goes back to
  `user` and a trainer's PT members lose `pt_trainer_id`. Lists show masked numbers. Server
  `gym/staffRules.js` (pure), `gym/staff.js`, routes `GET|POST /api/gym/staff`,
  `DELETE /api/gym/staff/:userId`, `DELETE /api/gym/staff/invites/:id` (30 changes an hour);
  audited `gym.staff_add`, `gym.staff_invite`, `gym.staff_invite_cancel`, `gym.staff_remove`,
  `gym.staff_join`. `staffGym` only counts owner and staff links and returns `kind`
  (`gym.access`: owner or staff; Home's pill says ADMIN or STAFF). The app re-checks
  `/api/auth/me` when it comes to the front and after any 403 (`useAuthStore.recheck`,
  `onAccessDenied` in `lib/api.ts`), so a changed role switches the app without a restart.
  App: `app/gym/staff.tsx`, `components/gym/AddStaffSheet.tsx`. Since 2026-11-07 the screen's Add is
  the round + (`GymScreen`'s `floating`, as on Members) and the sheet has **Branch** chips: the open
  branch pre-selected plus every other branch of this gym the caller is the gym admin of (`branches`
  on `GET /api/gym/staff`); `POST /api/gym/staff` takes an optional `branchId`, checked in
  `staff.ownedBranch` (another gym's branch or one the caller only works at answers 404), and the
  answer's `branch` names where they were added. The hourly team-change budget is
  `GYM_STAFF_CHANGES_PER_HOUR` (default 30; the test server sets 1000). **Branches (2026-11-09, the user's
  request):** a team member's ⋯ › Branches (`components/gym/AssignBranchesSheet.tsx`) ticks every
  outlet they work at, out of the branches the gym admin manages (at least one; off every branch is
  Remove; a gym with one outlet offers Add Outlet). `PUT /api/gym/staff/:userId/branches
  { branchIds }` (owner only, the team-change budget, `staffRules.branchesBody` /
  `branchesProblem` / `branchChanges`, `staff.setBranches`): never yourself or a gym admin, only
  someone on the open branch's team, only branches the caller owns (else 404); a branch joined
  copies this branch's `permissions`, a branch left is as Remove there (a trainer's PT members lose
  `pt_trainer_id`); the role never changes; audited `gym.staff_branches`. The team answer carries
  each person's `branchIds` and rows show "Branches: …" when the gym has more than one (Branches need no migration of their own). Staff / Admin Login's migration is
  `2026-11-29-gym-staff-logins.sql` (the `trainer` role, `gym_staff.kind`, `gym_staff_invites`,
  `gym_members.pt_trainer_id`); before it the portal answers 503 naming it.
- **Role & Permission (2026-11-06, the user's request):** the gym admin (owner only) chooses what
  each Staff login can open at a branch: ☰ › Role & Permission (`app/gym/permissions.tsx`; also
  from a Staff row's ⋯ on Staff / Admin Login) lists the Staff with "All areas" / "Members, SMS" /
  "Home only", and tapping one opens `PermissionsSheet`: one switch per area (members, payments,
  enquiries, catalog, attendance, sms, predictions, expenses (added 2026-11-08: Staff still on
  "All areas" get it, Staff with an edited list don't until switched on); labels and what each opens in
  `data/gymDashboard.ts` `STAFF_AREAS`), saved together through
  `PUT /api/gym/staff/:userId/permissions { areas }` (30 an hour, audited `gym.staff_permissions`;
  never your own, never a trainer or the owner). Stored per branch in `gym_staff.permissions`
  (JSON; NULL = every area, so nothing changes until the gym admin edits someone; migration
  `2026-12-01-gym-staff-permissions.sql`, before it the portal answers 503 naming it). The server
  decides: `requireArea` in `gym/routes.js` maps every route under `/api/gym` to its area
  (`staffRules.areaOfPath`, pure) and answers a Staff login without it 403 "Your login doesn't
  include Payments. Ask your gym admin."; the dashboard, branches and the team routes have no
  area. The app only tidies: the dashboard's `gym.areas` goes into `store/gymAccess.ts`
  (`useCan`), and Home's tiles, cards and Wallet link, the ☰ menu, the + sheet, the Manage sections and
  the Wallet / Manage tabs hide what isn't included (nothing is hidden until Home has loaded).
  Tests: `gym-staff-rules.test.js`, `e2e/gym-staff.e2e.test.js` (4b), `ui/gym-permissions.ui.test.js`.
  **Options inside each area (2026-11-08, the user's reference screen):** each area is a tile with
  2-5 options (`staffRules.OPTIONS`, e.g. Members › Member list and pages, Add Member, Edit profile,
  photo and trainer, Renew membership, Pause membership; Payments › Collect payment due, PT,
  Product and service sales, Transactions, Wallet). An option may `need` its area's list (ticked with
  it, dropped without it). `gym_staff.permissions` now holds option ids; an area id saved before
  stands for all its options, NULL for every option (no migration). `requireArea` checks
  `staffRules.optionsOfRequest(method, path)` on every request and refuses a route of an area that
  no option covers (fail closed; `gym-staff-rules.test.js` walks the whole gym router so a new
  route can't go unmapped); a refusal names the option ("Members › Add Member"). `PUT …/permissions`
  takes `{ options }` (or the older `{ areas }`); the team answer carries each person's `options`
  and the `permissionTree` the app draws; the dashboard's `gym.options` feeds `useCan("members.add")`.
  App: the list (`app/gym/permissions/index.tsx`) opens `permissions/[userId].tsx`: info and
  warning banners, search, Expand all / Collapse all, a card per tile with its box and the options
  under it, Save Permissions pinned at the bottom (tick rules in `lib/permissionTree.ts`, pure and
  unit-tested). `PermissionsSheet` is gone.
  **Every screen in the list (2026-11-08, the user's request):** two more tiles, **Home** (Today's
  collection = the revenue card, Today's counts) and **Reminder Templates** (the screen; its wording
  stays readable to every login because Send Reminder and the enquiry cards use it). The dashboard
  carries only what the login may see (`staffRules.dashboardFor`: revenue and stats null without the
  Home options, `recent` empty without Transactions, each Needs attention count null without the
  option of the screen it opens). `GET /catalog` is the one read shared across tiles
  (`staffRules.CROSS_AREA`): Add Member, Renew, PT and Add Service / Sell Product read the price list
  without Plans / Catalogue (never change it or see its images). The app checks the exact option
  everywhere (`useCan("enquiries.edit")`, never just the tile): the ☰ menu, Settings, the + sheet,
  Manage and its tab, Home's cards and rows, the list screens' + and edit, Enquiries' contact log,
  Attendance's QR / settings / Check out / Export, Bulk SMS's Auto Reminders and Manual Send, and
  "Add New Plan / Product / Service". Staff whose list was saved before keep it as it was, so they
  get the new tiles only when ticked (as with Expenses).
- **Trainers and My Clients (2026-11-05, phase 2):** a member's PT is with one of the branch's
  trainers (`gym_members.pt_trainer_id`), picked on the PT form (`TrainerChips`; left out, the
  member keeps their trainer) or in the member's ⋯ › Sales › Change Trainer (`ChangeTrainerSheet`);
  the ⋯ card shows "1 Month PT · Ravi". Server: `GET /api/gym/trainers`,
  `POST /api/gym/members/:id/trainer`, `trainerId` on `POST /members/:id/pt` (only a `kind
  'trainer'` row of this branch, checked in the transaction). A trainer's app (role `trainer`) has
  the tabs Home · Meals · Macro · My Clients (`trainerTabs`; the Coach and Fitness screens and any
  `/coach`, `/workout`, `/fitness` address send them Home, `(user)/_layout.tsx`); Home skips the
  workout cards and Macro the coach tip. My Clients (`(tabs)/clients.tsx`): their clients with PT
  running, then PT that ended in the last 30 days, search by name or ID; a client's page
  (`(user)/clients/[id].tsx`): PT dates, Call / WhatsApp (the phone's apps), the last 10 visits.
  No money anywhere. Server `gym/trainer.js`, `trainerRules.js` (pure), `trainerRoutes.js`
  (`/api/trainer/clients`, `/clients/:id`, `/clients/:id/photo`; trainers only, scoped to
  `pt_trainer_id` = the caller at branches where the caller is a trainer). `refuseTrainers`
  answers a trainer 403 on `/api/coach`, `/api/workout` and `/api/fitness`.
- **Server:** `/api/gym/*` (`JustFit_server/gym/`: `rules.js` pure and unit-tested, `service.js`,
  `routes.js`). `requireGymStaff` reads the role and the gym from the database on every request;
  every query is scoped to that gym. Admin side `/api/admin/portal/gyms*` (`admin/gyms.js`,
  audited as `gym.create`, `gym.edit`, `gym.staff_add`, `gym.staff_remove`); the Overview adds
  gym counts. Tables `gyms`, `gym_staff`, `gym_members`, `gym_payments`, `gym_enquiries`,
  `gym_attendance` (migrations `2026-11-18-gym-admin-role.sql`, `2026-11-19-gym-portal.sql`,
  `2026-11-20-gym-branches.sql`). Branches: `gym_brands` is the gym (Forma), each `gyms` row a
  branch (Tumkur); staff can be linked to several branches of one gym and switch (`/gym/branches`,
  the server keeps the choice in `gym_staff.selected_at`). Since 2026-11-07 (the user's request)
  the gym admin adds branches themselves: Branches › Add branch (and Home's + › Add Outlet,
  `/gym/branches?add=1`) opens `AddBranchSheet` (branch name, then Location: area and city) →
  `POST /api/gym/branches` (owner only, 10 an hour; `rules.branchBody`; `service.addBranch` inserts
  the `gyms` row and the owner's `gym_staff` link in one transaction, refuses a name the gym already
  has with 409, audits `gym.branch_add`; the open branch stays open). `GET /api/gym/branches` carries
  `access` so Staff see no Add button. Branch details (`/gym/details`) edits only the branch's name,
  area and city: the "Your name" field and `adminName` were removed the same day. Payment kinds add `pt`; `sale` shows as
  Product. Members have an optional `dob` for birthdays. Plans / Catalogue (`gym_catalog_items`,
  migration `2026-11-21-gym-catalog.sql`): each branch's membership plans (with months), PT
  packages, services and products with prices; the forms fill the price from it (`CatalogPicks`);
  payment kind `service` added. Adding or editing is the Add Plan bottom sheet (`CatalogSheet`:
  name, Duration in whole months for plans and PT packages, amount, and since 2026-11-07 an optional
  **Image or brochure**: camera or gallery, any shape, `lib/gymPhoto.ts` `pickCatalogImage`,
  uploaded after the item is saved through `PUT|DELETE|GET /api/gym/catalog/:id/image`
  (`gym/catalogImages.js`: JPEG/PNG/WebP from the bytes, 3 MB, 96-6000 px a side, the photos'
  hourly allowance; files in `CATALOG_IMAGE_DIR`, default `uploads/catalog-images`; the row keeps
  only `image_key`, read with the session by this branch's staff; deleting the item deletes the
  file; migration `2026-12-04-catalog-images.sql`, before it the catalogue answers 503 naming it);
  the card shows it as a thumbnail; a PDF brochure is not accepted, only a photo of it), then
  "Please confirm the details" (Edit / Confirm). **Plan lengths are whole months, 1-24, everywhere
  (2026-11-07, the user's request; they were months or 1-365 days before):** the Duration Type chips
  are gone from the catalogue, Add Member, Renewal and PT (`PlanLengthFields` is the one Duration
  field, `lib/gymDates.ts` `PLAN_MAX_MONTHS`), the forms send `duration` alone, and `rules.planLength`
  refuses `unit: "days"` ("Plans are in whole months now") while a left-out or `"months"` unit is
  accepted. No schema change: `gym_members.plan_days` and `gym_catalog_items.duration_unit` stay,
  the server writes `plan_days` NULL and `duration_unit` 'months', and rows saved in days before
  are still read and shown as they were ("15 Days"). A catalogue plan or PT package still in days is
  listed with "set in months to use" (`CatalogList`), left out of the forms' chips (`pickable` in
  `data/gymDashboard.ts`) and opens in the Edit sheet with its Duration empty. The catalogue chips
  on Renewal, PT, Product and Service (`CatalogPicks`, `selected`) highlight the item picked
  (2026-11-07, the user's request) until a field it filled in is edited by hand. Since migration
  `2026-11-24-catalog-stock.sql`, PT packages have a length too (cards show "1 Month"; picking one
  fills the PT period) and products an optional `stock` ("18 in stock"; empty = not counted).
  A member's ⋯ › Sales › Add Service / Sell Product (`MemberSaleSheet`, the GymOps designs):
  payment date, the catalogue's chips, quantity beside In Stock, discount, mode, Amount Payable,
  Due Amount, Amount Collected, Send Invoice. `POST /api/gym/members/:id/sales|services` take only
  the item id: the price is the catalogue's, the member and item are locked in one transaction,
  counted stock is checked (409 when short) and decremented, and what isn't collected is added to
  the member's due (with a due date). + › Product (counter sales) doesn't touch stock.
- **Member IDs (2026-11-04):** every member has `member_code`, made by the server on save from three
  letters of the gym and of the branch and the branch's running number (`FOR-TUM-0001`;
  `gyms.next_member_no`, locked in the admission's transaction; `rules.memberCode`). Never typed,
  never repeated, kept when a name changes; searchable. Members also have an optional `gender`
  (there is no batch: removed at the user's request). Migration `2026-11-22-member-codes.sql`.
- **Home's +** opens the + sheet (`AddSheet`: Add Member, Add Plan, Add Enquiry, Add Expense, Add
  Outlet, Add Staff / Admin Login, Send Bulk SMS, Attendance; Record a payment was
  removed at the user's request: Renewal, Due and PT are on a member's page).
  Add Member is a three-step sheet (`AddMemberSheet`, the user's designs): 1 the profile (the
  previewed Member ID `GET /api/gym/members/next-code`, name, mobile kept to 10 digits, gender);
  2 optional fields (email, height, weight, address, notes, date of birth); 3 Joining Date and Payment Date, Available Plans from the
  catalogue (or Custom, or Add New Plan in a CatalogSheet), Mode, Amount Payable (the plan's
  price; the Admission and Discount amount fields were removed on 2026-11-07 at the user's request,
  the server still accepts them as optional) and Due Amount, Amount Collected, the due date when
  something is owed (`DueByField`: quick picks or `DateSelect`), Send Invoice (opens the new
  member's Invoice screen once saved, see Invoices below); then the confirm dialog. **Attach the payment
  bill (2026-11-07, the user's request; it replaced step 2's "Attachment, coming soon"):** a photo
  of the plan payment's receipt (camera or gallery, any shape, `lib/gymPhoto.ts` `pickReceiptImage`,
  a thumbnail and Remove once picked), uploaded after the member is saved onto the admission payment
  through `PUT|DELETE|GET /api/gym/payments/:id/receipt` (`gym/paymentReceipts.js`: JPEG/PNG/WebP
  from the bytes, 3 MB, 96-6000 px a side, the photos' hourly allowance; files in
  `PAYMENT_RECEIPT_DIR`, default `uploads/payment-receipts`; `gym_payments.receipt_key` keeps only the
  file name, read with the session by this branch's staff; area members, `staffRules.areaOfPath`).
  A failed upload keeps the member saved and says so. The member's page's payment line shows a
  Bill chip (`PaymentRow`) that opens the photo whole (`ReceiptViewer`); `receiptUrl` comes only
  with the member's payments (`service.paymentsWithReceipts`, which reads as "no bill" before the
  migration so every payment read keeps working). Migration `2026-12-06-payment-receipts.sql`;
  before it attaching answers 503 naming it. Tests: `e2e/gym-payment-receipts.e2e.test.js`. The plan starts on the
  joining date; the payment is dated the payment date. Owed amounts carry `due_by`; past it a
  member is overdue (Members › Overdue). Migration `2026-11-23-member-details.sql` (also the PT period).
- **Due members (2026-11-04, the user's designs):** Home's Due Members card opens `DueMembersSheet`
  (Payment Due Members: ID, PT tag, days left, amount due; the bell opens Send Reminder on the due
  template (since 2026-11-07, the user's rule: every bell works the same way, WhatsApp / SMS /
  Notification), ⋯).
  ⋯ (and the ⋯ on a member's page) opens `MemberActionsSheet`: the member's card on the gradient
  (Call, SMS, WhatsApp, Email; plan and PT with their dates), Attendance History, Reminders
  (due, expired, invoice), Membership (Collect Payment Due → `CollectDueSheet` with a collected date,
  part payments and Send Invoice; Renew Member; Edit Membership; Pause Membership coming soon;
  Transaction History) and Sales (Renew PT). Messages open the phone's own apps with the text
  written (`lib/gymContact.ts`: `tel:`, `sms:`, `wa.me`, `mailto:`): justFit sends nothing and pays
  for nothing. A PT payment records its period (`pt_label`, `pt_from`, `pt_until`; a renewal follows
  on from a running one). Since 2026-11-07 the PT form (`members/[id]/pt.tsx`) also has Start date
  and End date pickers beside the Duration: the start defaults to the follow-on day (or today), the
  end to start + duration; an end date on a whole month writes the Duration back (`monthsBetween`),
  any other end date is kept as picked with the Duration cleared (`lib/gymDates.ts`, pure and
  unit-tested, the server's month rules). The server takes optional
  `startsOn` (a year back to 60 days ahead) and `endsOn` (never before the start, at most 24 months
  after) and settles them in `rules.ptPeriod`. A member's page shows the PT they bought under the
  plan block (`PT · <package>`, Active / Ended, the from and to dates, the trainer), and the PT
  payment line carries the length (`PT · 12 sessions · 1 Month`; the days between picked dates when
  they aren't the duration's, `service.ptDetail`). Sheets share
  `GymSheet`; confirm dialogs `ConfirmDialog`; the main sheet button `GymPrimaryButton`. Member
  photos (approved, migration `2026-11-26-member-photos.sql`) are picked on Add Member and Edit
  Profile (`lib/gymPhoto.ts`, `PUT|DELETE|GET /api/gym/members/:id/photo`); without one the photo
  spot shows the initials.
  **Edit Profile (2026-11-06):** the ⋯ sheet's Profile › Edit Profile and a member's page's Edit
  open `EditProfileSheet`: the Add Member profile filled in, in one sheet (the photo: retake,
  gallery or remove; the Member ID read only; name, +91 mobile, gender chips, email, height, weight,
  address, notes, date of birth with a Remove) and Save Changes → `PATCH /api/gym/members/:id`,
  then `PUT`/`DELETE …/photo` only when the photo changed (a photo failure keeps the saved fields
  and says so). The page's older inline name-and-phone form is gone.
  **Sheet drag (2026-11-06):** `GymSheet` closes on a downward drag through
  `react-native-gesture-handler` v3 hooks (`usePanGesture`, `GestureDetector`, the library's
  `ScrollView` with `simultaneousWith={pan}`, a `GestureHandlerRootView` inside the Modal): from the
  handle always, from the content only when it started scrolled to the top. The earlier
  PanResponder never received the touch on iOS once the content scrolled, so tall sheets could only
  be closed from the handle. Use the v3 hooks (`runOnJS: true` keeps the callbacks on the JS
  thread), never the deprecated `Gesture.Pan()` builder.
- **Theme (2026-11-04):** the portal's main theme is an indigo-to-violet gradient (`gym-grad-from`
  `#4F46E5` → `gym-grad-to` `#7C3AED`, drawn by `components/gym/GradientFill.tsx` with
  react-native-svg): the revenue card, filled buttons, the + buttons, selected chips, the active
  tab, the ADMIN pill, the badge and the menu's account card. Text on it is white. Soft fills,
  outlines and small text stay solid indigo (`gym-primary*`); never black.
- **Navigation:** tabs Home · Manage · Wallet. Manage shows one section at a time with no top
  tabs (removed 2026-11-08, the user's request): the Manage tab always opens Members (`GymTabBar`
  resets `?tab=`), its search bar at the top. Since 2026-11-08 (the user's request, swipe-back) the
  links open their own screens over Home instead of switching tabs, like Likely to leave, so the
  back chevron, the iOS edge swipe and Android back return where they came from: `/gym/catalog`,
  `/gym/enquiries` (`?view=`), `/gym/expenses` (`?add=1`) and `/gym/members` (the ☰ menu, Home's
  tiles, + › Add Plan / Add Expense, the forms' "Add prices"), each in `GymSectionScreen` (back,
  title, the area check). `/gym/manage?tab=catalog|enquiry|expense` still renders those sections. The ☰ (and the account button) on
  Home open the side menu (`components/gym/GymMenu.tsx`): the account and branch, Manage items
  (Expenses; Reminder Templates; Outlets = branches; Staff / Admin Login for the gym
  admin only), Other (Send
  Bulk SMS opens its sheet; Attendance; Settings) and Sign out. Location & Attendance is reached
  from Attendance and Settings only (its ☰ item was removed on 2026-11-09, the user's request).
  **Settings (2026-11-08, the user's request):** ☰ › Settings (`app/gym/settings.tsx`) lists every
  setting in one place, grouped Branch (Branch details, Invoice details & logo: gym admin only;
  Outlets), Attendance (Location & Attendance, the QR code), Messages (SMS & auto reminders opens
  `BulkSmsSheet`; Reminder Templates) and Team (Staff / Admin Login, Role & Permission: gym admin
  only), then the account and Sign out. Rows open the existing screens; a row the login can't use
  (`access` from `GET /api/gym/branches`, `useCan`) is hidden. No server change. No subscription/Buy Now card (no
  billing in justFit yet).
  Money in whole rupees; "today" is India's date (`rules.todayInIndia`); gyms are never deleted
  and nothing cascades except `gym_staff` from users.
- **App:** Home (live dashboard, redesigned 2026-11-04: on the `gym-canvas` page with white
  `gym-dash-card`s, a header (menu, gym name and branch switcher, search, account), the greeting
  with India's date and Live Sync, the gradient revenue card (total, an online/cash split bar:
  online white, cash amber `gym-warning-line` since 2026-11-07 so the two can be told apart; both
  shares with a dot in their colour), Today: one card of six counts Admission, Renewal, Enquiry, Due Paid, PT, Product
  (3 a row, 6 from 700 px), Needs attention: one list of Due, Expiring today, Attendance,
  Expiring soon, Birthdays today, then Send Bulk SMS and Recent Transactions; content
  max 760 px; sections fade up once when the numbers first arrive, counts change with
  `AnimatedNumber`). **Expiring soon (2026-11-07, the user's request):** the window is a choice,
  not a fixed 1-3 days: Home's row counts the next 3 days and opens Members on
  `?filter=expiring_soon&days=3`; on Members the "Expiring soon" chip (that wording alone, no day
  count in the label) shows a row of day chips under the filters, "Ending in" All, 3, 7, 15, 30 (All first and the
  default on the Members screen; `EXPIRING_SOON_DAYS`, `DEFAULT_EXPIRING_DAYS` = all and
  `HOME_EXPIRING_DAYS` = 3 in `data/gymDashboard.ts`; the filter row opens with the chip the list
  opened on centred, its neighbours showing on both sides (2026-11-07, the user's screenshot;
  it was pinned to the left edge before), so Home's Due, Expiring today, Expiring soon or
  Birthdays are never off-screen), and both the list and the chip's count follow
  the pick (tomorrow to today + N, or for All every plan that ends after today; today's endings
  stay under Expiring today). `GET /api/gym/members?days=` is a whole number 1-90 or `all`,
  default 3, else 400 (`rules.expiringDays`);
  nothing is stored, Home always shows 3 days. The other screens: + (`/gym/add`: admission, renewal, due payment, PT, product, enquiry), Members (search, filters, pick mode), a member's page (check in
  once a day, renew, collect due, edit), Transactions (View All, 50 a page; one day at a time: a
  Date picker, today to start, a year back at most, replaced the Any day / Today chips on
  2026-11-07 at the user's request; `GET /api/gym/payments?day=YYYY-MM-DD`, `today=1` still
  means today), Enquiries (see below), Wallet tab
  (today, this month, owed). Admin: the Gyms tab, a gym's page,
  New gym. Calls in `lib/gymApi.ts`, loading in `lib/useGymData.ts`, saves in `lib/gymForm.ts`.
- **Enquiry follow-up (2026-11-05, chosen by the user):** Manage › Enquiry (`EnquiryList`; Home's
  Enquiry tile opens it on the Today view (`?view=today`, 2026-11-07) and the ☰ menu on Open; `/gym/enquiries` and `/gym/enquiry` only redirect there)
  lists everyone who asked about joining: Today, Overdue, Open (new or follow-up), Joined, Not
  interested and All, each with its count, and search by name or number. Cards show the status,
  when to call back (red once overdue), interest and source, with Call and WhatsApp (the phone's
  apps, `lib/gymContact.ts`) and the round +. `EnquirySheet` adds (also Home's + › Add Enquiry) and
  edits: name, mobile, Interested in (Membership, PT, Trial, Other), Came from (Walk-in, Call,
  WhatsApp, Instagram, Referral, Other), note, Follow up on (Today, Tomorrow, 3 days, 1 week or a
  date), status (New, Follow-up, Not interested) and Convert to member: Add Member opens with the
  name and number, and once saved the enquiry is Joined and linked to that member (only a member
  of the same branch; reopening unlinks it). A follow-up date moves a new enquiry to follow-up.
  Server: `GET /api/gym/enquiries?view=&search=` (with `counts`), `POST`, `PATCH /:id`
  (`rules.enquiryBody` / `enquiryEditBody` / `enquiriesQuery`, `service.enquiries` /
  `editEnquiry`). Migration `2026-11-28-gym-enquiry-followup.sql` (status, follow_up_on, interest,
  source, member_id, updated_at); before it, the list answers 503 naming it.
  **Referrals (2026-11-08, the user's request):** when Came from is Referral, `EnquirySheet` shows
  "Referred by (mobile number)", required (10 digits, not the enquirer's own); Save waits for it.
  Stored in `gym_enquiries.referred_by_phone` (migration `2026-12-09-enquiry-referrer.sql`). Every
  enquiry answer carries `referredBy: { phone, member }`: `member` is this branch's member with that
  number (a live join on `uq_gym_members_phone`, never another gym's), so the card says "Referred by
  Ravi Kumar (FOR-TUM-0003)" or the number (`referrerText`). Rules: `rules.enquiryBody` drops the
  number for other sources; `service.editEnquiry` checks only when the source or the referrer
  changes (older referrals without a number stay editable), clears it when the source moves off
  Referral, and writes the column only when it changes. Before the migration, enquiries are read
  without it (`selectEnquiries`) and saving a referral answers 503 naming it.
- **Look:** `gym-*` tokens (the indigo-to-violet theme, this portal only) and `gym-*` utilities; the member app and the
  Super Admin stay red. No AI button (removed at the user's request).
- **SMS to members (2026-11-04, the user's GymOps designs; real SMS approved by the user):**
  Manage › Member follows the user's 2026-11-07 design (`MemberList`: the search bar with the
  sort button, the filters as chips each with its count (`counts` comes with
  `GET /api/gym/members`, within the same search); a card per member with the photo spot, the
  name, the ID and PT tag, a status pill (Active green, Due or Expiring amber, Expired red) and
  ⋯, then one line: a days-left pill (red once expired), a red payment-due pill, and at its end
  Collect (when they owe, opens `CollectDueSheet`) and the bell (red once expired). The card was
  compacted on 2026-11-07 at the user's request (44 px photo, 12 px padding, no footer or hint
  line). **Plan names (2026-11-08, the user's request):** the card's pills read the plan, the days
  left and PT side by side ("Gold · 3 Months", "91 days left", "PT · 12 sessions"), then the due
  pill with Collect and the bell; the PT tag beside the ID is gone. The header's Add is a "+ Add"
  gradient button. `gym_members.plan_name` (migration `2026-12-12-member-plan-name.sql`) keeps the
  catalogue plan's name when bought: Add Member and Renewal send `planId` and the server reads the
  name from this branch's catalogue (`catalogPlanName`; another branch's plan, a PT item or a made-up
  id answers 400); a custom plan saves none and renewing onto one clears it; renaming the plan later
  keeps the member's. `memberPlanText` (`data/gymDashboard.ts`) shows the length alone when there is
  no name. Before the migration members are read without it (`hasPlanName`, checked once a minute). The bell opens **Send Reminder** (`SendReminderSheet`, the user's 2026-11-07 design,
  also behind the ⋯ sheet's Reminders): the member's card (status, days left, payment due,
  plan), Send via tiles you can combine (WhatsApp; SMS; Notification shown as coming soon: no
  push server), and the message from Use Template (payment due, membership expiry/expired, the
  invoice when there is a payment), editable to 300 characters. An SMS goes through justFit
  (1 credit, confirm) only while sending is on, credits are left and the text is still the
  template word for word (the DLT route); otherwise, and for WhatsApp, the phone's own app opens
  with the text, two apps one after the other as the app comes back; a square + for Add Member). Send Bulk SMS (`BulkSmsSheet`, from Home's card,
  the + sheet and the ☰ menu): Available Credits on a dark navy card, Buy Credits (says the
  justFit team adds them: no payments), Quick Actions Auto Reminders (switches for the expiry
  reminder 1 day before, expired 3 days after, weekly due, birthday wishes; each with a Preview),
  Manual Send (a group: expiring in 3 days, expired in the last 30 days, payment due, birthday
  today; confirm, then sent/failed/skipped) and Message Logs (30 a page). Server `gym/sms.js`,
  pure rules and the four message texts in `gym/smsRules.js`, the sender in `gym/smsSender.js`;
  routes `GET /api/gym/sms`, `PATCH /api/gym/sms/settings`, `POST /api/gym/sms/send`,
  `POST /api/gym/members/:id/sms`, `GET /api/gym/sms/logs` (sends: 30 an hour per account, one
  group send per branch at a time); Super Admin › a gym › SMS credits
  (`POST /api/admin/portal/gyms/:id/sms-credits`, 1-100,000, audited `gym.sms_credits`).
  1 credit = 1 SMS, per branch (`gyms.sms_credits`): a credit is taken and the `gym_sms_log` row
  written in one transaction, then the provider is called; a failure gives the credit back. Auto
  reminders run hourly between 10:00 and 19:59 India time (`startReminders`, never in tests) and
  go once per member (`auto_key`: per plan end, per week, per year, unique). Sending uses
  `SMS_PROVIDER` (`fake` in tests writes `gym-sms.jsonl` to the outbox) and, for Fast2SMS, the
  DLT route with four registered templates `FAST2SMS_GYM_EXPIRY_ID`, `_EXPIRED_ID`, `_DUE_ID`,
  `_BIRTHDAY_ID` (texts word for word from `smsRules.js`); without them gym SMS stay off, the
  sheet says so and the list's buttons open the phone's SMS app instead. Logs never return phone
  numbers. Migration `2026-11-25-gym-sms.sql`.
- **QR attendance (2026-11-04, replaced the never-built biometric attendance):** members check in
  and out by scanning their branch's QR code in the member app (Profile › Gym attendance,
  `app/(user)/attendance.tsx`; also opens from the code as a `justfit://attendance?…` link). The
  member is the `gym_members` row at the scanned branch whose phone is the account's verified
  phone (never an id from the app). Server: `gym/attendanceRules.js` (pure: the signed QR, the
  haversine distance, the GPS checks, filters, CSV), `gym/attendance.js`, staff routes in
  `gym/routes.js` (`/api/gym/attendance*`, `POST /members/:id/check-out`) and member routes
  `/api/attendance` (`GET /`, `POST /scan`, `/check-in`, `/check-out`; 30 per 10 min per account)
  in `gym/attendanceRoutes.js`. The QR code is an HMAC of branch id and `gyms.qr_version` (HKDF
  label `justfit-gym-qr` from `AUTH_SECRET`): nothing secret stored, regenerating voids old prints.
  A scan counts only with the current code, an active membership (check-in), and a GPS reading
  that is fresh (2 min), precise (≤150 m), not mocked and within `gyms.attendance_radius_m`
  (default 100, 20-1000) of `gyms.latitude/longitude`. One open visit per member (unique key on
  the generated `open_member_id`); several visits a day; the server works out `duration_min`;
  a visit still open at midnight, India time, becomes `no_checkout` (2026-11-07, the user's rule;
  it was 12 hours after the check-in before): `startMidnightClose` in `gym/attendance.js` sweeps
  every branch at startup and at each India midnight, and every read or write that looks at open
  visits closes earlier days' first, so Inside only ever means today. In the history, picking
  Inside selects Today and the other ranges are disabled until another status is picked; the
  server fixes the range to today for `status=inside` too (`historyQuery`). Staff check in/out by hand stays (`in_source`/
  `out_source` 'staff'). Admin screens: `app/gym/attendance/` (dashboard: inside now, today's
  numbers, Statistics for Today / Last 7 days / Last 30 days (renamed from Daily / Weekly /
  Monthly on 2026-11-07, the user's request; the month was the calendar month before) with the
  chart following the period: today's check-ins by India hour (5 am to 10 pm plus any outside
  hour with a visit), else a bar a day (`charts` on `GET /api/gym/attendance`, pure
  `attendanceRules.chartHours` / `chartDays`; `lastSevenDays` stays as the 7-day chart), history
  with range/status/search and an Excel export (2026-11-09, the user's request; it was a CSV):
  `GET /api/gym/attendance/export?format=xlsx` (`format` csv, the default, or xlsx; `attendanceRules.exportQuery`)
  builds one sheet in `gym/xlsx.js` with Node's own zlib, no library: a bold frozen header, a filter,
  numbers as numbers and text as inline strings, never formulas; the app saves `attendance-<from>-to-<to>.xlsx`
  and opens the share sheet (`lib/attendanceExport.ts`, the button "Export Excel"); `settings.tsx`: name, map (`AttendanceMap`: react-native-maps, Google on Android with
  `GOOGLE_MAPS_ANDROID_API_KEY`, Google on iOS too with `GOOGLE_MAPS_IOS_API_KEY` (Apple Maps when
  it isn't set); both in `JustFit_client/.env` or the shell, read by `app.config.ts`, never
  committed, then `npx expo prebuild --clean`; no map on the web build), place search by the phone's geocoder,
  current location, coordinates, radius; `qr.tsx`: show, share/print, regenerate;
  `member/[id].tsx`: one member's history). GPS through `lib/gpsReading.ts` (expo-location, while
  in use only). Audit actions `gym.attendance_place`, `gym.qr_regenerate`; security events
  `attendance.bad_qr`, `attendance.mock_location`. Migration `2026-11-27-gym-qr-attendance.sql`
  (keeps existing check-ins as `no_checkout`/`staff`). Mock-location detection is best effort
  (Android's flag, iOS simulated locations); a rooted phone can still fake GPS.
  **Staff & Trainers (2026-11-09, the user's choices):** Attendance has two tabs for the gym admin,
  Members (as above) and Staff & Trainers (`components/gym/TeamAttendance.tsx`; `?tab=team`); a Staff
  login sees only the members' screen. The branch's Staff and Trainers check in for work by scanning
  the same QR code with the same GPS checks: Staff from ☰ › My check-in (`app/gym/check-in.tsx`),
  trainers from Profile › Gym attendance; both screens are `components/attendance/QrAttendance.tsx`.
  The server decides who is scanning (`attendance.js` `whoScans`: a `gym_staff` row of kind staff or
  trainer at the scanned branch wins over a membership there) and writes a day at work to
  `gym_staff_attendance` (`gym/staffAttendance.js`; one open visit per person, closed at India
  midnight with the members'); scan answers carry `as: "member" | "staff"`. The tab: each person
  with today's state (On duty, Left, Not in), Check in / Check out by hand, On duty now / Came in
  today / Not in yet, and the visits of Today / 7 days / 30 days with a search by name.
  `GET /api/gym/team-attendance?range=&search=&page=`, `POST /api/gym/team-attendance/:userId/check-in|check-out`
  (gym admin only, no area; `attendanceRules.teamQuery`; recorded on Activity). Migration
  `2026-12-15-staff-attendance.sql`; before it the tab and a Staff or Trainer's scan answer 503
  naming it. Tests: `e2e/gym-staff-attendance.e2e.test.js`, `gym-attendance-rules.test.js`.
- **Predictions (2026-11-06, the user's plan; #1 of five, rules only, no AI):** "Likely to leave",
  the renewal-risk prediction. Home › Needs attention › Likely to leave (the High count, from
  `dashboard.alerts.renewalRisk`) and ☰ › Likely to leave open `app/gym/predictions/renewals.tsx`:
  Medium and High members, highest score first, with tabs All / High / Medium (counts follow the
  search), search by name, phone or ID, each card's level and score chip, ID, PT tag and the
  reasons in one line, a bell (opens Send Reminder on the renewal template, as every bell does since
  2026-11-07; the WhatsApp and Call buttons were replaced at the user's request) and ⋯
  → `MemberActionsSheet`. Scoring (`gym/predictionRules.js`, pure, constants at the top): plan ends
  within 7 days or ended in the last 7 (+30), no visit for 10+ days (or never, 10+ days after
  joining) (+30), visits in the last 30 days at most half of the 30 before when those were 4+ (+20),
  a payment due (+20), PT running (−15); High 60+, Medium 35–59, Low under 35. Since 2026-11-07
  (the user's request) Low members are listed too (a green chip, "Nothing against them" when there
  are no reasons; `?level=low`, `counts.low`), so the list is every scored member and only Home's
  count stays High; members whose
  plan ended more than 7 days ago aren't scored. `gym/predictions.js` reads `gym_members` plus
  three attendance sub-selects (last visit, distinct visit days in each window) for the caller's
  branch and scores live on every read: nothing stored, no job, nothing sent by itself;
  `calculatedAt` is the response time. Route `GET /api/gym/predictions/renewals?level=all|high|medium&search=`
  behind `requireGymStaff` (owner and Staff).
  **#4 Busy hours (2026-11-06):** Attendance › "Tomorrow's busy hours" (`components/gym/BusyHoursCard.tsx`,
  `GET /api/gym/predictions/busy-hours`, `predictionRules.busyHours`): tomorrow's expected
  check-ins per hour = the average of the same weekday over the last four weeks, hour by hour,
  rounded; a member counts once per hour per day; the hour is India's from the check-in's epoch
  (`hourInIndia`), never the session's zone; only weeks on or after the branch's first attendance
  date count, and fewer than two of them gives `enough: false` and a "Not enough attendance data
  yet" card instead of a number. Bars from 5 am to 10 pm (plus any earlier/later hour with
  visits), busiest and quietest hours, last week's total. Since 2026-11-07 (the user's request)
  the card is in plain words: "Expect about 3 check-ins tomorrow", "Busiest time 6–7 pm · about
  2 members", "Quietest time 5–6 am · usually no one", the bars under "Expected check-ins, hour
  by hour", and "Based on the last 4 Sundays. Last Sunday: 1 check-in."
  **#5 Month-end revenue (2026-11-06):** Wallet › "Expected by month end"
  (`components/gym/RevenueForecastCard.tsx`, `GET /api/gym/predictions/revenue`,
  `predictionRules.revenueForecast`): collected this month so far + plans ending between today and
  month end × the branch's renewal rate (members who renewed in the last 90 days ÷ those plus
  members whose plan ended in that time and is still not renewed; null until 5 endings) × each
  member's last admission/renewal payment + dues due by month end, overdue or undated × the
  due-collection rate (due payments in 90 days ÷ those plus dues now overdue; null without
  history). A null part shows "—" and "needs history", the total is shown as "≥" with
  `complete: false`; otherwise "≈". Last month's total for comparison. Everything is this branch's
  own records; nothing is stored.
  **#3 Enquiry conversion (2026-11-06, migration approved by the user):** Manage › Enquiry scores
  every open enquiry (`predictionRules.enquiryScore`): referral or wants a trial +30, walked in or
  visited since +20, first call or message within 2 days of the enquiry +20, no answer twice or
  more −30, older than 14 days −20; **Hot 60+ · Warm 30–59 · Cold**; null once joined or lost.
  Each card shows the chip and the reasons, the last contact, and a log button
  (`EnquiryContactSheet`: reached / no answer by call or WhatsApp, or a visit); after Call, when
  the app comes back to the front, "How did it go?" asks once (Reached / No answer / Skip). The
  Open list is sorted hottest first by the server; the edit sheet lists the contacts. Table
  `gym_enquiry_contacts` (migration `2026-11-30-gym-enquiry-contacts.sql`; before it the list
  works without contacts and logging answers 503), `POST /api/gym/enquiries/:id/contacts`
  (`rules.contactBody`, 60 an hour), contacts and `lead` on every enquiry answer.
  **#2 Payment on time (2026-11-06, migration approved by the user):** Home › Due Members
  (`DueMembersSheet`, now `GET /api/gym/predictions/payments?search=`) shows each due member's chip
  and reasons, likeliest late first (`predictionRules.paymentRisk`): paid a due late 2+ times
  +40, due over ₹2,000 +20, member under 60 days +10, already overdue +20, the last 3 due
  payments on time −30; **Likely late 60+ · Watch 35–59 · On time** below, or **No history** when
  nothing is against them and no due payment is on record. "Late" needs the date a due was paid
  against: `gym_payments.due_by`, written by Collect Payment Due from the member's due date at
  that moment (migration `2026-12-02-gym-payment-due-by.sql`; `addPayment` writes the column only
  when it has a value, so other payments work before it; older due payments stay NULL and count
  as neither). Nothing stored, no job, no AI.
  Not built yet (each needs approval and a migration): saving results, follow-up notes, snooze,
  "not renewing", outcome tracking, and a settings screen. Tests:
  `__tests__/gym-prediction-rules.test.js`, `e2e/gym-predictions.e2e.test.js`,
  `ui/gym-predictions.ui.test.js` (attendance rows are inserted with `FROM_UNIXTIME` at an
  India-time hour).
- **Pause Membership (2026-11-07, the user's two workflows):** **Option A, member initiated:**
  Profile › Gym membership (`app/(user)/membership/index.tsx`, `lib/membershipApi.ts`, words in
  `lib/membershipText.ts`, pure and unit-tested) lists every membership on the account's verified
  number (the gym and branch, Member ID, plan and dates, a badge: days left / Expires today /
  Expired / Paused until …, dues, PT) and Pause Membership → `membership/pause.tsx`: first and last
  paused day (`DatePickerSheet`, today to 60 days ahead, 1-90 days), a reason (3-200 characters),
  "N days paused, your plan would then end on …", Send pause request. The card then says "Pause
  requested … Waiting for <gym> to approve" with Cancel request; a rejection shows under Earlier
  with the gym's note. **Option B, staff initiated:** a member's ⋯ › Membership › Pause Membership
  (`components/gym/PauseMembershipSheet.tsx`: dates, up to 30 days back, reason, "Please confirm
  the details") pauses at once. Staff answer members' requests on Home › Needs attention › Pause
  requests (`app/gym/pauses.tsx`, Waiting / All; Approve and Reject ask for a second tap on the
  card). An approved pause adds its days to `gym_members.expires_on` (kept in `extended_days`) and
  QR check-in answers 403 "Your membership is paused until …" while it runs (`attendance.js`
  `resolveScan`, `member.pausedUntil` on the scan preview). One open pause (pending, or approved and
  not over) per member; a request can't start after the plan ends or on an expired plan. Server:
  `gym/pauseRules.js` (pure), `gym/pauses.js`, member routes `GET /api/membership`,
  `POST /api/membership/:id/pause`, `DELETE /api/membership/:id/pause/:pauseId`
  (`gym/membershipRoutes.js`, the membership matched by the account's phone, 10 requests an hour,
  `GYM_PAUSE_REQUESTS_PER_HOUR`; the portal's own budget is `GYM_REQUESTS_PER_MINUTE`, default 180,
  and the test server raises both);
  staff routes `GET /api/gym/pauses?view=pending|all`, `POST /api/gym/pauses/:id/approve|reject
  { note? }`, `POST /api/gym/members/:id/pause` (area members, 30 an hour); `GymMember.pause` /
  `pausedNow` and `alerts.pauseRequests` on the dashboard; audited `gym.pause_approve`,
  `gym.pause_reject`, `gym.pause_add`. Table `gym_membership_pauses` (migration
  `2026-12-05-membership-pauses.sql`; before it the portal and `/api/membership` answer 503 naming
  it, and attendance treats everyone as unpaused). Not built: a push or in-app notification to the
  member (Notifications is still a placeholder; the member sees the pause on Gym membership), ending
  an approved pause early, pausing PT dates. Tests: `__tests__/gym-pause-rules.test.js`,
  `e2e/gym-pauses.e2e.test.js`, the client's `lib/__tests__/membershipText.test.ts`.
- **Invoices (2026-11-07, the user's request; expo-print approved):** every gym payment has an
  invoice of its own. `gyms.next_invoice_no` is the branch's running number (like Member IDs) and
  `gym_payments.invoice_no` (unique per branch) is taken with the counter locked when the payment
  is saved (`service.addPayment`; a counter sale opens its own transaction); a payment saved before
  the migration has none and is numbered the first time its invoice opens (`gym/invoices.js`
  `numberPayment`), so a number never changes or repeats. The number reads
  `INV-FOR-TUM-0001` (`invoiceRules.invoiceNumber`). The Invoice screen (`app/gym/invoice.tsx`,
  `?paymentId=` or `?memberId=` for the member's latest payment) is a white card: the gym on the
  gradient (branch, area and city, then the address, phone and GSTIN when set) with the number and
  date, Bill to (name, Member ID, phone; "Walk-in customer" for a counter sale), the one item
  (`ITEM_LABEL`: Membership, Membership renewal, Due payment, Personal training, Service, Product,
  with the payment's detail), Paid · mode, Balance due (red; the member's due today with its date)
  or "Nil · Paid in full", and the membership's standing today. **Share PDF** builds an A4 PDF on
  the phone (`expo-print` `printToFileAsync` from `lib/gymInvoice.ts` `invoiceHtml`, pure and
  unit-tested; the file is renamed `INV-…-<member code>.pdf` and handed to `expo-sharing`; on the web
  the HTML opens in a new tab to print); WhatsApp, SMS and Email open the phone's apps with the
  invoice as text (`invoiceText`); justFit sends nothing. Opened from the ⋯ sheet's Send Invoice,
  the Invoice chip on a payment (`PaymentRow` `invoice`, on the member's page and Transactions), and
  the Send Invoice tick on Add Member, Collect Due, Add Service and Sell Product (it opens the
  screen once saved; the old plain-text shares are gone). **Invoice details:** Branch details
  (gym admin only) › Invoice details: address (160), mobile number and GSTIN, each optional, an
  empty field clears it (`GET|PATCH /api/gym/invoice-details`, owner only for PATCH, audited
  `gym.edit`; `invoiceRules.invoiceDetailsBody`). Routes `GET /api/gym/payments/:id/invoice` and
  `GET /api/gym/members/:id/invoice` (area members, like the bill). Migration
  `2026-12-07-gym-invoices.sql`; before it the invoice routes answer 503 naming it and payments
  keep saving without a number. Tests: `__tests__/gym-invoice-rules.test.js`,
  `e2e/gym-invoices.e2e.test.js`, `ui/gym-invoice.ui.test.js`, the client's
  `lib/__tests__/gymInvoice.test.ts`. **Keyboard (2026-11-07, the user's screenshot):** `GymSheet`
  dismisses the keyboard when it opens and `ConfirmDialog` when it appears, so a second sheet or a
  "Please confirm the details" dialog never opens under the keyboard on any screen.
- **Expenses (2026-11-08, the user's choices):** Manage › Expenses (`components/gym/ExpenseList.tsx`):
  one month at a time (‹ Nov 2026 ›, up to 24 months back), the month's total split online / cash,
  category chips with counts, search (what, who was paid, the note), cards newest first (50 a page,
  Show more), a Bill chip opening the photo (`ReceiptViewer`), and the round +. `ExpenseSheet` adds
  and edits: a fixed category (Rent, Salary, Electricity, Water, Equipment, Maintenance, Cleaning,
  Marketing, Stock, Other; Other needs a title; `EXPENSE_CATEGORIES` in `data/gymDashboard.ts`),
  what it was for, paid to, amount (whole rupees, up to ₹10,00,000), mode, date (a year back to
  today), note, an optional bill photo (`pickReceiptImage`), then "Please confirm the details";
  Delete (asked twice) only for the gym admin (`canDelete` on the list's answer). Wallet's This
  month card adds Expenses and Net (collected − spent) for a login with the area. Server:
  `gym/expenseRules.js` (pure), `gym/expenses.js`, `gym/expenseBills.js` (files in
  `EXPENSE_BILL_DIR`, default `uploads/expense-bills`; JPEG/PNG/WebP from the bytes, 3 MB);
  routes `GET|POST /api/gym/expenses`, `PUT|DELETE /api/gym/expenses/:id` (an edit sends every
  field; delete owner only, deletes the bill file), `PUT|DELETE|GET /api/gym/expenses/:id/bill`;
  adds and edits 60 an hour; audited `gym.expense_edit`, `gym.expense_delete`; area `expenses`.
  Table `gym_expenses` (migration `2026-12-10-gym-expenses.sql`; before it the routes answer 503
  naming it and Wallet has no expense lines). Not built: recurring expenses, budgets, CSV export.
  Tests: `__tests__/gym-expense-rules.test.js`, `e2e/gym-expenses.e2e.test.js`,
  `ui/gym-expenses.ui.test.js`, the client's `data/__tests__/gymExpenses.test.ts`.
- **Reminder Templates (2026-11-08, the user's plan):** ☰ › Reminder Templates (`app/gym/templates.tsx`)
  lists the branch's four messages, Payment due, Membership expiring, Membership expired and Enquiry
  follow-up, each filled in with a sample member and tagged Custom or Default. The gym admin edits one in
  `TemplateSheet` (the text, up to 300 characters; chips that insert `{name}`, `{gym}`, `{amount}`,
  `{dueBy}`, `{date}` or `{code}` where the kind allows; a live preview; Save; Reset to default, asked
  once more); Staff read them only. The defaults and placeholder lists are in `lib/reminderTemplates.ts`
  (pure, unit-tested; the defaults are the wording used before, so nothing changes until someone edits).
  `gymContact`'s `dueReminder`, `expiredReminder` and `enquiryFollowUp` take the branch's templates
  (`useReminderTemplates`, read once when Send Reminder or Enquiries opens; a failed read uses the
  defaults). justFit's own SMS keep their DLT text: Send Reminder sends a custom template through the
  phone's Messages app ("Your own template goes from your phone's Messages app"). Server
  `gym/templateRules.js` (pure: the kinds, each kind's placeholders, 10-300 characters, no control
  characters, no unknown placeholder or stray brace), `gym/templates.js`; routes `GET /api/gym/templates`
  (every portal login, no area), `PUT|DELETE /api/gym/templates/:kind` (gym admin only, 30 an hour,
  audited `gym.template_edit`). Table `gym_reminder_templates` (one row per branch and kind; migration
  `2026-12-11-reminder-templates.sql`; before it the routes answer 503 naming it). Not built: birthday
  and renewal templates (birthday goes only by justFit SMS; renewal reuses expiry / expired), templates
  per gym rather than per branch. Tests: `__tests__/gym-template-rules.test.js`,
  `e2e/gym-templates.e2e.test.js`, `ui/gym-templates.ui.test.js`, the client's
  `lib/__tests__/reminderTemplates.test.ts`.
- **Invoice template and gym logos (2026-11-08, the user's template):** the Invoice screen and the PDF
  follow the user's invoice template: "Invoice" with a red rule and the kind under it ("Membership
  Invoice", "Product Invoice"…), the gym's own logo at the top right (its initials on a red square
  when it has none), Invoice No / Invoice Date / Due Date (the balance's due date, else the invoice's
  date), Member Details and Plan Details cards (PT, Service or Product Details for those payments),
  the item table with a red header, Subtotal and the Total Amount on a pink band, the Balance Due,
  Payment Details with a green Paid badge, the signature line and the gym's footer (place, phone,
  GSTIN). The screen stacks it for a phone; the PDF is one A4 page. The words and rows come from
  `lib/gymInvoice.ts` (`detailRows`, `dueDate`, `invoiceSubtitle`, `itemDescription`, pure and
  unit-tested) for both. The template's GST, discount, second line, QR and transaction ID are left
  **Added templates (2026-11-08, the user's request):** under the four, "Your templates": the gym
  admin's own named messages (the round + on Reminder Templates, `TemplateSheet` with
  `editing={{ added: null }}`: a name of 2-40 characters, the text with any member placeholder,
  `ADDED_PLACEHOLDERS`; edit, Delete asked once more), up to 20 a branch, names unique in the branch.
  Send Reminder's Use Template lists them after the reminders (`addedReminder` in `gymContact`); they
  always go from the phone's own apps. Server `templateRules.addedBody`, `templates.addTemplate` /
  `editTemplate` / `deleteTemplate`; routes `POST /api/gym/templates/added`,
  `PUT|DELETE /api/gym/templates/added/:id` (gym admin only, the templates' 30 an hour; audited
  `gym.template_add`, `gym.template_edit`, `gym.template_delete`). `GET /api/gym/templates` carries
  `added` and `canAdd`. Table `gym_added_templates` (migration `2026-12-13-added-templates.sql`;
  before it the list is empty, the + is hidden and adding answers 503 naming it).
  out: justFit records none of them. **Logo:** each gym prints its own: Branch details › Invoice
  details › Logo (camera or gallery, shrunk to 512 px, `pickLogoImage`) saves at once through
  `PUT|DELETE /api/gym/logo` (gym admin only, the photos' hourly allowance, audited `gym.edit`);
  `GET /api/gym/logo` reads it for any portal login. It belongs to the gym (`gym_brands.logo_key`), so
  every branch prints the same one. `gym/logos.js`: JPEG/PNG/WebP from the bytes, 2 MB, 64-4000 px a
  side, files in `GYM_LOGO_DIR` (default `uploads/gym-logos`); the invoice answer carries it as
  `gym.logoDataUrl` and the app puts only an image data URL into the PDF (`safeLogo`). Invoice details
  carry `logoUrl`. Migration `2026-12-08-gym-logos.sql`; before it invoices have no logo and the logo
  routes answer 503 naming it. Tests: `e2e/gym-invoices.e2e.test.js` (4b), `ui/gym-invoice.ui.test.js`
  (1b), `gym-invoice-rules.test.js`, the client's `lib/__tests__/gymInvoice.test.ts`.
- **Performance pass (2026-11-07, the user's "fix all"):** the member list is paged, 50 a page
  (`GET /api/gym/members?sort=name|days|due&page=N` → `page`, `nextPage`; `rules.membersQuery`,
  `MEMBER_ORDER` in `service.js`): the sort runs on the server so every page follows it, and
  `MemberList` appends pages with Show more (the 200 cap with no next page is gone). The dashboard,
  the attendance summary, the member's page and the member list send their independent queries
  together (`Promise.all`). `GET /members/:id` carries `gym`, so the member's page no longer reads
  the dashboard for it. `useGymData` returns `refreshing` / `refresh` and Members, Transactions,
  Attendance, Wallet, Enquiry, Pause requests, Likely to leave and a member's page have pull to
  refresh (Home already had it). Photos are shrunk on the phone before upload
  (`expo-image-manipulator`, approved: a member's photo to 512 px, a brochure or bill to 1600 px on
  the long side, JPEG 0.8; `lib/gymPhoto.ts` `shrink`, the original is used if shrinking fails).
  The ⋯ sheet's Edit Membership opens the Edit Profile sheet (the user's request).
- **QA pass (2026-11-07, the user's handed-over end-to-end run; fixes only, no restyling):** the gym
  router is `express.Router({ caseSensitive: true, strict: true })` and `staffRules.areaOfPath` reads
  the path lower-cased without a trailing slash: Express used to match `/Payments` and `/payments/`
  to the `/payments` route while the area map read them as "no area", so a Staff login could reach
  any area that way (`gym-staff-rules.test.js`, `gym-staff.e2e` cover it). `PATCH /details` is
  `ownerOnly` (Branches shows Edit this branch to the gym admin only). `useGymData` shows loading
  for a new query (a changed `load`: another filter, day or search) and reports that query's own
  failure, keeping the old answer only on a refresh of the same query; `update(fn)` changes the
  shown answer functionally. `GymScreen` wraps its scroll in a `KeyboardAvoidingView` (iOS) and
  leaves room under the content for `floating`. `GymSheet` takes `onDismissOverlay`: Android back
  and the backdrop close a confirm dialog first, not the whole form; `ConfirmDialog` takes `busy`.
  `PaymentRow` is a View with the row's button and the Invoice / Bill chips on a line under it
  (never a button inside a button). The member page, the ⋯ sheet, the member list's Collect,
  Wallet's forecast and due card and Attendance's busy hours follow `useCan`. Add Member, Send
  Reminder and Bulk SMS guard double taps with refs. `lib/api.ts` exports `reportRefusal` for
  requests made outside `apiFetch` (the CSV export). Member app: `SetupScreen`'s Back on step 1 asks
  through the browser on the web; `SetupField` pickers dismiss the keyboard; `scan-report` offers
  Sign in again on a 401; `body-scan` ignores Back while scanning; Home shows a skeleton until the
  first numbers arrive; `store/macro.ts` `logDate()` rolls a "today" selection past midnight
  (`lib/macroDateRules.ts`); the trainer guard in `(user)/_layout.tsx` is a `<Redirect>`.
- **Activity log (2026-11-09, the user's request; migration approved):** the gym admin sees who
  added, edited or deleted what at the branch: ☰ › Activity and Settings › Team › Activity
  (`app/gym/activity.tsx`, owner only): one India day (a year back at most), Added / Edited /
  Deleted chips with counts, a chip per person active that day, newest first, 50 a page; each row
  "Ravi Kumar · Staff edited member Arjun M (FOR-TUM-0003)" with the line and the time. Server:
  `gym/activity.js` `recorder` is a `router.use` after `requireArea`: for every write it reads the
  record before (allowlisted, branch-scoped `SNAPSHOTS`), and when the route answers 2xx it reads it
  again and inserts one `gym_activity_log` row before the answer goes out (not in the change's own
  transaction; a failed write is logged and never fails the request). `gym/activityRules.js` (pure)
  maps every write route to its type, action, label and line (`ROUTES`; switching branch records
  nothing); `gym-activity-rules.test.js` walks the router so a new write route must be added there.
  Lines name changed fields only, with values just for prices, amounts, dates and statuses (never a
  phone, address or note); labels keep the record's name, so a deleted plan still reads; team
  numbers are masked. Refused and failed requests are not recorded. `GET /api/gym/activity?day=&
  action=&person=&page=` (`ownerOnly`, `activityRules.activityQuery`) deletes the branch's rows
  older than 365 days first. Table `gym_activity_log` (migration `2026-12-14-gym-activity-log.sql`;
  before it nothing is recorded and Activity answers 503 naming it); test cleanups delete it before
  `gyms`. Tests: `gym-activity-rules.test.js`, `e2e/gym-activity.e2e.test.js`,
  `ui/gym-settings.ui.test.js` (6).
- **Tests:** `__tests__/gym-rules.test.js`, `gym-sms-rules.test.js`, `gym-attendance-rules.test.js`,
  `gym-staff-rules.test.js`, `e2e/gym-portal.e2e.test.js`, `e2e/gym-sms.e2e.test.js`,
  `e2e/gym-attendance.e2e.test.js`, `e2e/gym-staff.e2e.test.js`, `ui/gym-portal.ui.test.js`,
  `ui/gym-staff.ui.test.js`, `ui/gym-permissions.ui.test.js`, `gym-trainer-rules.test.js`,
  `e2e/gym-trainer.e2e.test.js`, `ui/gym-trainer.ui.test.js`, and the predictions' three above.

### Community and gyms: removed (2026-11-01)

The user asked for Community to go completely, gyms included, and for Workout to take its tab.
Gone from the app, the server and (once `JustFit_server/migrations/2026-11-06-remove-community.sql`
has run) the database: the feed, posts, comments, likes, polls, stories, friends, follows, blocks,
direct messages, community profiles and moderation (Admin › Reports, suspensions); gyms, their
members, invitations, announcements, events and QR codes; the gym owner portal (`app/owner/`,
`/api/owner`), member passes and QR attendance (`/my-qr`), gym notices and the bell's gym items; the
WhatsApp gym agent (`/api/whatsapp`, the job worker) and Admin › Gyms; the `/api/media` uploads.
Groups, Challenges and Trainers had already gone. Do not rebuild any of it unless the user asks.
(The user asked on 2026-11-05 for gym PT trainers, added by a gym's admin: role `trainer`, see
Staff / Admin Login. The old trainer portal and coaching stay removed.)

- The Super Admin portal's tabs are Overview · Users · Content. The Overview counts users, new users
  and the last seven days' finished workouts and logged meals; Users filters All / Members / Admins
  and an account's page shows when they joined and how many meals, workouts and orders they have.
- Kept as history: `admin_audit_log` rows about gyms, posts and reports; `ai_usage` rows of the
  `gym_assistant` feature (still in the ENUM, labelled "removed" on AI Usage, no section); old
  `analytics_events` of the community events (the server no longer accepts new ones).
- `expo-camera` and `react-native-qrcode-svg`, unused after this removal, are used again since
  2026-11-04 by QR attendance (the member's scanner and the gym's code).

---

## Development Philosophy

Build feature by feature.

For every feature:

1. Understand the user request.
2. Check this file before coding.
3. Keep the implementation simple.
4. Avoid overengineering.
5. Prefer readable code over clever code.
6. Build the smallest useful version first.
7. Refactor only when repetition or complexity appears.
8. Keep the app easy to teach and explain.

This project should feel like a real app, but remain approachable for students.

---

## Decision Making & Clarifications

If something is unclear or could be improved:

- Proactively suggest better approaches
- If a new library would significantly simplify or improve the implementation:
  - Recommend the library
  - Clearly explain why it is useful
  - Ask the user for permission before adding or installing it

Example:

> "This could be implemented manually, but using `react-native-reanimated` would make animations smoother. Do you want me to add it?"

Do not install or use new libraries without user approval.

---

## Architecture Guidelines

Use this structure unless there is a strong reason to change it:

```txt
JustFit_client/src/
  app/            screens and layouts (Expo Router); no server code lives in the app
    (auth)/       sign-in, sign-up, forgot-password
    setup/        profile setup steps
    admin/  home.tsx   one landing screen per role
  components/
  constants/
  data/           static, typed content (options, onboarding slides, dashboard tiles)
  lib/            service helpers (api.ts, account.ts, session.ts, sessionRules.ts, tokenStorage.ts, phone.ts, roles.ts, numberInput.ts, nutrition/)
  store/          Zustand stores
  types/
  theme/
assets/

JustFit_server/
  index.js        Express app: every route, JSON 404 and the error handler
  auth.js         requireUser (checks the session token against auth_sessions), requireAdmin, getAccount (email, phone, role from users)
  auth/           phone sign-in: phone.js, otp.js (codes, limits), sessions.js, sms.js (off | fake | fast2sms), service.js, routes.js
  scripts/set-role.js  the only way to make an admin (npm run set-role -- <phone> <role>)
  profile.js      profile validation, the transactional save and the load for /api/profile
  rateLimit.js    per-user rate limiting (limitPerUser) for every authenticated route
  requestBody.js  capped JSON body parsing for the upload route
  bodyComposition/  report upload checks (upload.js), OpenAI extraction (extract.js), clean-up (normalize.js),
                    photo scan checks and the call to the Forma scan server (scan.js, FORMA_SCAN_URL)
  logging.js      safe error logging (never the SQL, body, headers or a token)
  database.js     mysql2 connection pool, configured from .env
  schema.sql      the full MySQL schema (run once; it does not migrate)
```

The server **imports the app's nutrition calculator from the client folder**
(`require("../JustFit_client/src/lib/nutrition/index.ts")` in `profile.js`) so saved targets are
re-checked with the exact rules the app used, without a second copy of the code. Node 24 strips
the TypeScript types at load time. Consequences:

- The two folders must stay side by side; moving one breaks the import.
- Startup prints two one-off Node warnings ("Type Stripping is an experimental feature" and
  "Module type ... is not specified"). Both are harmless and expected.
- Keep `src/lib/nutrition/` free of React Native or `@/` alias imports, as it is now, or the server
  can no longer load it.

### app/

Use this for routes and screens only.

Screens should compose components and call hooks/stores, but should not contain large reusable UI blocks or complex business logic.

### components/

Create a component only when:

- it is reused in multiple places
- it makes a screen easier to read
- it represents a clear UI concept like `MealCard`, `MacroRing`, `XPBar`, or `PrimaryButton`

Do not create tiny one-off components too early.

When unsure, ask:

> Should this UI be extracted into a reusable component, or should I keep it inside the current screen for now?

---

## UI Implementation Rules (VERY IMPORTANT)

For any UI-related task:

- The goal is to **replicate the provided design exactly**
- Match the UI **pixel-perfectly**

When the user provides a design image:

You MUST:

- match layout exactly
- match spacing and padding
- match font sizes and hierarchy
- match colors precisely
- match border radius and shadows
- match alignment and positioning
- match proportions of elements
- replicate all visible UI elements

Do not approximate. Do not simplify unless explicitly asked.

---

## Image Generation Rules

If the user enables image generation:

- Generate images that are **visually identical or extremely close** to the provided UI reference
- Do not change style, colors, or composition
- Keep consistency with the design system

After generating images:

- Place them inside the `assets/` folder
- Use clear and organized naming:

```txt
assets/images/
  onboarding-hero.png
  meal-paneer-tikka-bowl.jpg
```

Use these assets properly in the UI.

---

## Styling Rules

Use NativeWind tailwindcss classes for styling strictly. Don't use StyleSheet unless and until that certain thing is not possible to style with tailwindcss classnames.

Prioritize clean, readable mobile UI.

When building from an attached design image:

- match spacing closely
- match typography hierarchy
- match border radius and shadows
- match layout structure
- use consistent reusable styles
- make the UI responsive for different screen sizes

Prefer reusable class patterns through utilities in `global.css`. If there isn't any utility and you see a possibility, create that as a new utility in `global.css` by following BEM method.

### Colour theme

Since 2026-10-31 justFit follows the look of the "After" screen the user shared (a Home redesign
by appbrainy), app-wide, the AI Coach included: a **light grey page** with **white, borderless
cards** (20 px corners, a very soft shadow), **one accent, the logo red `#D40005`** (where the
reference used orange), near-black ink, thin progress rings with the value inside and "of target"
under, soft tinted pills (green for a gain, pink for a heart-rate or alert), photo hero cards with
an overlay label and a round play button, and a flat white tab bar. This replaced the Peak Fitness
system of 2026-10-27 and the coach-only pink wash of 2026-10-29; their token names stay.
The palette lives in `src/theme/tokens.css` with a JS copy in `src/theme/index.ts`; keep the two
in sync and never hard-code a hex value in a screen or component when a token exists. Layouts
follow screen by screen (Home first, from the reference); each is verified at 320/390/430.

| Role | Token(s) | Value |
| --- | --- | --- |
| Page background | `cream`, `background` | `#F4F4F5` |
| Cards and sheets | `surface`, `cream-light` | `#FFFFFF` (no border, `shadow-card`) |
| Filled containers: fields, tiles / tracks, empty bars | `cream-deep`, `surface-alt` / `cream-tab` | `#F4F4F5` / `#E9E9EC` |
| Borders and dividers / control outlines | `cream-line`, `line`, `sand` / `line-strong` | `#E8E8EA` / `#C9C9CF` |
| Ink: titles and body | `forest-ink`, `ink`, `leaf-dark` | `#111111` |
| Brand red: primary buttons, progress, selected, links, active tab, "today" | `forest`, `primary`, `leaf` | `#D40005` (pressed `primary-pressed` `#B00004`) |
| Text and icons on red | `on-primary` | `#FFFFFF` (5.5:1) |
| Small red text on white | `primary-text` | `#C00005` |
| Selected surface, soft red fills | `accent-soft`, `forest-soft`, `leaf-soft` | `#FDEAEA` |
| Secondary / faint text | `muted` / `faint` | `#5C5C63` / `#767680` |
| Dark hero cards and their text | `inverse` / `on-inverse`, `on-inverse-muted` | `#1C1C1E` / `#FFFFFF`, `#A1A1AA` |
| Success / danger / warning / info | `success` (`success-soft`) / `danger` / `warning` / `info`, `accent-blue` | `#2F8F57` (`#E3F6EA`) / `#D92D20` / `#C4923F` / `#4A6CF7` |
| Metric tiles: ground / icon | `tint-blue`, `tint-green`, `tint-peach`, `tint-lavender` / `icon-*` | `#E6EEFD`, `#E3F6EA`, `#FFEEDF`, `#EEE9FB` / `#3B5BDB`, `#2F8F57`, `#C25400`, `#7C5CD6` |
| Macros | `protein` / `carbs` / `fat` | `#6CC28A` / `#A9A3F0` / `#F2C14E` |

- Unlike the PDF's orange (where labels on it are dark), white text on the logo red passes AA, so
  labels and icons on red are white (`on-primary`); dark ink on red is only 3.4:1, never use it.
- `danger` (`#D92D20`) is close to the brand red: keep it for errors and destructive actions, small,
  and always with words.
- Selected chips and options: `accent-soft` fill with a red (`primary`) outline and ink text.
- Token names (`forest`, `cream`, `leaf`) come from earlier themes. They keep their roles; only the
  values changed. Use them by role, not by the colour their name suggests.
- Radius: `sm` 8, `md` 12 (fields, stat cells, thumbnails), `lg` 20 (cards, metric tiles), `xl` 24
  (dark hero card, sheets), `pill` (buttons, chips, progress bars, icon buttons).
- Elevation: cards have no border and a soft `shadow-card`; `shadow-sheet` is for floating things
  (bottom nav, mini player), `shadow-glow` only for the main play button.
- Type: Poppins 400/500/600 (`assets/fonts/`, SIL OFL), loaded in `app/_layout.tsx` from
  `constants/fonts.ts`. Each weight is its own family (`--font-sans`, `--font-sans-medium`,
  `--font-sans-semibold`; `fonts.regular|medium|semibold` in code): set the family, never
  `fontWeight` (Android would fake-bold one face); bold maps to SemiBold. Scale: display 28/36,
  title 20/28 (`type-title`), headline 16/24, subhead 15/22, body 14/22, caption 12/18, tab labels 10/14.
- Screen gutter 16 (`px-4`), 20 between sections. Home's macro card is the PDF's ActivityCard
  (`activity-card*`) with `ProgressStat` rows (`components/ProgressStat.tsx`).
- Shared pieces: `components/ProgressRing.tsx`, `list-row` (settings-style rows), `switchColors` in
  `theme/index.ts` for every `Switch` (red when on), the flat white tab bar (`BottomTabBar`), and
  the setup frame (`SetupScreen`: back chevron, dashed progress, centred title, one full-width
  action). The PDF's components (MetricCard, ProgramCard, Chip, Tabs, ProgressStat, ActivityCard,
  WorkoutStep, MiniPlayer, IconButton) are built as their screens are redesigned.

Avoid large inline styles unless required.

### Light only, motion, haptics and loading (added 2026-11-01)

The app is light only (`userInterfaceStyle: "light"`). Dark mode and the Profile › Appearance
picker were removed on 2026-11-01; don't add them back unless asked.

- **Colours come from tokens only.** `tokens.css` and `lightColors` in `theme/index.ts` hold the
  same values. Keep both lists in sync.
  - In a component, read JS colours with `const colors = useThemeColors()`.
  - Switches use `useSwitchColors()`.
- **Pick the token by role.**
  - `surface`: cards, sheets and fields.
  - `leaf`: red text, icons, rings and links.
  - `forest`/`primary`: red fills that carry white text.
  - `ink-fill`: near-black fills with white text, such as filled buttons, badges and bubbles.
  - `immersive`: full-screen dark areas, such as the player, a story or a hero.
  - `ink`: text.
  - `white` and `black`: text on red, QR codes (`black` on `white`), and things drawn on photos.
- **The logo.** `images.justfitLogo` via `BrandWordmark`. Never redraw the logo.
- **Press feedback.** Buttons and cards use `components/PressableScale.tsx`. It eases down to about 97% on the
  UI thread, has an optional `haptic`, and holds still when reduced motion is on.
  `PrimaryButton`, `CoachButton`, `IconButton`, the choice cards and chips already use it.
- **Haptics.** Use only `lib/haptics.ts`:
  - `select` for choosing an option, chip or tab.
  - `tap` for an important button.
  - `success` for a finished workout, a check-in, or a saved meal or water entry.
  - `error`, which `FormAlert` plays by itself.

  Calls are throttled and do nothing on the web.
- **HUD feedback (2026-11-08).** A short message that hides itself goes through `lib/hud.ts`
  (`hud.success("Payment recorded")`, `hud.error("Couldn't open WhatsApp")`, `hud.offline()`),
  which plays the matching haptic, so never call both. `components/Hud.tsx` draws it: a centred
  dark HUD on iPhone, a Material snackbar above the tab bar on Android and the web; it never takes
  a touch, success 1.6 s, problems 3.2 s, at most 60 characters (`lib/hudRules.ts`, unit-tested),
  read out to screen readers. `HudHost` is mounted at the root and inside `GymSheet` and
  `BottomSheet` (a Modal is its own window); only the newest host draws. `useGymSave(done,
  success?)` shows the success line; `apiFetch` shows `hud.offline()` for a write that never reached
  the server (reads stay quiet). Form errors stay inline (`FormAlert`); the HUD is for outcomes.
- **Action sheets and confirmations (2026-11-08).** Use `lib/nativeSheets.ts`, never a hand-made
  `Alert.alert` + `globalThis.confirm` pair. `confirmChoice({ title, message, confirmLabel,
  cancelLabel?, destructive? })` resolves true only on the confirm button: UIKit's action sheet
  on iPhone (destructive in red, Cancel apart, a warning buzz), Android's Material dialog, the
  browser's `confirm()` on the web; `gymPortal.confirmAction` wraps it. `showActions({ title,
  message?, actions })` lists a few actions with Cancel added: UIKit's sheet on iPhone, the app's
  `ActionSheet` bottom sheet on Android and the web (`ActionSheetHost` at the root,
  `store/actionSheet.ts`). The button list is `lib/nativeSheetRules.ts` (unit-tested). The gym
  portal's designed sheets (`MemberActionsSheet`, staff ⋯) stay as they are: they carry busy and
  error states a system sheet can't.
- **Motion for changing values (added 2026-11-02).** A figure that changes in place (calories
  left, eaten, a macro's grams) is `components/motion/AnimatedNumber.tsx`; a ring's fill or a
  bar's width follows `lib/useTween.ts`, and `ProgressRing` eases to each new value. They open on
  the real value and only animate later changes. All of it holds still with Reduce Motion on.
  - Don't swap re-keyed text with Reanimated `entering`/`exiting` for a number, and don't use
    custom `Keyframe`s for entrances: both misplace text on the web build. Use the built-in
    `FadeInDown`/`FadeIn` with `.reduceMotion(ReduceMotion.System)`.
  - Only what arrives while a screen is open gets an entrance (`lib/useNewKeys.ts`): a logged meal,
    a sent message, a reply. Key a list by its day so switching days doesn't animate.
  - A button whose label changes (Log Meal → ✓ Logged, Apply → Updated) stays one
    `PressableScale` with `layout={LinearTransition}`, its label faded in; success plays
    `haptic.success()`.
  - Coach chat: typing dots (`TypingDots`) while waiting; a reply that just arrived is written in
    word by word (`RevealText`, client-side only), and its Apply cards follow once it's whole.
- **Coach tip (Macro tab).** `lib/coachTipRules.ts` works the tip out on the phone from today's
  totals, targets and the plan's meals still to come: no AI call. Tapping it opens the chat with
  the question as `draft` (in the box, not sent).
- **Meal reminders.** `lib/mealReminders.ts`: local notifications only (expo-notifications, no push
  server, no Expo services), off until turned on in the Meal Plan screen. Today's are rescheduled
  whenever the plan is read or changes. A tap may open only `/coach/meal-plan` (checked, never
  routed as given). Sign-out clears them. The web build has none.
- **Loading.** Use `components/Skeleton.tsx` (`ScreenSkeleton`, `SkeletonCard`, `SkeletonPulse`) for a
  screen's first read. Spinners stay only inside buttons.
- **Lists.** Long vertical FlatLists spread `listPerf` from `lib/listPerf.ts`. An inverted chat
  uses `chatListPerf`.
- **Keyboard.** Scroll views with inputs use `keyboardShouldPersistTaps="handled"` and
  `keyboardDismissMode` set to "interactive" on iOS and "on-drag" on Android.
- **Text size.** Text controls use `min-height`, not `height`, so labels can grow with Dynamic
  Type. Only the tab bar caps its labels, with `maxFontSizeMultiplier` 1.3.

## NativeWind Rule

Use the NativeWind version already installed in this app.

Before implementing styling or NativeWind-related code:

- Check the current NativeWind version in `package.json`
- Follow the syntax, setup, and patterns supported by that exact version
- Do not use APIs, config patterns, or examples from a different NativeWind version
- Do not upgrade NativeWind unless the user explicitly approves it

Refer this for more info: https://www.nativewind.dev/v5/llms-full.txt

- NativeWind swaps every `"react-native"` import for its own copy, which has no `AssetRegistry`.
  `metro.config.js` lets expo-asset skip the swap; without it bundled fonts (the icon font,
  Poppins) fail to load on the phone. Restart Metro after changing `metro.config.js`.

## Icons

Import `SymbolView` from `@/components/SymbolView`, never from `expo-symbols`. Screens use SF
Symbol names (`name="envelope"`); iOS draws them natively, and the wrapper adds the Material
Symbols twin from `constants/symbols.ts` for Android and the web. A new icon name needs a line
in that map (a missing one warns in development and shows nothing on Android).

The gym portal (`app/gym/`, `components/gym/`, `data/gymDashboard.ts`) is the exception since
2026-11-04 (approved by the user): it uses Lucide (`lucide-react-native`, drawn with
react-native-svg, no native rebuild) through `components/gym/GymIcon.tsx`, never imported directly.
Icons are named by their Lucide name (`<GymIcon name="users" size={18} color={colors.gymPrimary} />`)
from the typed map in `constants/gymIcons.ts` (a new icon needs a line there); every icon has the
same 1.75 px line (`absoluteStrokeWidth`). The member app and the Super Admin keep `SymbolView`.
WhatsApp buttons (2026-11-07, the user's file) show the WhatsApp mark itself, never a line icon:
`components/gym/WhatsAppMark.tsx` draws `images.whatsappLogo` (`assets/images/whatsapp-logo.png`,
transparent corners) at the size given; the member ⋯ sheet, Send Reminder's tile, the enquiry
contact log, enquiry cards and Likely to leave cards use it.

---

## Style Exception Rules

Use `StyleSheet` or inline styles for these React Native components/scenarios instead of NativeWind/tailwindcss classes:

| Component / Scenario           | Why                                                                                      | Use Instead                           |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| **SafeAreaView**               | From `react-native` or `react-native-safe-area-context` — className not supported        | Inline styles or `StyleSheet`         |
| **Button**                     | Only supports `title` and `onPress` props — cannot customize background, border, padding | `TouchableOpacity` with custom styles |
| **KeyboardAvoidingView**       | Behavior props not supported by className                                                | Inline styles or `StyleSheet`         |
| **Modal**                      | `visible`, `transparent` props                                                           | Inline styles                         |
| **ScrollView**                 | `contentContainerStyle`, `indicatorStyle`                                                | `StyleSheet`                          |
| **TextInput**                  | Input-specific props like `underlineColorAndroid`                                        | Inline styles                         |
| **Animated.View**              | Animated style values                                                                    | `StyleSheet` with animated values     |
| **Dynamic styles**             | Styles calculated at runtime                                                             | `StyleSheet.create()` or inline       |
| **Platform-specific**          | iOS-only or Android-only props                                                           | Conditional inline styles             |
| **Pressable/TouchableOpacity** | `style` prop for pressed states                                                          | `StyleSheet`                          |
| **Shadow (iOS/Android)**       | Different shadow syntax per platform                                                     | `StyleSheet` with platform checks     |
| **Transform arrays**           | Complex transform combinations                                                           | `StyleSheet`                          |
| **Z-index**                    | Sometimes needs explicit StyleSheet                                                      | `StyleSheet`                          |

### When to Use StyleSheet

Use `StyleSheet` or inline styles when:

- The prop is React Native-specific (not web-equivalent)
- The value is dynamic/calculated at runtime
- Platform-specific behavior is needed
- NativeWind doesn't map the property to a style

### SafeAreaView Example

```tsx
// ✅ CORRECT - Use inline styles or StyleSheet
import { SafeAreaView } from "react-native-safe-area-context";

function MyScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* content */}
    </SafeAreaView>
  );
}

// ❌ INCORRECT - Do not use NativeWind/tailwindcss classes
function MyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">{/* content */}</SafeAreaView>
  );
}
```

And similar for above mentioned exception components. Otherwise, always stick to NativeWind utilities.

---

## UI Quality Bar

The app should feel:

- playful
- polished
- friendly
- mobile-first
- visually close to the provided design references

Use:

- rounded cards
- soft shadows
- clear spacing
- progress indicators
- friendly empty states
- large touch targets
- simple animations when useful

---

## Image Rule

Use centralized image imports.

Before using any image asset:

1. Check if `constants/images.ts` exists.
2. If it does not exist, create it.
3. Import and export all app images from `constants/images.ts`.
4. Use images through the centralized object.

Example:

```ts
import logo from "@/assets/images/logo.png";
import onboardingHero from "@/assets/images/onboarding-hero.png";

export const images = {
  logo,
  onboardingHero,
};
```

Use images like this,

```tsx
<Image source={images.logo} />
```

Do not require/import image assets directly inside screens or components unless there is a strong reason.

---

## data/

Use this for hardcoded app content (meals, plans, exercises, coupons and so on).

Example:

```txt
data/
  meals.ts
  plans.ts
  exercises.ts
```

All content should be typed.

---

## store/

Use Zustand stores here.

Use Zustand for:

- profile, fitness goal and nutrition targets
- cart, orders and subscription
- nutrition diary and water
- XP and streak
- current workout state
- app settings

Nothing is persisted on the device today beyond the session token (`lib/tokenStorage.ts`:
`expo-secure-store` on phones, `localStorage` on the web build). Data that must survive a
reinstall belongs in MySQL, not in AsyncStorage; the role and setup state are never cached.

---

## lib/

Use this for external service helpers.

Examples:

```txt
lib/
  api.ts        apiFetch() / getApiUrl() — the only way the app calls the Express server
  account.ts    the sign-in routes (request and verify a code, who am I, logout)
  session.ts    useSessionToken() for API calls, returnToSignIn() after a 401
  roles.ts      role helpers
  nutrition/    the target calculator (pure, unit-tested)
```

Never expose secret keys in the mobile app. Only `EXPO_PUBLIC_*` variables reach the device;
`AUTH_SECRET`, `FAST2SMS_API_KEY` and `OPENAI_API_KEY` live in `JustFit_server/.env` only.

### Calling the Express server

- Use `apiFetch()` from `lib/api.ts`. It targets `EXPO_PUBLIC_API_URL` when set, otherwise the
  computer running the Expo dev server on port 4000 (works for the simulator and a phone on the
  same Wi-Fi).
- Pass the session token (`useSessionToken()` from `lib/session.ts`) as `token` for any route that
  needs to know who is asking. On a 401, offer `returnToSignIn()`.
- Responses are JSON. Errors arrive as `{ error: "one friendly line" }` with a proper status code.

### The Express server is the whole backend

- Everything the app needs from a server lives in `JustFit_server/`: the MySQL-backed profile routes
  and the report upload read by OpenAI (`POST /api/body-composition`). The app has no Expo API
  routes; it only calls the Express server through `apiFetch()`.
- Add routes in `JustFit_server/index.js`, put `requireUser` in front of anything that isn't the health
  check, read the caller from `req.userId` (never from the body), use parameterized queries through
  `pool.query(sql, params)`, and send errors to `next(error)` so the shared handler logs them and
  answers with a safe message. Related writes go in one transaction (see `persistProfile` in `profile.js`).
- Every authenticated route is rate limited per verified user: `limitPerUser` from
  `rateLimit.js`, placed right after `requireUser`. The budgets are in-memory, per process, and reset
  on restart: not a multi-instance defence. Bodies are parsed per route, after the caller is verified,
  with the limit the route needs: `express.json({ limit })` for small JSON, `jsonBodyWithLimit` from
  `requestBody.js` for the upload route (it refuses an oversized body while it is still arriving).
- `JustFit_server/.env` needs `AUTH_SECRET` (32+ random characters; keys the code hashes and the member
  passes), `SMS_PROVIDER` (`off` until Fast2SMS is verified, then `fast2sms` with `FAST2SMS_*`) and
  `OPENAI_API_KEY` (report reading, Scan Food and the AI Coach). Never commit any `.env`.

---

## State Management Rules

Use Zustand for global client state.

Use local state for temporary UI state.

Anything that must outlive the session goes to the server (MySQL), not to device storage.

---

## TypeScript Rules

Use TypeScript strictly.

Avoid `any`.

Keep types simple and readable.

---

## Feature Implementation Rules

When the user asks to build a feature:

1. Read this file first.
2. Identify files to change.
3. Keep changes focused.
4. Do not rewrite unrelated code.
5. Follow existing patterns.
6. Ensure feature works end-to-end.
7. Fix errors before finishing.

---

## justFit Development Rules

These rules apply to every future implementation, in both `JustFit_client/` and `JustFit_server/`.

1. **One screen at a time.** Implement only one approved screen or feature at a time. Inspect existing code before making changes.
2. **Test after every implementation.** Run TypeScript checks, Expo lint, relevant unit tests, and regression tests.
3. **Fix before proceeding.** Resolve implementation-related failures and rerun the affected checks before declaring completion.
4. **Check the UI.** Verify navigation, buttons, forms, loading, empty, error and success states, responsive layout, safe areas, and keyboard behavior as applicable.
5. **Check backend changes.** Verify authentication, authorization, input validation, API responses, database writes and rollback behavior when applicable.
6. **Protect existing work.** Do not break onboarding, phone sign-in, existing navigation, or working features. Do not introduce unrelated changes.
7. **Be honest about testing.** Report automated tests, manual tests actually completed, and checks that still require the user's action. Never claim unexecuted tests passed.
8. **Report every implementation.** List changed files, commands executed, results, remaining issues and manual checks.
9. **Approval required.** After each approved screen or feature is implemented and verified, provide the completion report and stop. Wait for the user's approval before starting the next screen, feature, phase, or any individual finding from an audit.
10. **Database safety.** Never drop tables, delete existing data, change database permissions, modify the schema, or create persistent test data without the user's approval.
11. **Security.** Never expose secrets, trust client-supplied identity or roles, or bypass existing authentication.
12. **Keep instructions updated.** Preserve the current justFit architecture and existing project rules. Do not overwrite useful instructions.
13. **Design source of truth.** `src/theme/tokens.css`, `src/theme/index.ts` and the utilities in `src/global.css` define justFit's look, following the 2026-10-25 redesign brief (premium minimal iOS style, see "Colour theme" above). The older mockups under `assets/design/` show earlier colours and some earlier compositions; use them only for content and flow. Do not introduce a further visual direction; when a screen and the design system disagree, report the discrepancy and ask before changing the composition.
14. **Test isolation.** UI and integration tests use the `justfit_test` database through `JustFit_server/.env.test` and the test server on port 4100. Never point tests at port 4000 or the `justfit` database. Run `npm test`, `npm run test:e2e` and `npm run test:ui` in `JustFit_server/` as relevant.
15. **Visual evidence.** After each approved UI change, capture screenshots at the supported widths with the existing test harness and include their paths in the report.
16. **Git.** Never commit, push, amend, rewrite history, reset, stash or discard work without explicit approval. Review the staged diff before any commit. Keep `.env` files and generated artifacts out of commits.
17. **Audits are checklists.** An audit report authorises nothing. Each finding is implemented only after its own approval, one at a time, following inspect, implement, test, review the diff, verify at supported sizes, report, wait.
18. **Secure by default.** Every feature, bug fix, refactor, endpoint, schema change and integration also follows the justFit Secure Development Rules below.

---

## justFit Secure Development Rules

These rules supplement the justFit Development Rules above (they replace nothing) and apply to every
change in both `JustFit_client/` and `JustFit_server/`. Security is never guaranteed: report what was
confirmed, what remains a risk, and what was not tested.

### 1. Security-by-design workflow

Before implementing:

- List the screens, API routes, database tables, files, roles (`user`, `admin`) and
  sensitive data (health data, contact details, tokens) the change touches.
- For each resource, say who may read, create, update and delete it, and enforce that server-side.
- Name the attack paths that apply (missing or forged auth, wrong role, another user's id, bad or
  oversized input, SQL injection, abuse of an expensive call) and the tests that will cover them.
- Keep existing behaviour and contracts unless the approved change requires otherwise.

While implementing:

- Apply the rules below to all new and modified code. Reuse the existing secure helpers:
  `requireUser` and `getAccount` (`JustFit_server/auth.js`), `ValidationError` and the validators in
  `profile.js`, `logRequestError` (`logging.js`), `checkUpload` (`bodyComposition/upload.js`),
  `jsonBodyWithLimit` (`requestBody.js`), `limitPerUser` and `limitPerIp` (`rateLimit.js`), `securityHeaders` and
  `corsOptions` (`httpSecurity.js`), `logSecurityEvent` (`logging.js`), and the test harness
  under `JustFit_server/__tests__/`.
- Never disable, loosen or skip a security check to make a test pass.
- Never treat client-side validation, a hidden screen, a client-supplied role or user id, or
  anything the app stores as authorisation. They are hints for the UI only.

Before declaring completion:

- Add regression tests for the normal behaviour and for the attack paths named above.
- Run the focused tests, then the existing suites (`npm test`, `npm run test:e2e`,
  `npm run test:ui` in `JustFit_server/`; `npm test`, `npm run typecheck`, `npm run lint` in `JustFit_client/`).
- Inspect the complete diff for security regressions, accidental secrets, unrelated changes and
  unsafe configuration.
- Report untested scenarios honestly.

### 2. Authentication and authorisation

- Every protected endpoint verifies the session token server-side (`requireUser`); identity
  is the session's user (`req.userId`), never a request field.
- Enforce role and resource-level permissions server-side for `user` and `admin`. Roles come
  from `users.role`, read with `getAccount` (`requireAdmin`) on every call.
- Prevent privilege escalation, insecure direct object references and cross-user data access:
  every query that returns or changes a user's rows is scoped to the verified user id.
- Never grant a privileged role from client-writable metadata alone.
- Validate webhook signatures before trusting any webhook payload.
- Expired sessions and auth failures answer with a safe 401 and the app offers sign-in again.

### 3. SQL injection and database safety

- Parameterised queries (`pool.query(sql, params)`) for every value. Never concatenate untrusted
  input into SQL.
- Table names, column names, sort directions and other fragments that cannot be parameterised
  come from an allowlist in code, never from the request.
- Validate on the server and rely on the schema's constraints (ENUM, CHECK, UNIQUE, FOREIGN KEY);
  multi-table writes go in one transaction with rollback.
- The app runs as the least-privilege account (`justfit_app`), never as MySQL root. Production
  (`justfit`), development and test (`justfit_test`) databases stay separate; tests never run
  destructive queries against production.
- Add tests with SQL-injection payloads and unauthorised-access attempts where a query takes
  user input or returns user-owned rows.

### 4. API and resource protection

- Validate bodies, query parameters, route parameters and unexpected fields; reject what is not
  expected with a 400 and one friendly line.
- Rate limit authentication-sensitive, expensive and abuse-prone endpoints per verified user
  (`JustFit_server/rateLimit.js`); AI and other paid calls are never unlimited.
- Enforce request-body, upload, processing and pagination limits. Reject an oversized request
  before expensive parsing or processing where the runtime permits (`jsonBodyWithLimit` for large
  bodies, `express.json({ limit })` for small ones, both per route and after `requireUser`).
- CORS is as restrictive as the deployment allows; add security headers and keep error responses
  safe. Never expose stack traces, SQL, credentials or personal data in a response.

### 5. Files and secrets

- Validate uploaded content by its real bytes (`checkUpload`), the allowed types, the size, the
  filename and the owner; uploads are never stored without approval, and private files are never
  served publicly.
- `AUTH_SECRET`, the SMS provider key, database credentials and provider keys stay server-side (`JustFit_server/.env`).
  `EXPO_PUBLIC_*` variables are public.
- Never print or commit a secret value. Logs carry no tokens, bodies, headers or personal data
  (`logging.js`).
- Add no unnecessary dependency and no insecure storage.

### 6. Testing requirements

For every relevant feature, test: the expected authorised behaviour; missing, malformed, expired
and invalid authentication; wrong-role access and unauthorised ownership; invalid, unexpected or
malicious input; SQL-injection and resource-abuse cases that apply; regression behaviour and data
integrity. Use only `justfit_test`, `.env.test` and the test server on port 4100, with throwaway
test accounts (`__tests__/e2e/test-identities.js`) that are deleted afterwards, and the fake SMS
provider. Never use production accounts or data, and never send a real SMS from a test.

### 7. Git, production and approval safeguards

- Preserve existing modified and untracked files. No commit, push, reset, stash or discard without
  explicit approval.
- No change to production credentials, database permissions, sign-in or SMS configuration
  (`AUTH_SECRET`, `SMS_PROVIDER`, `FAST2SMS_*`, `OTP_*`, `TRUST_PROXY`), or deployment settings without approval.
- Never stop, restart or interfere with the development server on port 4000.
- Report confirmed findings, potential risks and untested areas; never claim security is guaranteed.

### 8. The pre-launch security pass: run it on every prompt (added 2026-10-31)

The user's standing instruction: every prompt that implements or changes something is checked
against this 27-point pass before it is reported done, and the report says which points applied
and what was confirmed. Suggest the fix when a point fails; don't wait to be asked. Points that
cannot apply (no cookies, no passwords, no payments) are still named as "not applicable", not
skipped silently. Where justFit already meets a point, keep it that way.

| # | Point | Where justFit meets it today |
|---|-------|------------------------------|
| 1 | Proper authentication | phone OTP, hashed tokens in `auth_sessions`, `requireUser` on every protected route |
| 2 | Hide API keys | all provider keys in `JustFit_server/.env` only; nothing secret in `EXPO_PUBLIC_*` |
| 3 | Secure the database | `justfit_app` least privilege, every user-owned query scoped by `req.userId` |
| 4 | HTTPS everywhere | Caddy on the droplet; HSTS from `httpSecurity.js` over HTTPS; `requireHttpsInRelease` in `lib/apiHost.ts` refuses a plain-HTTP server in a release build |
| 5 | Hash all passwords | no passwords: codes HMAC-hashed (`auth/otp.js`), session tokens SHA-256 (`auth/sessions.js`) |
| 6 | Validate forms on the server | `ValidationError` + the `*/validate.js` and `*/rules.js` modules; the app's checks are hints only |
| 7 | Block XSS | JSON only, no HTML rendering in the app; uploads type-sniffed; `nosniff` + CSP `default-src 'none'` on every answer |
| 8 | Log and monitor suspicious activity | `logRequestError` (safe fields) and `logSecurityEvent` (`otp.locked`, `otp.throttled`, `admin.denied`, `rate.limited`); `admin_audit_log` for admin actions |
| 9 | Lock down admin routes | `requireAdmin` reads `users.role` on every call |
| 10 | Parameterised queries | `pool.query(sql, params)`; SQL fragments only from allowlists in code |
| 11 | Check environment variables | startup refuses a missing DB setting or short `AUTH_SECRET`, dev login outside development; warns without `OPENAI_API_KEY` |
| 12 | Rate limiting | `limitPerUser` on every signed-in group, `limitPerIp` + per-number limits on sign-in |
| 13 | Restrict CORS | `corsOptions`: `CORS_ORIGINS` allowlist, none in production, any in development/tests |
| 14 | Security headers | `securityHeaders`: nosniff, DENY framing, CSP, no-referrer, no-store, Permissions-Policy, HSTS |
| 15 | Secure session cookies | not applicable: bearer token in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), never a cookie |
| 16 | CSRF protection | not applicable without cookies; Meta webhook checks `X-Hub-Signature-256` |
| 17 | Expiring reset links | codes last 5 minutes, single use, 5 attempts; sessions 30 days, revocable |
| 18 | Restrict uploads | `checkUpload` / `checkCover` sniff real bytes, allowed types, byte and size caps; bodies capped before parsing; program covers admin-only, 30 an hour |
| 19 | Verify prices and payments | not applicable: no checkout |
| 20 | No production debug mode | `x-powered-by` off, generic 500s, `DEV_LOGIN_*` refused outside development, `NODE_ENV=production` on the droplet |
| 21 | Update vulnerable dependencies | `npm audit` in both folders before a release; server at 0 |
| 22 | Remove unused packages | compare `package.json` with imports before a release; native modules need a prebuild to remove |
| 23 | No exposed files | no `express.static`; member photos and reports are read in memory, never stored; the only stored files are admin program covers, served by id through signed-in routes (published only for members) from names the server made, never a path from the request; every `.env` and `uploads/` git-ignored |
| 24 | Scan Git history for secrets | `git log -p` grep before pushing; only test placeholders so far |
| 25 | Revoke compromised keys | any key shown in a chat, a log or a screenshot is rotated, never reused |
| 26 | Full security review | this section plus sections 1-7, on the whole diff |
| 27 | Test and report | unit + e2e + UI suites green, and the report lists each point's status |

---

## AI / Stream / Vision Agent Rules

Use backend/serverless for:

- Stream tokens
- AI calls
- Vision Agent (AI video coach) sessions

Never expose secrets in the frontend.

### AI cost rules (added 2026-10-31)

Every OpenAI call goes through the small services in `JustFit_server/ai/`, and new AI work must too:

- `ai/models.js` picks the model and the output cap per feature. Defaults: gpt-4.1-mini for the
  coach's chat, plans and meal swaps, Scan Food and report reading. `AI_MODEL_<FEATURE>` /
  `AI_MAX_OUTPUT_<FEATURE>` override one feature; the old `OPENAI_MODEL` still works below them. Never hard-code a model id or `new OpenAI()`
  in a feature: use `settingsFor(feature).request` and `openaiClient()`. A model needs a row in
  `ai_model_prices` (official list prices, with the cached-input price) or its calls cost ₹0 on
  the dashboard. The server logs the routing at startup.
- `ai/limits.js` runs before every paid call (after validation, so a 400 costs nothing): the
  monthly budget as a hard stop, `AI_LIMIT_PER_MINUTE` (12), `AI_LIMIT_PER_DAY` (150),
  `AI_PLAN_LIMIT_PER_DAY` (3). A refusal is a friendly 429/503 the app shows as it is.
- `ai/dedupe.js` answers an identical in-flight request once (a double tap, two screens); the
  app also disables buttons while a call runs.
- `ai/cache.js` is a small answer cache keyed by a hash of everything an answer depends on. Its
  only user, the gym assistant, was removed on 2026-11-01; nothing personal to a member may be cached.
- Prompts stay small: the chat shows the model the newest 10 turns within 4,000 characters
  (`chatRules.modelHistory`), a meal swap sends the member's food facts and the one meal
  (`POST /api/coach/plan/meals/:id/swap`, feature `coach_meal`).
  Arithmetic (targets, scaling, totals, workouts) stays in code, never in a prompt.
- Admin › Exercises (added 2026-11-01, `JustFit_server/admin/exercises.js` + `exerciseRules.js`,
  screens under `src/app/admin/exercises/`) lists every library exercise with its video state; "Add
  with AI" (feature `exercise_library`, one call for up to 20) writes new exercises, which are
  cleaned, de-duplicated by `exerciseKey` and go live at once. Migration
  `2026-11-07-exercise-library-admin.sql` adds `ai_drafted`, `video_key`, `video_uploaded_at`.
- The workout week is written by the AI (added 2026-11-01, `JustFit_server/workout/aiPlan.js`,
  feature `coach_workout`) for every plan path (coach plan, chat workout change, Preferences,
  Rebuild, first plan). The server keeps: library exercises only, one entry per chosen day, no
  high-risk moves after a serious injury, low-impact only for heavier bodies, bounded numbers.
  The engine still sets level, calibration and the review flag, and its week is stored whenever
  the AI is unconfigured, over a limit, failing or unusable (`engine_version` empty and
  `calibration.writtenBy = "ai"` mark the AI's weeks). The AI call runs before the member lock.
- Workout › At home / At center (added 2026-11-02, `JustFit_server/workout/place.js`, `POST
  /api/workout/place`, feature `workout_place`): today's session can switch to the place the plan
  wasn't written for (the coach intake's main spot: gym = center, else home). The other place
  gets an adapted day (`workout_days.variant_of` + `place`, kept and reused, run through an
  override); the AI swaps exercises the place's equipment can't do, else the same-movement swap.
  Plan-level day lists skip adapted days (`planDaysOnly`). Migration `2026-11-08-workout-place.sql`.
- The Fitness tab (added 2026-11-02; the Workout tab relabelled, route still `/workout`): a fixed
  `FitnessHeader` (AT HOME default / AT CENTER, location sheet, search), today's session and week,
  six sections of free programs (`FitnessCategorySection` > `ProgramCarousel` > `FitnessProgramCard`,
  gradient `ProgramArt`, or the admin's cover photo when one is set; colours are `programGradients` tokens;
  since 2026-11-03 a card with a cover is the photo alone (covers carry their own title), others keep the
  level pill, title and meta; each section's See All opens `app/(user)/fitness/category/[id].tsx`, a
  two-column grid of that category. A program's page shows its own page photo (`hero_key`, Admin ›
  Programs › Program page photo, `/hero` routes beside `/cover`; migration `2026-11-16-program-hero.sql`)
  with nothing written on it, never the card's cover, then an info strip (sessions, minutes, place and kit)), then
  History. Programs: `fitness_programs` / `_sessions` / `_exercises` (no cascades), seeded from
  `src/lib/fitness/catalog.ts` (also the offline fallback), served by `JustFit_server/fitness/`.
  Since 2026-11-03 a program's sessions are only the admin's YouTube video sessions (shown under
  Follow along; "Coming soon" until it has one). The old exercise sessions stay in the table, hidden
  (members' past `workout_days.program_session_id` point at them); Do this today, Create with AI and
  Rewrite with AI were removed. Admin › Programs edits, hides and creates programs. No premium,
  prices or locks.
  Covers (2026-11-02): the edit screen's preview card has a camera button (Add cover), then a
  pencil (Replace photo / Remove cover). `PUT|DELETE|GET /api/admin/portal/programs/:id/cover`,
  members read `GET /api/fitness/programs/:id/cover` (published only); `coverUrl` carries `?v=`.
  Files on the server's disk in `COVER_DIR` (default `JustFit_server/uploads/program-covers`,
  git-ignored; back it up with the droplet), checked by `fitness/covers.js` (JPEG/PNG/WebP from the
  bytes, max 2 MB, 320×180 to 6000 a side); a replace writes the new file first and deletes the old
  one after the switch. Migration `2026-11-12-program-covers.sql`.
  Categories (2026-11-02): the Fitness tab's sections are rows of `fitness_sections` (six built in,
  seeded by `fitness/sections.js` and the migration; the admin can rename, reorder, hide them but
  never delete them). Admin › Programs › Categories: New category (name, line, Posters / Tiles /
  Wide cards, shown), arrows to reorder, edit, Delete only for an admin-made category with no
  programs (the foreign key from `fitness_programs.section` refuses it too). A program's Category
  chips come from the list (with a New category link). Members get each section's `layout` and each
  card's `sectionTitle`; a hidden category's programs leave the tab and its search. The app's
  built-in six (`lib/fitness/catalog.ts`) are only the offline fallback. Routes
  `/api/admin/portal/sections` (GET, POST, PATCH/DELETE `/:slug`, POST `/:slug/move`); audit target
  `section`. Migration `2026-11-13-fitness-categories.sql`.
  Migration `2026-11-09-fitness-programs.sql` (also adds `workout_profiles.home_equipment` /
  `center_equipment` for the location sheet).
- `ai/usage.js` records every call with `cached_input_tokens` and `from_cache`; the admin's AI
  Usage screen shows cached tokens, cache hits, cost per call per feature and the top members.
  Migration `2026-11-04-ai-cost-optimization.sql` (run once, after the 2026-11-03 one) adds the
  columns and the price rows; until it runs, rows are written the old way and the admin screen
  answers 503 naming it.


### AI Coach: Indian fitness personalisation (added 2026-11-01)

The AI Coach must be genuinely useful to Indian clients, not a Western coach with an Indian name.
It treats every member as an Indian client by default and:

- **Understands the client:** Indian lifestyles, body types, work, college and shift routines and
  activity levels; talks in natural, friendly, supportive English; uses kg, cm, km and kcal.
- **Knows Indian food:** recommends Indian meals by default (South Indian, North Indian and other
  regional cuisines: idli, dosa, rice, roti, chapati, dal, sambar, rasam, curd, paneer, poha, upma,
  traditional thalis), vegetarian and non-vegetarian; realistic, affordable meals from locally
  available ingredients; calories and macros from the actual ingredients and portions. It never
  assumes oats, salads or Western foods are eaten regularly, and never assumes religious, cultural
  or regional preferences beyond what the member told it.
- **Coaches for Indian conditions:** workouts that fit a typical Indian gym or a home; realistic
  plans for muscle gain, fat loss, strength and general fitness; heat, humidity and hydration where
  they matter; safe, evidence-based advice with no crash diets or promised transformations.
- **Talks like a real trainer:** motivating, respectful, approachable and professional; relatable
  Indian examples; adapts to the member's preferences, goals, budget and lifestyle; never robotic.

Where it lives: `coach/chatRules.js` (`chatInstructions`, and `memberBrief` carries cuisines,
cooking time and budget) and `coach/planRules.js` (`INDIAN_FOOD`, shared by the day plan, the meal
swap and the five swap options). Any new coach prompt uses the same text rather than its own wording,
and `__tests__/coach-chat.test.js` / `coach-cost-rules.test.js` pin it. Keep these lines short: they
are sent on every call (see the cost rules above).

---

## Sign-in Rules

Phone sign-in replaced Clerk on 2026-10-29 (approved; plan and audit in `AUTH-MIGRATION-PLAN.md`
and `AUTH-MIGRATION-AUDIT.md` at the repo root). Keep these rules:

- One flow for everyone: a 10-digit Indian mobile number (stored as 10 digits, shown as +91) and a
  6-digit code. A number with no account gets a new account with role `user` when its code is
  verified. Nothing in the app or the request can pick a role; the only role a sign-in can bring
  is a gym's invite for that very number (Staff / Admin Login), applied in the same transaction.
- Codes: `crypto.randomInt`, stored only as an HMAC (`AUTH_SECRET`, HKDF label `justfit-otp-code`)
  bound to the challenge id; 5 minutes; 5 wrong tries lock the code; a new code supersedes the old.
  Sends are limited per number (60 s cooldown, 5 an hour, 10 a day), per IP, and in total per day
  (`OTP_*` in `.env`); one send at a time per number (MySQL named lock). Verifying locks the code row
  (`FOR UPDATE`) and consumes it in the same transaction that signs in, so a code works once.
- Sessions: 256-bit random tokens (`jfs_…`), only their SHA-256 stored (`auth_sessions`), 30 days,
  revocable (logout, logout-all, account deletion). Times come from the database clock (`NOW()`).
- Never log or return a phone number, code, token or provider key; provider errors are reduced to
  their status code. The request-otp answer never says whether an account exists.
- `SMS_PROVIDER`: `off` (default; sign-in answers 503), `fake` (tests only; refused unless
  `NODE_ENV=test` and `DB_NAME=justfit_test`), `fast2sms` (only after a real code has been verified on a
  real phone). The Fast2SMS key is never used for signing anything.
- The development code (`DEV_LOGIN_PHONE` + `DEV_LOGIN_CODE`, `auth/devLogin.js`; the server refuses
  it outside `NODE_ENV=development` on `justfit` or tests) is taken by its listed numbers and, since
  2026-11-06 (the user's request), by every number a gym has added as Staff or Trainer (an invite in
  `gym_staff_invites` or a `gym_staff` member, `isGymTeamPhone` in `auth/service.js`), so a tester's
  phone can join a gym without an SMS provider. Still hashed, 5 tries, once, inside the limits.
- The app keeps only the token, never the role or setup state: at launch it asks `GET /api/auth/me`;
  a 401 forgets the token, any other failure keeps it and offers Try again.
- Phone accounts have no email (no email is ever verified).
- Behind a reverse proxy set `TRUST_PROXY` (a hop count or proxy addresses, never `true`), or every
  request shares one IP budget.

---

## Content Rules

Static UI content (option lists, onboarding slides, dashboard tiles) stays in typed files under `data/`.

Anything users create or that changes over time (meals on the menu, orders, the diary, weigh-ins)
belongs in MySQL. The tables already exist in `JustFit_server/schema.sql`; do not change the schema or
the database contents without asking first.

### YouTube videos (added 2026-11-03)

YouTube videos belong to a program's sessions (2026-11-03; the program-level link, playlists, Follow
along and per-video ticks were dropped). In Admin › Programs › a program the admin adds sessions with a
title, minutes and one YouTube video link, edits, reorders and deletes them (`ProgramSessions`,
`/api/admin/portal/programs/:id/sessions`, migration `2026-11-17-session-videos.sql`). Videos are
embedded links only: never an uploaded video file. Every session has a video and nothing else
(`JustFit_server/fitness/youtube.js` reads each video's creator for the credit). The
user asked for this to be done the legal way only, so these rules stand for every change near it:

- Videos play only in YouTube's own embedded player, unchanged: never hide, skip or block its
  ads, branding or controls, and never download, re-host or extract the videos or their audio.
- Programs with YouTube videos stay free: never put them behind Pro or any payment.
- Data from the YouTube Data API (titles, lengths, the channel) is refreshed before 25 days and is
  never shown or kept past 30 (`fitness/youtubeRefresh.js`). Only the server holds `YOUTUBE_API_KEY`.
- The creator is credited under the player ("Videos by … on YouTube, not made by justFit"), with
  links to the YouTube Terms of Service and the Google Privacy Policy. Never present the videos as
  justFit's own. The privacy policy must say the app uses YouTube API Services.
- Ask each creator whose playlist is used for permission before launch (the user's call).

---

## Code Simplicity Rules

Avoid overengineering.

Refactor only when needed.

---

## Component Creation Rule

Only create reusable components when necessary.

Ask if unsure.

---

## Linting and Validation

Run in `JustFit_client/`:

```bash
npm run lint
npm run typecheck
npm test
```

Then confirm the server still starts and reports a connected database:

```bash
cd ../JustFit_server && yarn start        # in another terminal
curl http://localhost:4000/api/health  # → {"ok":true,"database":"connected"}
```

If `yarn` is not on the PATH, `npx yarn@1 <command>` is equivalent.

Fix errors.

---

## Communication Style

Be concise.

Explain what changed and how to test.

---

## Important Constraints

- Identity, sessions and roles live in MySQL behind the Express server (phone sign-in, see "Sign-in Rules").
- App data lives in MySQL behind the Express server. Static content lives in `data/`.
- Secrets stay on the server side (`JustFit_server/.env`). Never print or commit them.
- Do not change `schema.sql`, the live database, or the role model without approval.

---

## Final Reminder

Before every feature implementation:

- Read this file
- Follow it strictly, including the justFit Development Rules and the justFit Secure Development Rules above
- Build clean, simple, teachable code
- Replicate UI exactly when designs are provided

---

# Expo Platform Notes

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building locally (no Expo services, decided 2026-10-27)

justFit does not use Expo's cloud: no EAS Build, Submit or Update, no Expo account link (`owner` and
`extra.eas.projectId` were removed from `app.json`, and `eas.json` was deleted), and no Expo Go.
Expo stays only as the open-source libraries and CLI inside the app. Do not suggest or add EAS.

- Develop: `npm run android` / `npm run ios` (`expo run:*`) builds the app on this Mac and loads the
  screens from the local dev server (`npm start`). Only native changes (a new native library, a
  permission, the icon, the app id) need a rebuild.
- Release APK: `npm run build:android` (prebuild, then `./gradlew assembleRelease`); the file is
  `android/app/build/outputs/apk/release/app-release.apk`. Set `EXPO_PUBLIC_API_URL` (the hosted
  server) before building, or a release build looks for the server on `localhost`. Needs
  `ANDROID_HOME=$HOME/Library/Android/sdk`.
- Play Store: the generated release build is signed with the debug key. Publishing needs your own
  upload keystore (kept out of git) and `./gradlew bundleRelease` for the `.aab`.
- iPhone: Xcode on this Mac (`npm run ios`, then Archive in Xcode); the App Store still needs the
  Apple Developer account.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- After adding a library with native code, rebuild the app locally with `npx expo run:ios|android` (Expo Go and EAS are not used).
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
