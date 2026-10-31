# Clerk → Fast2SMS OTP: Phase 2 proposal (backend)

Date: 2026-10-28 · Follows `AUTH-MIGRATION-AUDIT.md` and the seven approved decisions.
**Status: proposal only.** No code, database, git or configuration was changed.

---

## A. Git state

Branch `native-prebuild` (1 commit ahead of `main`: `dcfeb81`). Uncommitted work: 1 staged deletion, 103 modified files, 17 untracked paths. Typecheck, lint and both unit suites pass on it as it stands. No secrets in the diff or in untracked text files.

The work is three themes, all from earlier sessions, none of it related to auth:

| Theme | Files |
| --- | --- |
| **1. Local builds, no Expo services** (10-27) | staged `JustFit_client/eas.json` deletion; `.npmrc`, `app.json` (EAS `projectId`/`owner` removed, Clerk plugin `appleSignIn: false`), `package.json` (`build:android`; drops `expo-device`, `expo-document-picker`, `openai` from the app), `package-lock.json`, `.env.example`, `README.md` |
| **2. AI Coach plan** (10-27, Phase 2) | `JustFit_server/`: `coach/routes.js`, `coach/validate.js`, `index.js`, `schema.sql` (+3 coach tables), `workout/plans.js`, `yarn.lock` (lockfile drift: `iconv-lite`, `qs`), 8 test files, and untracked `coach/plan.js`, `coach/planRules.js`, `migrations/2026-10-31-coach-plans.sql`, `__tests__/coach-plan.test.js`. App: `src/lib/coach.ts`, `(tabs)/coach.tsx`, untracked `components/coach/PlanMeals.tsx` |
| **3. Peak Fitness redesign** (10-27/28) | `global.css`, `theme/tokens.css`, `theme/index.ts`, ~80 screens/components (mostly 20 → 16 px gutters, token use), untracked `assets/fonts/` (Poppins, used by the app), `constants/fonts.ts`, `components/{ActivityCard,IconButton,MetricCard,ProgramCard,ProgressStat}.tsx`, `AGENTS.md` |

Ambiguous, so they stay **out of every commit** unless you say otherwise: `.vscode/`, `AUTH-MIGRATION-AUDIT.md`, `AUTH-MIGRATION-PLAN.md`, `JustFit_client/assets/reference for ai coach/` (14 MB), `Gym Owner Portal Screens and Workflow/` (7 MB), `Super Admin Screens and Workflow/` (5 MB): design references that were never committed before.

Note: `(tabs)/coach.tsx` holds both coach and redesign edits, so it goes with theme 2. `AGENTS.md` documents all three themes, so it goes with the last commit.

### Proposed operations (need your approval, exact commands)

```bash
cd /Users/bhuvanraj/Desktop/JustFit-App
# 1. local builds (eas.json deletion is already staged)
git add JustFit_client/.npmrc JustFit_client/app.json JustFit_client/package.json JustFit_client/package-lock.json JustFit_client/.env.example JustFit_client/README.md
git commit -m "chore: build locally without Expo services"
# 2. AI coach plan
git add JustFit_server/coach JustFit_server/index.js JustFit_server/schema.sql JustFit_server/workout/plans.js JustFit_server/yarn.lock \
        JustFit_server/migrations/2026-10-31-coach-plans.sql JustFit_server/__tests__ \
        JustFit_client/src/lib/coach.ts "JustFit_client/src/app/(user)/(tabs)/coach.tsx" JustFit_client/src/components/coach/PlanMeals.tsx
git commit -m "feat: make the AI coach's plan (meals and workout week)"
# 3. redesign + AGENTS.md: every remaining modified file under JustFit_client, plus the fonts and new components
git add -u JustFit_client && git add JustFit_client/assets/fonts JustFit_client/src/constants/fonts.ts \
        JustFit_client/src/components/{ActivityCard,IconButton,MetricCard,ProgramCard,ProgressStat}.tsx
git commit -m "feat: adopt the Peak Fitness design system with the JustFit red"
# 4. the auth branch
git switch -c feature/phone-otp-auth
```

Before each commit I'll show `git diff --cached --stat` and stop if it has anything unexpected. There is no push.

---

## B. Provider readiness (Fast2SMS)

From the current docs (`docs.fast2sms.com`):

