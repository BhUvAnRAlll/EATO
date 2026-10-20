# AGENTS.md

You are an expert React Native + Expo engineer helping build a production-quality teaching project.

You write clean, simple, maintainable code. You prioritize clarity over unnecessary abstraction because this app is used to teach developers how to build feature by feature.

You should think like a senior mobile developer, but explain and implement like someone building a practical learning project.

---

## Project Overview

We are building **EATO**, a fitness meal delivery and tracking mobile app for India, using Expo.

The repository has two apps side by side:

- `Eato_client/` — the Expo app (this file's rules apply to it)
- `Eato_server/` — a small Node.js + Express server in front of a MySQL database

EATO combines healthy meal delivery (single orders and subscriptions) with nutrition and training tracking. The user's fitness goal drives meal recommendations, and every meal they order is logged to their nutrition diary automatically.

Main areas of the app:

- **Onboarding**: welcome → goal → body details → calculated targets → pincode check
- **Home**: calorie ring, today's deliveries, streak, XP
- **Food**: menu, meal detail, cart, checkout, order success, live order tracking
- **Subscribe**: plan picker, subscription builder, review, my subscription (skip days, wallet credit)
- **Nutrition**: food diary, water and supplement tracking, add food, barcode scan, photo scan, weight log
- **Training**: workout plans, active workout, summary, exercise library, cardio, progress charts
- **Community**: feed, stories, posts, friends, trainers, gym communities, messages, chat (challenges were dropped)
- **AI Coach**: chat-based and video-based AI fitness and nutrition coach
- **Profile**: orders, wallet, coupons, addresses, goals, achievements, notifications, settings, Pro

This is primarily a learning project. The goal is to teach developers how to build a modern AI-powered Expo app feature by feature.

---

## Tech Stack

What is in use today:

- Expo (SDK 57) + React Native + TypeScript
- Expo Router (screens in `src/app/`; the app has no server-side API routes)
- NativeWind / Tailwind CSS
- Zustand for client state (the profile setup store)
- Clerk for authentication, sessions and roles (`@clerk/expo` in the app, `@clerk/backend` on the server)
- OpenAI (server-side only, in `Eato_server/bodyComposition/`) to read body composition reports
- Node.js + Express server (`Eato_server/`) with a MySQL database (`mysql2`): every backend concern lives here

Planned, not yet wired in:

- Stream / GetStream for video and real-time communication
- Stream Vision Agents for the AI video coach

Do not introduce new major libraries unless there is a strong reason.

### Where things run

| Concern | Where | Why |
| --- | --- | --- |
| Sign up / in / out, password reset, Google SSO | Clerk SDK, called from the app | Clerk owns identity; the app never stores passwords |
| Roles (`user`, `admin`, `trainer`) | Clerk `publicMetadata.role`, set only server-side (`POST /api/account-type` on the Express server, `scripts/set-role.mjs`) | The app can't promote itself |
| Reading an uploaded body composition report | `POST /api/body-composition` on the Express server → OpenAI (`Eato_server/bodyComposition/`) | Keeps `OPENAI_API_KEY` off the device; the file is never stored |
| Profile and nutrition targets from setup | MySQL (`users`, `profiles`, `nutrition_targets`, `body_composition_reports`) via `POST /api/profile` and `GET /api/profile` on the Express server; Clerk `unsafeMetadata.profileComplete` is only a routing shortcut | Server-verified identity, one transaction per save, the app's own calculator re-checks every record before it is stored |
| App data (meals, orders, diary, weigh-ins, trainer ↔ client links) | MySQL via the Express server (`Eato_server/`) | Shared, queryable data that outlives one device |
| Friendships and the messaging rule | MySQL `community_friendships` via `/api/community/friends/*` (`Eato_server/community/friends.js`, pure rules in `friendRules.js`). New conversations and new messages need an accepted friendship; older chats stay readable | Messaging is for friends only, checked on the server for every send |
| Gym communities | MySQL `gyms`, `gym_members`, `gym_invitations`, `gym_announcements`, `gym_events`, `gym_event_rsvps`, and gym posts in `community_posts` (`gym_id`, `review_status`), via `/api/gyms/*` (`Eato_server/gyms/`: `permissions.js` and `validate.js` are pure and unit-tested). Platform admins create gyms (`POST /api/gyms`) and name the owner; each gym's owner and admins run it | Every role, visibility and setting is checked on the server from `gym_members` for the verified caller; hidden gyms answer 404 to non-members |
| Trainers and coaching | MySQL `trainer_profiles`, `trainer_connections`, `trainer_target_recommendations`, `diet_plans`, `diet_plan_meals`, `diet_plan_meal_items`, `diet_plan_completions` (migration `2026-10-21-trainers.sql`), via `/api/trainers/*` (`Eato_server/trainers/`: `rules.js` and `validate.js` are pure and unit-tested). Member screens under `app/(user)/community/trainers/`, the trainer's under `app/trainer/` | A member has one trainer; a trainer acts on a member only while `trainer_clients` holds the pair (checked on every call), and trainer-only routes check the Clerk role each time |
| Community photos (posts, stories, gym logos and covers) | Files on the Express server's disk, `Eato_server/uploads/` (or `UPLOAD_DIR`), with a `community_media` row per file; served only to signed-in members through `GET /api/media/:id` (`Eato_server/community/media.js`) | Current implementation, not object storage: one server, no CDN, and the folder must be persistent and backed up. A hosted bucket (for example DigitalOcean Spaces with presigned uploads) is the planned replacement and would need a new dependency and approval |

Every Express route except the health check verifies the caller's Clerk session token with `requireUser` (`Eato_server/auth.js`) before doing anything.
The one other exception is Meta's WhatsApp webhook (`/api/whatsapp/webhook`): Meta calls it, so
instead of a session it checks Meta's `X-Hub-Signature-256` over the raw body with `META_APP_SECRET`,
and it decides which gym an event belongs to only from the receiving phone-number id
(`whatsapp_connections`), never from the message.

### WhatsApp gym agent (in progress)

- Server code is in `Eato_server/whatsapp/`: `webhook.js` (signed webhook, events saved once and
  queued), `jobs.js` + `worker.js` (a MySQL job queue polled inside the server; off in tests and with
  `WHATSAPP_WORKER=off`; it stays off with one log line until `migrations/2026-10-24-whatsapp-agent.sql`
  has run), `process.js` (events into contacts, conversations and messages, per gym), `send.js`
  (replies through the gym's own number, only inside WhatsApp's 24-hour window), `metaClient.js`
  (the only code calling Meta's Graph API), `secrets.js` (AES-256-GCM for each gym's token).
- Every gym gets one `whatsapp_connections` row (disconnected) and one `whatsapp_agent_settings` row
  (`testing`: the in-app assistant answers members, WhatsApp replies only once `active`) when it is created. Gym-owned WhatsApp tables use `ON DELETE RESTRICT`, so test clean-ups
  must delete them before `gyms`.
- Tests use a fake Meta and made-up settings; never real Meta credentials.

### Community notes

- **Groups were removed** (2026-10-17) and their data dropped (2026-10-18, migration
  `2026-10-23-drop-groups.sql`): no Groups tab, screens, routes or tables, and `community_posts` has
  no `group_id`. `POST /api/community/posts` refuses a `groupId`.
- **Gyms:** roles are owner > admin > trainer > member, and a role only counts while the membership
  is `active`. Visibility is `public`, `private` (listed; content for members; joining needs
  approval) or `hidden` (members and invite codes only). A gym is never hard-deleted (posts
  reference it with `ON DELETE RESTRICT`), which keeps clear of the MySQL cascade issue.
- **Gym codes:** each gym has an 8-character code that joins as a member without approval (admins
  can replace it if it leaks: `POST /api/gyms/:id/code/rotate`), and staff can create 10-character
  invitations (member or trainer role, 14 days, revocable; a code is shown only to staff who could
  grant that role themselves, or to its creator). Platform admins list every gym, hidden ones
  included, at `GET /api/gyms/admin/all`. EATO
  sends no SMS or email; phone and email invitations are only recorded. The invite screen shows the
  gym's invite link as a QR code (`react-native-qrcode-svg`); Join a gym can scan one with the camera
  (`expo-camera`'s `CameraView`, permission text in `app.json`), or the code is typed by hand.
  `codeFromScan` in `src/lib/gymRules.ts` reads the code from a scanned link or bare code. The camera
  module needs a new development build on iOS and Android (Expo Go and web work as they are).
- **Plans** on a gym are a label only. No payment exists, and the screens say so.
- **Trainers:** a trainer is an account with the Clerk role `trainer` who saved a profile
  (`PUT /api/trainers/me/profile`). Connecting is a request the trainer accepts or declines from
  their own account; until then the full profile, messaging, diet plan, workout and targets stay
  locked. One trainer per member (a unique virtual column on `trainer_connections`); switching
  needs `{ replace: true }` after a confirmation. Ending a connection (either side, or a switch)
  removes the `trainer_clients` row, supersedes the diet plan and the trainer's workout, and swaps a
  trainer target back for the member's own. Logged meals stay.
- **Trainer targets:** a recommendation is stored apart from `nutrition_targets` and becomes active
  only when the member taps Apply (`applyTrainerOverride` with the trainer's grams). The member's
  own target at that moment is saved on the recommendation, and `restorePersonalTargets` in
  `src/lib/nutrition/record.ts` is the way back (the plain reset stays blocked while a trainer's
  target is active).
- **Diet plans:** five meals (breakfast, morning snack, lunch, evening snack, dinner). Logging a plan
  meal writes to the Macro diary (`macro_meal_logs.source = 'plan'`); `plan_log_key`
  (`date:mealId:n`, unique per member) makes a repeated tap return the first log instead of a copy.
  Both snacks log into the diary's one `snack` slot.
- **Workouts:** the trainer writes `workout_plans` rows with `source = 'trainer'` and `created_by`,
  superseding the member's active plan; the Fitness tab shows it unchanged. After the coaching ends,
  `ensurePlan` generates an engine plan again. Messaging: a connected trainer and client may write to
  each other (`sendAccess` in `community/messages.js`), on top of the friends rule.


### Gym owner portal (in progress)

- Spec and mockups: `Gym Owner Portal Screens and Workflow/` at the repo root, built in phases (1 Home,
  Members and Renewals; 2 QR check-in; 3 Community and Notify; 4 Review; 5 Gym tab, assistant replies).
  Colours come from the tokens, not the mockups.
- App: `app/owner/` (its own tabs: Home, Members, Check-in, Community, Review, Gym), open to every
  signed-in role; `lib/owner.ts`, `store/owner.ts` (open gym, summary, tab badges). Entry points: the
  "Gym owner portal" button on Community › Gyms (gym owners and admins), and Admin › Gyms (EATO admins
  open any gym's portal). Members see their own package in the gym's About tab (`MyGymPlan`).
- Server: `/api/owner` (`Eato_server/owner/`; pure rules in `rules.js`). Every gym route allows the
  gym's active owner or admins (`gym_members`), or an EATO admin (Clerk role, read live); gym trainers
  and members get 403, and a hidden gym looks missing (404). There is no "gym owner" Clerk role.
- Renewals use `gym_member_plans`: +1 or +3 months from the later of the end date and today (an
  expired package restarts today; a member without one gets the gym's first tier). Recorded only,
  never a payment.
- QR attendance (phase 2, migration `2026-10-26-gym-attendance.sql`): a member's pass (`/my-qr`) is
  `EATO1.<user>.<expiry>.<HMAC>`, valid two minutes, signed with a key derived from `CLERK_SECRET_KEY`
  (`owner/passes.js`; no extra secret). The front desk verifies, then checks in (`owner/attendance.js`);
  `gym_visits.open_member` allows one open visit per member per gym, so a double tap can't check in
  twice. Every refused scan is a `gym_scan_failures` row; another gym's member stays anonymous. Members
  check out by scanning the gym's `EATO-OUT-<code>` QR (switchable, regenerable) from the Home card,
  or staff end the visit. On the web the scanner takes a typed code (`QrScanner`), which the tests use.
- Notices (phase 3, migration `2026-10-27-gym-notices.sql`): `owner/notices.js` works out each audience
  on the server from active members only (everyone, in the gym now, renewal due, no visit in 14 days,
  staff, chosen), saves the notice and its recipients, and rate limits each sender (30 an hour). Check-ins
  and renewals add a note for the member; reminders go from Renewals. Members see them in the bell
  (`community/notifications.js`, type `gym_notice`), and a tap opens its target. The Community tab's
  counts come from `GET /api/owner/gyms/:id/community`.
- Review (phase 4, `owner/review.js`, no schema change): held gym posts are approved (published) or
  rejected (soft-deleted); a reported gym post is kept (its open `community_reports` become `dismissed`)
  or removed (soft-deleted, reports `reviewed`, in one transaction), the same statuses as EATO's admin
  queue, so handled reports leave both. Reporters stay anonymous to the gym. The switch at the top is
  `gyms.post_moderation`.

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
Eato_client/src/
  app/            screens and layouts (Expo Router); no server code lives in the app
    (auth)/       sign-in, sign-up, forgot-password
    setup/        profile setup steps
    admin/  trainer/  home.tsx   one landing screen per role
  components/
  constants/
  data/           static, typed content (options, onboarding slides, dashboard tiles)
  lib/            service helpers (api.ts, clerk.ts, roles.ts, session.ts, reportUpload.ts, nutrition/)
  store/          Zustand stores
  types/
  theme/
assets/

Eato_server/
  index.js        Express app: every route, JSON 404 and the error handler
  auth.js         requireUser (verifies the Clerk session token), getAccount (email + role from Clerk), grantTrainerRole
  profile.js      profile validation, the transactional save and the load for /api/profile
  rateLimit.js    per-user rate limiting (limitPerUser) for every authenticated route
  requestBody.js  capped JSON body parsing for the upload route
  bodyComposition/  report upload checks (upload.js), OpenAI extraction (extract.js), clean-up (normalize.js)
  logging.js      safe error logging (never the SQL, body, headers or a token)
  database.js     mysql2 connection pool, configured from .env
  schema.sql      the full MySQL schema (run once; it does not migrate)
```

The server **imports the app's nutrition calculator from the client folder**
(`require("../Eato_client/src/lib/nutrition/index.ts")` in `profile.js`) so saved targets are
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

EATO's colours come from the EITO web app (https://eito-app.vercel.app), colours only (not its
features, buttons or layout). The palette lives in `src/theme/tokens.css` with a JS copy in
`src/theme/index.ts`; keep the two in sync and never hard-code a hex value in a screen or
component when a token exists.

| Role | Token(s) | Value |
| --- | --- | --- |
| Page background | `cream`, `background` | `#F9F7F5` |
| Cards and sheets | `surface`, `cream-light` | `#FFFFFF` |
| Soft panels / tracks | `cream-deep`, `surface-alt` / `cream-tab` | `#F6F2EF` / `#E9E6E2` |
| Borders | `cream-line`, `line` | `#EEEAE6` |
| Ink: titles, body, primary buttons | `forest`, `forest-ink`, `ink`, `leaf-dark` | `#141515` |
| Accent: chips, active tab, avatars | `primary` / `accent-soft`, `forest-soft`, `leaf-soft` | `#C5D3EA` / `#E2EBF6` |
| Strong accent: links, rings, "today" | `leaf`, `success` | `#10213A` (navy) |
| Muted / faint text | `muted` / `faint` | `#676A72` / `#8F9197` |
| Danger / warning / info | `danger` / `warning` / `info` | `#F3435A` / `#C49A5A` / `#97BEF3` |
| Macros | `protein` / `carbs` / `fat` | `#8E7BD6` / `#B49469` / `#6FA3EA` |

- Some token names (`forest`, `cream`, `leaf`) come from the earlier green theme. They keep their
  roles; only the values changed. Use them by role, not by the colour their name suggests.
- `danger` and `warning` are below WCAG AA contrast as small text on the page background. Prefer
  them for icons, badges and fills; pair them with ink text where a message must be read.
- Typography stays on the system font (San Francisco on Apple platforms) through `--font-sans`.

Avoid large inline styles unless required.

## NativeWind Rule

Use the NativeWind version already installed in this app.

Before implementing styling or NativeWind-related code:

- Check the current NativeWind version in `package.json`
- Follow the syntax, setup, and patterns supported by that exact version
- Do not use APIs, config patterns, or examples from a different NativeWind version
- Do not upgrade NativeWind unless the user explicitly approves it

Refer this for more info: https://www.nativewind.dev/v5/llms-full.txt

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

Nothing is persisted on the device today beyond Clerk's own session cache. Data that must
survive a reinstall belongs in Clerk (identity, role) or MySQL (app data), not in AsyncStorage.

---

## lib/

Use this for external service helpers.

Examples:

```txt
lib/
  api.ts        apiFetch() / getApiUrl() — the only way the app calls the Express server
  clerk.ts      Clerk error → one friendly line
  roles.ts      role helpers and the trainer-role claim
  nutrition/    the target calculator (pure, unit-tested)
```

Never expose secret keys in the mobile app. Only `EXPO_PUBLIC_*` variables reach the device;
`CLERK_SECRET_KEY` and `OPENAI_API_KEY` live in `Eato_server/.env` (the app's `.env` keeps
`CLERK_SECRET_KEY` only for `scripts/set-role.mjs`).

### Calling the Express server

- Use `apiFetch()` from `lib/api.ts`. It targets `EXPO_PUBLIC_API_URL` when set, otherwise the
  computer running the Expo dev server on port 4000 (works for the simulator and a phone on the
  same Wi-Fi).
- Pass the Clerk session token (`getToken()` from `useAuth()`) as `token` for any route that
  needs to know who is asking.
- Responses are JSON. Errors arrive as `{ error: "one friendly line" }` with a proper status code.

### The Express server is the whole backend

- Everything the app needs from a server lives in `Eato_server/`: the MySQL-backed profile routes,
  the report upload read by OpenAI (`POST /api/body-composition`) and the trainer-role grant
  (`POST /api/account-type`). The app has no Expo API routes; it only calls the Express server
  through `apiFetch()`.
- Add routes in `Eato_server/index.js`, put `requireUser` in front of anything that isn't the health
  check, read the caller from `req.userId` (never from the body), use parameterized queries through
  `pool.query(sql, params)`, and send errors to `next(error)` so the shared handler logs them and
  answers with a safe message. Related writes go in one transaction (see `persistProfile` in `profile.js`).
- Every authenticated route is rate limited per verified Clerk user: `limitPerUser` from
  `rateLimit.js`, placed right after `requireUser`. The budgets are in-memory, per process, and reset
  on restart: not a multi-instance defence. Bodies are parsed per route, after the caller is verified,
  with the limit the route needs: `express.json({ limit })` for small JSON, `jsonBodyWithLimit` from
  `requestBody.js` for the upload route (it refuses an oversized body while it is still arriving).
- `Eato_server/.env` needs `CLERK_SECRET_KEY` (to verify tokens, look up accounts and grant roles) and
  `OPENAI_API_KEY` (to read reports). Never commit any `.env`.

---

## State Management Rules

Use Zustand for global client state.

Use local state for temporary UI state.

Anything that must outlive the session goes to the server (MySQL) or to Clerk, not to device storage.

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

## EATO Development Rules

These rules apply to every future implementation, in both `Eato_client/` and `Eato_server/`.

1. **One screen at a time.** Implement only one approved screen or feature at a time. Inspect existing code before making changes.
2. **Test after every implementation.** Run TypeScript checks, Expo lint, relevant unit tests, and regression tests.
3. **Fix before proceeding.** Resolve implementation-related failures and rerun the affected checks before declaring completion.
4. **Check the UI.** Verify navigation, buttons, forms, loading, empty, error and success states, responsive layout, safe areas, and keyboard behavior as applicable.
5. **Check backend changes.** Verify authentication, authorization, input validation, API responses, database writes and rollback behavior when applicable.
6. **Protect existing work.** Do not break onboarding, Clerk authentication, existing navigation, or working features. Do not introduce unrelated changes.
7. **Be honest about testing.** Report automated tests, manual tests actually completed, and checks that still require the user's action. Never claim unexecuted tests passed.
8. **Report every implementation.** List changed files, commands executed, results, remaining issues and manual checks.
9. **Approval required.** After each approved screen or feature is implemented and verified, provide the completion report and stop. Wait for the user's approval before starting the next screen, feature, phase, or any individual finding from an audit.
10. **Database safety.** Never drop tables, delete existing data, change database permissions, modify the schema, or create persistent test data without the user's approval.
11. **Security.** Never expose secrets, trust client-supplied identity or roles, or bypass existing authentication.
12. **Keep instructions updated.** Preserve the current EATO architecture and existing project rules. Do not overwrite useful instructions.
13. **Design source of truth.** `src/theme/tokens.css`, `src/theme/index.ts`, the utilities in `src/global.css`, and the mockups under `assets/design/` define EATO's look. Colours come from the tokens (see "Colour theme" above); the mockups still show the earlier green and cream colours, so use them for layout, spacing and composition, not colour. Preserve them. Do not introduce a new visual direction; when a screen and a mockup disagree, report the discrepancy and ask before changing the composition.
14. **Test isolation.** UI and integration tests use the `eato_test` database through `Eato_server/.env.test` and the test server on port 4100. Never point tests at port 4000 or the `eato` database. Run `npm test`, `npm run test:e2e` and `npm run test:ui` in `Eato_server/` as relevant.
15. **Visual evidence.** After each approved UI change, capture screenshots at the supported widths with the existing test harness and include their paths in the report.
16. **Git.** Never commit, push, amend, rewrite history, reset, stash or discard work without explicit approval. Review the staged diff before any commit. Keep `.env` files and generated artifacts out of commits.
17. **Audits are checklists.** An audit report authorises nothing. Each finding is implemented only after its own approval, one at a time, following inspect, implement, test, review the diff, verify at supported sizes, report, wait.
18. **Secure by default.** Every feature, bug fix, refactor, endpoint, schema change and integration also follows the EATO Secure Development Rules below.

---

## EATO Secure Development Rules

These rules supplement the EATO Development Rules above (they replace nothing) and apply to every
change in both `Eato_client/` and `Eato_server/`. Security is never guaranteed: report what was
confirmed, what remains a risk, and what was not tested.

### 1. Security-by-design workflow

Before implementing:

- List the screens, API routes, database tables, files, roles (`user`, `trainer`, `admin`) and
  sensitive data (health data, contact details, tokens) the change touches.
- For each resource, say who may read, create, update and delete it, and enforce that server-side.
- Name the attack paths that apply (missing or forged auth, wrong role, another user's id, bad or
  oversized input, SQL injection, abuse of an expensive call) and the tests that will cover them.
- Keep existing behaviour and contracts unless the approved change requires otherwise.

While implementing:

- Apply the rules below to all new and modified code. Reuse the existing secure helpers:
  `requireUser` and `getAccount` (`Eato_server/auth.js`), `ValidationError` and the validators in
  `profile.js`, `logRequestError` (`logging.js`), `checkUpload` (`bodyComposition/upload.js`),
  `jsonBodyWithLimit` (`requestBody.js`), `limitPerUser` (`rateLimit.js`), and the test harness
  under `Eato_server/__tests__/`.
- Never disable, loosen or skip a security check to make a test pass.
- Never treat client-side validation, a hidden screen, a client-supplied role or user id, or
  Clerk `unsafeMetadata` as authorisation. They are hints for the UI only.

Before declaring completion:

- Add regression tests for the normal behaviour and for the attack paths named above.
- Run the focused tests, then the existing suites (`npm test`, `npm run test:e2e`,
  `npm run test:ui` in `Eato_server/`; `npm test`, `npm run typecheck`, `npm run lint` in `Eato_client/`).
- Inspect the complete diff for security regressions, accidental secrets, unrelated changes and
  unsafe configuration.
- Report untested scenarios honestly.

### 2. Authentication and authorisation

- Every protected endpoint verifies the Clerk session token server-side (`requireUser`); identity
  is the verified `sub` claim (`req.userId` / `auth.userId`), never a request field.
- Enforce role and resource-level permissions server-side for `user`, `trainer` and `admin`.
  Roles come from Clerk `publicMetadata.role`, read with `getAccount` or the Clerk client; a
  trainer's access to a client goes through a server-side assignment (`trainer_clients`), never
  the role alone.
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
- The app runs as the least-privilege account (`eato_app`), never as MySQL root. Production
  (`eato`), development and test (`eato_test`) databases stay separate; tests never run
  destructive queries against production.
- Add tests with SQL-injection payloads and unauthorised-access attempts where a query takes
  user input or returns user-owned rows.

### 4. API and resource protection

- Validate bodies, query parameters, route parameters and unexpected fields; reject what is not
  expected with a 400 and one friendly line.
- Rate limit authentication-sensitive, expensive and abuse-prone endpoints per verified user
  (`Eato_server/rateLimit.js`); AI and other paid calls are never unlimited.
- Enforce request-body, upload, processing and pagination limits. Reject an oversized request
  before expensive parsing or processing where the runtime permits (`jsonBodyWithLimit` for large
  bodies, `express.json({ limit })` for small ones, both per route and after `requireUser`).
- CORS is as restrictive as the deployment allows; add security headers and keep error responses
  safe. Never expose stack traces, SQL, credentials or personal data in a response.

### 5. Files and secrets

- Validate uploaded content by its real bytes (`checkUpload`), the allowed types, the size, the
  filename and the owner; uploads are never stored without approval, and private files are never
  served publicly.
- Clerk secret keys, database credentials and provider keys stay server-side (`Eato_server/.env`).
  `EXPO_PUBLIC_*` variables are public.
- Never print or commit a secret value. Logs carry no tokens, bodies, headers or personal data
  (`logging.js`).
- Add no unnecessary dependency and no insecure storage.

### 6. Testing requirements

For every relevant feature, test: the expected authorised behaviour; missing, malformed, expired
and invalid authentication; wrong-role access and unauthorised ownership; invalid, unexpected or
malicious input; SQL-injection and resource-abuse cases that apply; regression behaviour and data
integrity. Use only `eato_test`, `.env.test` and the test server on port 4100, with throwaway
Clerk test identities that are deleted afterwards. Never use production accounts or data.

### 7. Git, production and approval safeguards

- Preserve existing modified and untracked files. No commit, push, reset, stash or discard without
  explicit approval.
- No change to production credentials, database permissions, Clerk or authentication
  configuration, or deployment settings without approval.
- Never stop, restart or interfere with the development server on port 4000.
- Report confirmed findings, potential risks and untested areas; never claim security is guaranteed.

---

## AI / Stream / Vision Agent Rules

Use backend/serverless for:

- Stream tokens
- AI calls
- Vision Agent (AI video coach) sessions

Never expose secrets in the frontend.

---

## Clerk Rules

Use Clerk for authentication.

Do not build custom auth.

---

## Content Rules

Static UI content (option lists, onboarding slides, dashboard tiles) stays in typed files under `data/`.

Anything users create or that changes over time (meals on the menu, orders, the diary, weigh-ins)
belongs in MySQL. The tables already exist in `Eato_server/schema.sql`; do not change the schema or
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

Run in `Eato_client/`:

```bash
npm run lint
npm run typecheck
npm test
```

Then confirm the server still starts and reports a connected database:

```bash
cd ../Eato_server && yarn start        # in another terminal
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

- Identity, sessions and roles live in Clerk. Do not build custom auth.
- App data lives in MySQL behind the Express server. Static content lives in `data/`.
- Secrets stay on the server side (`Eato_server/.env`). Never print or commit them.
- Do not change `schema.sql`, the live database, or the Clerk role model without approval.

---

## Final Reminder

Before every feature implementation:

- Read this file
- Follow it strictly, including the EATO Development Rules and the EATO Secure Development Rules above
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

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
