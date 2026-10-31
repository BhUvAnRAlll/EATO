# Clerk → Fast2SMS OTP: Phase 1 audit (read-only)

Date: 2026-10-28 · Branch at audit time: `native-prebuild` (uncommitted work present) · Nothing was changed.

## Baseline

| Suite | Result |
| --- | --- |
| `JustFit_server` `npm test` (unit) | 189 / 189 pass |
| `JustFit_client` `npm test` (unit) | 215 / 215 pass |
| `JustFit_server` `test:e2e`, `test:ui` | Not run: both create real Clerk test users; to be rerun once the harness is replaced |

## 1. Server (`JustFit_server/`)

Clerk is confined to **one file**, `auth.js`, plus one key derivation. Everything else calls its helpers.

| Helper in `auth.js` | Clerk call | Used by | Replacement |
| --- | --- | --- | --- |
| `requireUser` | `verifyToken` (JWT) | every route (19 in `index.js` + each router) | Bearer token → SHA-256 → `sessions` row (not expired, not revoked) → `req.userId` |
| `getAccount` | `users.getUser` → email, `publicMetadata.role` | `index.js` (profile save), `community/members.js` (`ensureUser`, `currentRole` → also `trainers/routes.js` `requireTrainer`, community moderation) | `SELECT phone, role FROM users WHERE id = ?` |
| `requireAdmin` | via `getAccount` | `admin/*` (5 files), `community/routes.js`, `gyms/routes.js`, `index.js` | Same logic, role from `users.role` |
| `grantTrainerRole` | reads `unsafeMetadata.accountType`, writes `publicMetadata.role` | `POST /api/account-type` | **Decision needed** (see D4) |
| `verifiedEmails` | verified Clerk emails | `gyms/routes.js` (`myInvitations`: email invitations) | Verified phone instead (invitations already support a `phone` channel) |

Other Clerk dependencies:

- `owner/attendance.js:18`: the member-pass key comes from `deriveKey(process.env.CLERK_SECRET_KEY)`. Needs its own secret (`PASS_SIGNING_SECRET`). Passes last 2 minutes, so switching keys only invalidates passes on screen at that moment. The `eato-member-pass` label can stay.
- `community/validate.js:303` `clerkUserId` (regex `^user_[A-Za-z0-9]{10,64}$`) is used in `community/routes.js`, `gyms/routes.js`, `owner/routes.js` and `trainers/routes.js`. **If new ids keep the `user_` + base62 shape, no validator or column changes** (rename the function only).
- Email is used beyond login: admin user search (`admin/users.js:35`), and "create a gym and name the owner by email" (`gyms/validate.js:119`). Both need a phone (or user-search) equivalent.
- `@clerk/backend` is the only Clerk package. `CLERK_SECRET_KEY` is required at startup (`auth.js:8`).

## 2. Database

- `users.id VARCHAR(64)` (a Clerk id), referenced by **87** foreign keys (live `eato`, checked 10-28; 141 foreign keys in all — an earlier count of 165 double-counted schema.sql and the migrations). The id format should stay the same; the 87 FKs stay untouched.
- `users.email VARCHAR(255) NOT NULL` + `UNIQUE uq_users_email`: has to become `NULL` for phone-only accounts. A nullable unique key allows many NULLs in MySQL.
- `users.phone CHAR(10) NULL`, with a CHECK for 10 digits and +91 implied. It is filled by the setup's personal-details step today. It becomes the login identity: needs `UNIQUE`, plus `phone_verified_at`.
- `users.role ENUM('user','admin','trainer')`: already exists. Today it is a *copy* refreshed on profile save. The live role comes from Clerk. After the change it becomes the source of truth.
- New tables: `otp_challenges` and `sessions` (as in the plan). Migration file: `migrations/2026-11-01-phone-auth.sql` (additive, plus the `email` NULL change).

## 3. App (`JustFit_client/`)

