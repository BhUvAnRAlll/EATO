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
- **AI Coach**: intake (9 steps) → the Coach tab (hero, today's overview from Macro, today's plan as a timeline of meals to log and today's workout, Week and Insights tabs) and the coach chat are built; daily follow-ups, weekly check-ins, Insights and the video coach are planned
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
| Roles (`user`, `admin`) | MySQL `users.role`, read on every request; new accounts are always `user`; only `npm run set-role -- <phone> <role>` in `JustFit_server` changes it | The app can't promote itself |
| Reading an uploaded body composition report (removed from the app's setup on 2026-10-25; the server route is still there, unused) | `POST /api/body-composition` on the Express server → OpenAI (`JustFit_server/bodyComposition/`) | Keeps `OPENAI_API_KEY` off the device; the file is never stored |
| Estimating body fat % from a front and a side photo (optional Body composition step `setup/body-composition.tsx`: Scan Body → `setup/scan-guide.tsx`: the instruction video only (`assets/videos/scan-instructions.mp4` via `constants/videos.ts`, played with `expo-video`, added 2026-10-25; autoplays on a loop with no controls, with sound on phones and muted on the web) and the privacy note. The written tips and pose drawings were removed at the user's request → `setup/body-scan.tsx` → the body composition report `setup/scan-report.tsx` (animated graphs in `components/setup/ReportGraphs.tsx` and `SegmentalChart.tsx`; graph ranges in `lib/bodyScanRules.ts`). The report lives in the setup store only (not saved yet), shows no model or technical wording, offers no download, and allows screenshots and screen recordings (the block added earlier on 2026-10-25 was removed at the user's request the same day; `lib/screenProtection.ts` and `expo-screen-capture` stay for reuse, unused. On iOS that block moves the whole app window into a secure layer, so never switch it on over the photo picker or mid-transition). There is no typed body fat field. After setup, Profile › Body composition › Scan Body runs the same screens with `?from=profile` (`lib/profileScan.ts`, pure and unit-tested): the report's Save to my profile shows the change, then on confirm saves through `POST /api/profile` with the targets recalculated; a user-entered target is kept) | `POST /api/body-composition/scan` on the Express server → the Forma scan server at `FORMA_SCAN_URL` (`JustFit_server/bodyComposition/scan.js`; a separate process, `Forma_BodyFat/forma_server.py`) | Photos pass through in memory and are never stored or logged; the answer is an estimate the user accepts as their body fat % (saved like a typed value, no `'scan'` report source yet). Forma's model is not validated against DEXA or InBody and the screen says so |
| Scan food in the Macro tab (Log food › Scan Food, `app/(user)/macro/scan.tsx`, added 2026-10-25): one photo plus an optional note → an editable estimate per food (kcal, protein, carbs, fat) → logged through `POST /api/macro/meals` as a `manual` meal (the `source` ENUM has no `scan` value) | `POST /api/macro/scan` on the Express server → OpenAI (`JustFit_server/macro/foodScan.js`, model from `ai/models.js` (`AI_MODEL_FOOD_SCAN`, default gpt-4.1-mini); photos only, upload rate budget; tests use `AI_PROVIDER=fake`) | Keeps `OPENAI_API_KEY` off the device; the photo is never stored or logged and scanning writes nothing |
| AI Coach (Coach tab, added 2026-10-26/27): the intake (`app/(user)/coach/intake/*`, 9 steps, saved once at the end with the "not medical advice" tick) and the plan. Make my plan → the workout from the existing engine (`workout/plans.js` `planFromCoach`: the intake's goal, level and days saved as the member's workout answers; the library narrowed by the main spot's equipment, high-risk lifts left out for joints or conditions; days trimmed to the session length, see `coach/planRules.js`), and one day of five Indian meals from OpenAI scaled to the member's `nutrition_targets`. Each meal logs once a day to Macro (`source = 'plan'`, `plan_log_key`) | `/api/coach/intake` and `/api/coach/plan` on the Express server (`JustFit_server/coach/`; tables `coach_profiles`, `coach_plans`, `coach_plan_meals`, `coach_plan_meal_items`, migrations `2026-10-30-coach-intake.sql` and `2026-10-31-coach-plans.sql`; making a plan is limited to 5 an hour per member; tests use `AI_PROVIDER=fake`) | Keeps `OPENAI_API_KEY` off the device; the exercises stay deterministic and from the library, and the model only writes the meals and the coach's note, which the server cleans and scales |
| Coach chat (2026-10-30): the Coach tab's ask box and quick questions open `app/(user)/coach/chat.tsx`; the conversation lives only in `store/coachChat.ts` (cleared on sign-out, and when the coach changes) and the last 20 lines are sent each time. The tab's Change button (`components/coach/ChangeCoachSheet.tsx`) switches coach and style through `PUT /api/coach/intake/coach`, keeping every other answer; coach photos are face crops in `assets/images/coach-<id>-face.jpg`, drawn by `CoachAvatar` (a coach without one shows their initial) | `POST /api/coach/chat` (`JustFit_server/coach/chat.js`, pure rules in `chatRules.js`): the server adds the member's intake, targets, today's Macro totals and plan, asks OpenAI for a short reply in the coach's style; 30 messages an hour per member, 32 kb body; tests use `AI_PROVIDER=fake` | Nothing is stored or logged; identity only from the session; the model is told to give fitness guidance, not medical advice |
| AI usage and cost (Admin › Profile › AI Usage, 2026-10-30): `app/admin/profile.tsx` (the admin's profile and Sign out, opened from the Overview's header) → `app/admin/ai-usage/index.tsx` (all-time cards, the monthly budget, a day / 7 days / 30 days period with charts, by-feature and by-model breakdowns, one section per AI area), `history.tsx` (every call, search, filters, sort, 25 a page) and `budget.tsx` (the limit, alerts at 50 / 75 / 90 / 100 % and on a spike, acknowledging). Labels in `data/aiUsage.ts`, calls in `lib/aiUsage.ts`, charts are plain views (`components/admin/BarChart.tsx`) | `/api/admin/portal/ai-usage/*` (`JustFit_server/admin/aiUsage.js`, pure rules in `ai/rules.js`). Every AI module records each call through `ai/usage.tracker` (`ai/usage.js`): tables `ai_usage`, `ai_model_prices`, `ai_budget`, `ai_budget_alerts` (migration `2026-11-03-ai-usage.sql`); the recorder never throws and does nothing until the migration has run. Costs are in rupees: the model's dollar price (`ai_model_prices`, as OpenAI quotes it) at the exchange rate in `ai_budget.usd_to_inr` (editable on the budget screen, default ₹84) when the call is recorded | Admin-only on the server; a row holds who, feature, model, tokens, cost and outcome, never a prompt, photo or reply. Reaching the budget alerts and, unless `AI_BUDGET_HARD_STOP=off`, pauses every AI call for the rest of the month with a friendly message (`ai/limits.js`, 2026-10-31) |
| Profile and nutrition targets from setup | MySQL (`users`, `profiles`, `nutrition_targets`, `body_composition_reports`) via `POST /api/profile` and `GET /api/profile` on the Express server; `profiles.profile_complete` (returned by `/api/auth/me`) decides where the app opens | Server-verified identity, one transaction per save, the app's own calculator re-checks every record before it is stored |
| App data (meals, orders, diary, weigh-ins) | MySQL via the Express server (`JustFit_server/`) | Shared, queryable data that outlives one device |

Every Express route except the health check and the two sign-in routes verifies the caller's session token with `requireUser` (`JustFit_server/auth.js`) before doing anything. The sign-in routes are budgeted per IP address and per phone number instead.

### Community and gyms: removed (2026-11-01)

The user asked for Community to go completely, gyms included, and for Workout to take its tab.
Gone from the app, the server and (once `JustFit_server/migrations/2026-11-06-remove-community.sql`
has run) the database: the feed, posts, comments, likes, polls, stories, friends, follows, blocks,
direct messages, community profiles and moderation (Admin › Reports, suspensions); gyms, their
members, invitations, announcements, events and QR codes; the gym owner portal (`app/owner/`,
`/api/owner`), member passes and QR attendance (`/my-qr`), gym notices and the bell's gym items; the
WhatsApp gym agent (`/api/whatsapp`, the job worker) and Admin › Gyms; the `/api/media` uploads.
Groups, Challenges and Trainers had already gone. Do not rebuild any of it unless the user asks.

- The Super Admin portal's tabs are Overview · Users · Content. The Overview counts users, new users
  and the last seven days' finished workouts and logged meals; Users filters All / Members / Admins
  and an account's page shows when they joined and how many meals, workouts and orders they have.
- Kept as history: `admin_audit_log` rows about gyms, posts and reports; `ai_usage` rows of the
  `gym_assistant` feature (still in the ENUM, labelled "removed" on AI Usage, no section); old
  `analytics_events` of the community events (the server no longer accepts new ones).
- Still installed but unused since: `expo-camera` and `react-native-qrcode-svg` (removing a package
  needs the user's approval, and a new local build).

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
| 18 | Restrict uploads | `checkUpload` sniffs real bytes, allowed types and byte caps; bodies capped before parsing |
| 19 | Verify prices and payments | not applicable: no checkout |
| 20 | No production debug mode | `x-powered-by` off, generic 500s, `DEV_LOGIN_*` refused outside development, `NODE_ENV=production` on the droplet |
| 21 | Update vulnerable dependencies | `npm audit` in both folders before a release; server at 0 |
| 22 | Remove unused packages | compare `package.json` with imports before a release; native modules need a prebuild to remove |
| 23 | No exposed files | no `express.static` and no file downloads (uploaded photos and reports are read in memory, never stored); every `.env` git-ignored |
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
  verified. Nothing in the app or the request can pick a role.
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