| Route | Endpoint | Needs | Fit |
| --- | --- | --- | --- |
| **DLT SMS** | `POST /dev/bulkV2`, `route: "dlt"`, `sender_id`, `message` (approved template's Message ID), `variables_values` (our code), `numbers` | DLT-registered entity, sender ID, approved OTP template | **Recommended.** We generate and verify the code; Fast2SMS only delivers |
| OTP API | `POST /dev/otp/send` with `otp_id` (template), optional `otp` (our code) | an OTP template; KYC (error 996) | Also works if we pass our own `otp`. Fast2SMS's own verify endpoint is not used |
| Quick SMS | `POST /dev/bulkV2`, `route: "q"`, free text | — | Not for OTPs: the docs don't say it is allowed for OTP traffic, and its sender is not branded |

Account prerequisites named in the error list: KYC before the OTP API (996), a first wallet transaction of at least ₹100 before any API use (999), and enough balance (416). Repeated SMS to one number can be flagged as spam (995), and our resend cooldown stays well under that.

**Status:**

- `FAST2SMS_API_KEY` is **not** in `JustFit_server/.env` or `.env.test` (checked by name, no value printed). The key pasted in chat must not be used.
- `.env`, `.env.test` and `JustFit_client/.env` are git-ignored, and only the `.example` files are tracked. The app's `.env` has no SMS variable; its `EXPO_PUBLIC_*` values are the Clerk publishable key and the API URL.
- **Not confirmed (needs your dashboard):** which route your account has, your DLT entity/sender ID/template status, the actual per-SMS price plus GST, whether failed messages are billed, and your KYC and wallet state. The docs publish no prices.
- Real delivery: **not tested.** Until a real OTP has arrived on your phone, everything runs on the fake adapter and phone sign-in stays off (`SMS_PROVIDER=off`).

DLT template to register (suggested text, one numeric variable): `{#var#} is your JustFit sign-in code. It expires in 5 minutes. Do not share it with anyone.`

---

## C. Design

### Identity rules

- **Id:** `user_` + 24 random base62 characters (`crypto.randomInt`), the shape the existing validators and the pass code already accept.
- **Phone:** the server accepts `9876543210`, `+919876543210`, `919876543210` or `09876543210` (spaces and dashes removed), and stores the 10 digits. It must start with 6–9 (Indian mobile).
- **Verified phone = login:** a new `phone_verified_at` column and a virtual `verified_phone` column (`IF(phone_verified_at IS NULL, NULL, phone)`) with a UNIQUE key. Phones typed during setup before this change are unverified: they never sign anyone in and are not touched. This is the `active_user` virtual-column pattern the schema already uses.
- After OTP sign-in, `POST /api/profile` **keeps the verified phone**, so the setup form can't change it. A form value is used only while the account has no verified phone, which with OTP never happens. Email stays optional: profile save no longer writes it.
- **Role:** new accounts are `user`. `trainer`/`admin` are granted only by `scripts/set-role.mjs` (now writing MySQL, looked up by phone). `POST /api/account-type` and `grantTrainerRole` are removed (decision 4).

### Tables (new)

```sql
otp_challenges (
  id CHAR(36) PK DEFAULT (UUID()),
  phone CHAR(10) NOT NULL,
  code_hash CHAR(64) NOT NULL,           -- HMAC-SHA256(otpKey, challengeId + ":" + code), hex
  status ENUM('pending','sent','failed','consumed','superseded','locked') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_phone_created (phone, created_at),
  KEY idx_otp_expires (expires_at)
)                                         -- no FK: a challenge may be for a number with no account yet

auth_sessions (
  id CHAR(36) PK DEFAULT (UUID()),
  user_id VARCHAR(64) NOT NULL,           -- FK users(id) ON DELETE CASCADE (one level, from users only)
  token_hash CHAR(64) NOT NULL UNIQUE,    -- SHA-256 of the bearer token
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,             -- refreshed at most once an hour
  expires_at DATETIME NOT NULL,           -- 30 days from creation (absolute)
  revoked_at DATETIME NULL,
  KEY idx_sessions_user (user_id)
)
```

Device data is not stored (no IP, no user agent).

### Secrets

One new server secret, **`AUTH_SECRET`** (≥ 32 random bytes, `JustFit_server/.env` only). Keys are derived per purpose with HKDF:
- `otpKey = HKDF(AUTH_SECRET, "justfit-otp-code")`
- member pass `deriveKey(AUTH_SECRET)`, keeping the `eato-member-pass` label. Switching the secret only invalidates passes on screen at that moment (they last 2 minutes).

The Fast2SMS key is never used for signing. Sessions need no secret: a 256-bit random token is stored as its SHA-256.

### OTP flow and limits (all configurable in `.env`)

| Setting | Default |
| --- | --- |
| Code | 6 digits, `crypto.randomInt(0, 1_000_000)` zero-padded |
| Expiry | 5 min |
| Attempts per challenge | 5 → `locked` |
| Resend cooldown per phone | 60 s |
| Sends per phone | 5 / hour, 10 / day (counted from `otp_challenges`, so restarts don't reset them) |
| Requests per IP | 10 / 10 min (in memory) |
| Verifies per IP | 30 / 10 min (in memory) |
| Global SMS cap | 500 / day (`OTP_DAILY_SMS_CAP`, protects the wallet) |

**Request** (`POST /api/auth/otp/request`):
1. Normalise the phone.
2. Check the IP budget, then the per-phone cooldown and limits, then the global cap.
3. Supersede earlier open challenges for the phone.
4. Insert a `pending` challenge with the hashed code.
5. Send it through the provider (8 s timeout).
6. Mark it `sent`, or `failed` → 503.

The answer is the same whether or not an account exists.

**Verify** (`POST /api/auth/otp/verify`), all in one transaction:
1. `SELECT … FOR UPDATE` the latest `sent` challenge for the phone.
2. Reject it if expired, locked or already consumed.
3. `attempts += 1`.
4. Constant-time compare (`crypto.timingSafeEqual`). A wrong code commits the attempt and answers 400. The 5th wrong code sets `locked`.
5. A match sets `consumed`.
6. Find the user by `verified_phone`, or insert a new `user_…` row (`role = 'user'`, `email` NULL). On a duplicate-key race, re-select.
7. Insert a session and commit.

Two concurrent verifies queue on the row lock; the second sees `consumed` and fails, so one code gives one session.

### Provider adapter (`auth/sms.js`)

`createSmsProvider(config)` returns `{ sendOtp(phone, code) }`:
- `fast2sms`: DLT route (or the OTP API, picked by config), `fetch` with `AbortSignal.timeout(8000)`, the key in the `Authorization` header. A provider error becomes `SmsError` with only Fast2SMS's numeric `status_code`. Nothing logs the phone, the code, the body or the key.
- `fake`: tests only. It writes `{ phone, code }` to a file under `SMS_FAKE_OUTBOX` (a temp folder the test harness creates), and the server **refuses to start** with `fake` unless `NODE_ENV=test` and `DB_NAME=eato_test`. There is no HTTP route that reveals a code.
- `off` (default): request-otp answers 503 "Phone sign-in isn't available yet." The server still starts, so the dev server on 4000 keeps working.

### API contracts

| Route | Auth | Body → Response |
| --- | --- | --- |
| `POST /api/auth/otp/request` | none (IP + phone limits) | `{ phone }` → `200 { sent: true, retryAfterSeconds: 60, expiresInSeconds: 300 }` · `400` bad phone · `429` + `Retry-After` · `503` provider off or failed |
| `POST /api/auth/otp/verify` | none (IP limit) | `{ phone, code }` → `200 { token, expiresAt, user: { id, role, fullName, profileComplete, isNew } }` · `400 { error: "That code isn't right." }` / expired / locked (one line each, never says whether the phone has an account) |
| `GET /api/auth/me` | session | → `{ id, phone, email, role, fullName, profileComplete }` |
| `POST /api/auth/logout` | session | → `{ signedOut: true }` (revokes this session) |
| `POST /api/auth/logout-all` | session | → `{ signedOut: true, sessions: n }` |

Bodies are `express.json({ limit: "1kb" })`, and unknown fields get a 400. Every other route is unchanged: same `Authorization: Bearer <token>` header, same `req.userId`.

### File changes (server)

| File | Change |
| --- | --- |
| `auth/` (new folder): `phone.js` (pure), `otp.js` (pure: generate, hash, compare, limits), `sessions.js`, `sms.js`, `routes.js` | the new code |
| `auth.js` | `requireUser` → session lookup (`auth_sessions` JOIN `users`; 401 if missing, expired or revoked). `getAccount(userId)` → `SELECT email, phone, role FROM users`, same return shape plus `phone`. `requireAdmin` unchanged apart from the source. `verifiedEmails` → `[]` (see below). `grantTrainerRole` removed. `@clerk/backend` no longer required here |
| `index.js` | mount `/api/auth`; remove `/api/account-type`; startup checks `AUTH_SECRET` instead of `CLERK_SECRET_KEY` |
| `owner/attendance.js` | `deriveKey(process.env.AUTH_SECRET)` |
| `owner/passes.js` | comment only (the key source) |
| `profile.js` | users upsert keeps the verified phone and an existing email; `account.email` no longer required |
| `community/members.js` | `ensureUser` → no Clerk call (the row always exists after sign-in; a missing row → 401). `currentRole` reads MySQL |
| `community/validate.js` | `clerkUserId` renamed `userId` (same regex); 4 router call sites |
| `rateLimit.js` | add `limitPerIp(limiter)` (same sliding window, keyed by `req.ip`) |
| `logging.js` | redact `phone`, `code`, `token` if a body is ever logged (today none is) |
| `schema.sql` + `migrations/2026-11-01-phone-auth.sql` | see D |
| `scripts/set-role.mjs` (app folder) | MySQL by phone. It moves to `JustFit_server/scripts/` so it uses the server's `.env` (proposed) |
| `.env.example`, `.env.test.example` | `AUTH_SECRET`, `SMS_PROVIDER`, `FAST2SMS_*`, `OTP_*` names, no values |

**Email features (decision 5):** kept, but limited by what phone accounts have.
- *Admin names a gym owner by email* still works for any account with an email: the 12 existing dev accounts, and accounts given one by `set-role`. A phone-only account has no email, so it can't be found this way. Fixing that means adding an "owner phone" option, which is a business change I won't make unless you ask.
- *Email invitations* match only **verified** emails. OTP accounts have none, so `myInvitations` returns nothing for email invitations, which fails closed. Invitations are still created and recorded as today.

`@clerk/backend` stays in `package.json` until the final cleanup phase. Nothing imports it after this phase except `scripts/set-role.mjs`'s old version, which is replaced.

---

## D. Migration

`migrations/2026-11-01-phone-auth.sql`, run by hand as root (`eato_app` can't alter tables):

```sql
ALTER TABLE users MODIFY email VARCHAR(255) NULL;                  -- uq_users_email stays; NULLs don't collide
ALTER TABLE users ADD COLUMN phone_verified_at DATETIME NULL AFTER phone,
                  ADD COLUMN verified_phone CHAR(10) AS (IF(phone_verified_at IS NULL, NULL, phone)) VIRTUAL,
                  ADD UNIQUE KEY uq_users_verified_phone (verified_phone);
CREATE TABLE IF NOT EXISTS otp_challenges (...);
CREATE TABLE IF NOT EXISTS auth_sessions (..., CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE);
```

Each `ALTER` is guarded (`information_schema` checks in a small procedure, as earlier migrations do) so the file is safe to run twice. `schema.sql` gets the same definitions, which is what the test database is rebuilt from.

- **Affected:** `users` only, plus the two new tables. The 87 foreign keys to `users(id)` (live count) are unchanged, because ids keep their type and format. Queries touched: the 4 listed under the email features, and `profile.js`'s users upsert.
- **Existing records:** no row is changed or deleted. The 12 dev users keep their Clerk ids, emails and data. They can no longer sign in (Clerk sessions stop being accepted), which is expected because they're disposable. The 2 setup phones stay unverified. The read-only check shows no duplicates.
- **Rollback (dev):** check out the previous commit, then run `ALTER TABLE users DROP INDEX uq_users_verified_phone, DROP COLUMN verified_phone, DROP COLUMN phone_verified_at; DROP TABLE auth_sessions, otp_challenges;`.
- **Not cleanly reversible:**
  - `email` back to `NOT NULL` fails once any phone-only account exists. Those rows would need an email or deletion, which needs your approval.
  - Dropping the tables loses sessions and challenges, which are short-lived and harmless.
  - Restoring the backup undoes everything, but also loses any data written after it.
- **Backup:** the newest one is `~/eato-backup-before-owner-portal.sql` from **2026-10-20**, older than the coach and admin migrations. A fresh one is needed first (your action, needs the root password):
  ```bash
  /usr/local/mysql/bin/mysqldump -u root -p --single-transaction --routines eato > ~/eato-backup-before-phone-auth.sql
  grep -c "CREATE TABLE" ~/eato-backup-before-phone-auth.sql    # should match the live table count
  ```

---

## E. Tests

Automated tests use the fake adapter only; no real SMS goes out.

**Unit (`npm test`, new files):**
- `auth-phone.test.js`: accepted and rejected formats, the 6–9 start rule, injection strings.
- `auth-otp.test.js`: code shape and range, hashing bound to the challenge id, constant-time compare, limit maths, expiry.
- `auth-sms.test.js`: the Fast2SMS request shape against a stubbed `fetch`; provider errors (416, 412, 995) and a timeout become `SmsError` with no phone, code or key in the message or the logs; `fake` refused outside `eato_test`.
- `owner-passes.test.js`: still passes with the new key source.

**e2e (`npm run test:e2e`, port 4100, `eato_test`):**
- New `auth.e2e.test.js`:
  - Valid OTP signs in, and a new phone creates exactly one `user` account.
  - Wrong, expired and replayed codes fail.
  - The 5th wrong attempt locks the challenge.
  - The resend cooldown, hourly/daily and IP limits answer 429 with `Retry-After`.
  - Provider failure → 503 with nothing sent; the next request works.
  - 10 parallel verifies of one code → one session.
  - The same phone twice → one account.
  - Unknown body fields, oversized bodies and SQL-injection phones → 400.
  - The response doesn't show whether the phone has an account.
- Sessions: valid, missing, malformed, unknown, expired (row backdated), revoked and logged-out tokens; `logout-all`; a deleted user's token → 401.
- Roles:
  - New accounts can't reach admin or trainer routes.
  - The body can't set a role.
  - `set-role` grants work at once.
  - A demoted admin loses access on the next call.
- `profileComplete` in `/api/auth/me` before and after setup.
- `POST /api/profile` can't change the verified phone.
- Email features: gym owner by email (an account with an email), and email invitations not matched for phone accounts.
- Harness: `clerk-identities.js` is replaced by `test-identities.js`, with the same function names (`createIdentity`, `createSession`, `revokeSession`, `deleteUser`, sweeper), which inserts users and sessions into `eato_test`. The 32 e2e files change only their `require` line. The 16 `setUnsafeMetadata` uses become a `profile_complete`/role update.
- Regression: the whole existing e2e suite, unchanged otherwise.

**UI (`npm run test:ui`):** in the next phase (app screens). The harness signs in by typing the phone and reading the code from the fake outbox.

**Baselines kept:** server unit 189, app unit 215, plus the new tests. I'll report the before/after counts.

**Run order:** unit → `test:e2e` (one heavy job at a time on this Mac) → review the diff. The dev server on port 4000 is never restarted by me.

---

## F. Rollback risks

- Once the branch is merged and the server restarted, **every Clerk session stops working**: all current users must sign in again with a phone. That's expected, but the app must ship the new sign-in screens at the same time as the server, or members get stuck. So the server change must not reach a running server before the app phase is done.
- The dev server on port 4000 picks up the new code only when you restart it. Until `AUTH_SECRET` is set it will refuse to start, and it always fails safely.
- Rolling back the code after phone-only accounts exist leaves rows with `email IS NULL`. The old code expects an email on every row (Clerk), so those accounts would be broken under the old code, and the dev data would need a clean-up.
- In-memory IP limits reset on restart, and behind a proxy every request shares one IP. `trust proxy` must be set when deployed behind one, which is a deployment setting needing approval.

---

## G. Needs your approval before anything is implemented

1. **Git:** the three commits and `git switch -c feature/phone-otp-auth` exactly as listed in A, and whether the reference folders and `.vscode/` stay uncommitted.
2. **Backup:** you run the `mysqldump` above and tell me it finished (I'll verify the file's table count).
3. **Schema:** the migration in D, the `schema.sql` change, and you running the migration on the dev `eato` database as root. The test database is rebuilt by the suite.
4. **New secret:** `AUTH_SECRET` in `JustFit_server/.env` and `.env.test`. You generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`; I won't see or print it.
5. **Behaviour:** removing `POST /api/account-type` and trainer self-selection; the email-feature limits in C; moving `set-role.mjs` to `JustFit_server/scripts/`.
6. **Provider (later, not blocking the code):** your Fast2SMS route, sender ID, template ID and price, and the new key in `.env`, so that one real OTP can be sent to your number with you watching.