- 18 files import `@clerk/expo`. **101 screens** get their token through one wrapper, `useSessionToken()` (`src/lib/session.ts`). Swapping its internals covers all of them. `returnToSignIn(signOut)` is the shared 401 path.
- Screens to rewrite: `(auth)/sign-in.tsx`, `sign-up.tsx`, `forgot-password.tsx` → phone + OTP (one flow, so there is no separate sign-up or reset). `components/GoogleButton.tsx` is removed.
- Routing: `app/index.tsx`, `lib/roles.ts` (`getRole`, `needsTrainerRole`, `homeFor`), `setup/_layout.tsx`, `setup/targets.tsx`. These read `publicMetadata.role` and `unsafeMetadata.profileComplete`/`accountType` → read from `GET /api/auth/me` instead (the server already knows `profileComplete`).
- User display: `useUser()` (17 uses) for `firstName`, `fullName`, `primaryEmailAddress`, `user.update()` (`setup/personal.tsx`), `user.reload()`. These come from `/api/auth/me`, and the name is saved through the profile.
- `_layout.tsx`: `ClerkProvider` + `tokenCache` → a small auth context/Zustand store holding the token.
- Token storage: `expo-secure-store` is **already installed**. On the web (which the UI tests use) it doesn't exist, so the web build needs a fallback (`localStorage`, web only).
- Packages to drop at the end: `@clerk/expo`, `@clerk/backend` (only `set-role.mjs`), `expo-auth-session` and `expo-web-browser` (Google SSO only; check before removing). Also the `@clerk/expo` plugin in `app.json` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `.env.example`.
- `scripts/set-role.mjs`: Clerk lookup by email → MySQL update by phone (`set-role -- <phone> <role>`).

## 4. Tests

- One central helper: `__tests__/e2e/clerk-identities.js` (`createIdentity`, `createSession`, `revokeSession`, `deleteUser`, `setUnsafeMetadata`, sweeper). It is used by 32 e2e and 22 UI files. Replace it with a `test-identities.js` that inserts users and sessions straight into `eato_test` (same function names where possible). Most test files then change only their `require` line and the `setUnsafeMetadata` calls (16).
- UI tests sign in through the browser with a password today. With OTP they need a fake SMS provider whose code the test can read. Guard: the fake provider is refused unless the database is `eato_test` (same idea as `AI_PROVIDER=fake`).
- New tests: the OTP, session and authorisation cases listed in Phase 6 of the plan.

## 5. Decisions needed before Phase 2

- **D1 Role name.** The plan says `member`, the schema says `user`. Keep `user` (the ENUM, ~every role check and the admin filters use it). *Recommended.*
- **D2 Phone format.** The plan says international format; the app and schema are India-only, 10 digits with +91 implied. Keep `CHAR(10)` and add `UNIQUE`. *Recommended.*
- **D3 Ids.** Generate `user_` + 24 random base62 characters, so the 87 FKs and the validators are untouched. *Recommended.*
- **D4 Trainer sign-up.** Today a new account can pick "Trainer" at sign-up and the server grants it once. Keep that, so OTP sign-up offers the choice and the server grants `trainer` only on first account creation? Or make trainers admin-assigned only (`set-role`)?
- **D5 Email-based features.** The gym-owner-by-email (admin creates gym) and email invitations need to switch to phone. OK to do in the same change?
- **D6 Rollback.** The plan keeps Clerk as a rollback during development. Running both logins at once means dual-mode middleware. Simpler: the new branch replaces Clerk, and rollback is switching back to the current branch/commit. *Recommended.*
- **D7 Branch.** `native-prebuild` has a lot of uncommitted work. Commit it first, then branch `feature/phone-otp-auth` from it? (I won't commit or branch without your go-ahead.)

## 6. Your actions (Phase 0, outside the code)

- Regenerate the Fast2SMS API key: the old one was pasted in chat. Put the new one only in `JustFit_server/.env` as `FAST2SMS_API_KEY` (`.env` is already git-ignored).
- Confirm the route in the Fast2SMS dashboard (OTP route vs DLT route, sender ID, template, per-SMS price) and send one test OTP to your own number.
- Back up the dev database before Phase 2 runs (`/usr/local/mysql/bin/mysqldump -u root -p eato > ~/eato-backup-2026-10-28.sql`).
