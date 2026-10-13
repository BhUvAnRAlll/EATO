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
- **Community**: feed, stories, posts, groups, leagues, messages, chat
- **AI Coach**: chat-based and video-based AI fitness and nutrition coach
- **Profile**: orders, wallet, coupons, addresses, goals, achievements, notifications, settings, Pro

This is primarily a learning project. The goal is to teach developers how to build a modern AI-powered Expo app feature by feature.

---

## Tech Stack

What is in use today:

- Expo (SDK 57) + React Native + TypeScript
- Expo Router (screens in `src/app/`, plus two server-side API routes in `src/app/api/`)
- NativeWind / Tailwind CSS
- Zustand for client state (the profile setup store)
- Clerk for authentication, sessions and roles (`@clerk/expo` in the app, `@clerk/backend` in API routes)
- OpenAI (server-side only, inside an Expo API route) to read body composition reports
- Node.js + Express server (`Eato_server/`) with a MySQL database (`mysql2`)

Planned, not yet wired in:

- Stream / GetStream for video and real-time communication
- Stream Vision Agents for the AI video coach

Do not introduce new major libraries unless there is a strong reason.

### Where things run

| Concern | Where | Why |
| --- | --- | --- |
| Sign up / in / out, password reset, Google SSO | Clerk SDK, called from the app | Clerk owns identity; the app never stores passwords |
| Roles (`user`, `admin`, `trainer`) | Clerk `publicMetadata.role`, set only server-side (`src/app/api/account-type+api.ts`, `scripts/set-role.mjs`) | The app can't promote itself |
| Reading an uploaded body composition report | Expo API route `src/app/api/body-composition+api.ts` → OpenAI | Keeps `OPENAI_API_KEY` off the device; the file is never stored |
| Profile and nutrition targets from setup | MySQL (`users`, `profiles`, `nutrition_targets`, `body_composition_reports`) via `POST /api/profile` and `GET /api/profile` on the Express server; Clerk `unsafeMetadata.profileComplete` is only a routing shortcut | Server-verified identity, one transaction per save, the app's own calculator re-checks every record before it is stored |
| App data (meals, orders, diary, weigh-ins, trainer ↔ client links) | MySQL via the Express server (`Eato_server/`) | Shared, queryable data that outlives one device |

Both Expo API routes check the caller's Clerk session token with `requireUser` (`src/server/auth.ts`) before doing anything.

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
  app/            screens and layouts (Expo Router), plus api/*+api.ts server routes
    (auth)/       sign-in, sign-up, forgot-password
    setup/        profile setup steps
    admin/  trainer/  home.tsx   one landing screen per role
    api/          Expo API routes (run on the server, never on the device)
  components/
  constants/
  data/           static, typed content (options, onboarding slides, dashboard tiles)
  lib/            service helpers (api.ts, clerk.ts, roles.ts, nutrition/)
  server/         code that only runs inside API routes (auth, report extraction)
  store/          Zustand stores
  types/
  theme/
assets/

Eato_server/
  index.js        Express app: routes, JSON 404 and the error handler
  auth.js         requireUser middleware (verifies the Clerk session token) and getAccount (email + role from Clerk)
  profile.js      profile validation, the transactional save and the load for /api/profile
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
`CLERK_SECRET_KEY` and `OPENAI_API_KEY` are read only inside `src/app/api/` routes and scripts.

### Calling the Express server

- Use `apiFetch()` from `lib/api.ts`. It targets `EXPO_PUBLIC_API_URL` when set, otherwise the
  computer running the Expo dev server on port 4000 (works for the simulator and a phone on the
  same Wi-Fi).
- Pass the Clerk session token (`getToken()` from `useAuth()`) as `token` for any route that
  needs to know who is asking.
- Responses are JSON. Errors arrive as `{ error: "one friendly line" }` with a proper status code.

### Expo API routes vs the Express server

- Expo API routes (`src/app/api/*+api.ts`) are for operations that need Clerk's secret key or an
  AI key and no database: today, claiming the trainer role and reading a report upload.
  In production they need `EXPO_PUBLIC_API_ORIGIN` (see `app.config.ts`).
- The Express server is for anything backed by MySQL. Add routes in `Eato_server/index.js`, put
  `requireUser` in front of anything that isn't the health check, read the caller from `req.userId`
  (never from the body), use parameterized queries through `pool.query(sql, params)`, and send errors
  to `next(error)` so the shared handler logs them and answers with a safe message. Related writes go
  in one transaction (see `persistProfile` in `profile.js`).
- `Eato_server/.env` needs `CLERK_SECRET_KEY` (the same key as the app's `.env`) so the server can
  verify tokens and look up accounts. Never commit either `.env`.

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
9. **Approval required.** After each approved screen or feature is implemented and verified, provide the completion report and stop. Wait for the user's approval before starting the next screen.
10. **Database safety.** Never drop tables, delete existing data, change database permissions, modify the schema, or create persistent test data without the user's approval.
11. **Security.** Never expose secrets, trust client-supplied identity or roles, or bypass existing authentication.
12. **Keep instructions updated.** Preserve the current EATO architecture and existing project rules. Do not overwrite useful instructions.

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

Fix errors.

---

## Communication Style

Be concise.

Explain what changed and how to test.

---

## Important Constraints

- Identity, sessions and roles live in Clerk. Do not build custom auth.
- App data lives in MySQL behind the Express server. Static content lives in `data/`.
- Secrets stay on the server side (Expo API routes, `Eato_server/.env`). Never print or commit them.
- Do not change `schema.sql`, the live database, or the Clerk role model without approval.

---

## Final Reminder

Before every feature implementation:

- Read this file
- Follow it strictly, including the EATO Development Rules above
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
