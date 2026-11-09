# justFit: cross-platform audit (2026-11-08)

Scope: the Expo app in `JustFit_client/` (Expo SDK 58, React Native 0.88, expo-router 58,
NativeWind 5 rc) and the Express server in `JustFit_server/`. Method: five read-only code audits
(member app ×2, gym portal ×2, iOS/Android parity) followed by fixes, automated tests, a new
seven-width web layout suite, and checks on one real Android phone.

## Architecture in one paragraph

One codebase serves three areas chosen by the account's role after phone sign-in: the **member
app** (`app/(user)/`: Home, Meals, Macro, Coach, Fitness/Workout, Profile; trainers get My
Clients), the **gym portal** (`app/gym/`, roles `gym_admin`; Staff limited per option by Role &
Permission) and the **Super Admin** (`app/admin/`). Every screen talks only to the Express server
through `lib/api.ts`; identity, roles and data live in MySQL. Native features come from Expo
modules: camera, image picker, location, notifications (local only), audio, speech recognition,
print, sharing, secure store, maps.

## Screen inventory (114 route files)

| Area | Screens |
| --- | --- |
| Signed out | onboarding, sign-in, sign-up (OTP sheet `VerificationModal`) |
| Setup (7 steps + scan) | personal, body-composition, scan-guide, body-scan, scan-report, goal, activity, food, lifestyle, targets |
| Member tabs | home, meals, macro, coach, workout (Fitness); trainers: clients |
| Macro | add-meal, log, manual, scan, favorites, repeat-meal, water, daily, calories-macros, adjust-targets |
| Coach | chat, meal-plan, swap-meal, intake (9 steps: goal, experience, schedule, spots, equipment, limits, lifestyle, coach, notes) |
| Fitness / workout | fitness/[id], fitness/category/[id], fitness/search, workout/day, workout/session |
| Profile and more | profile, measurements, goals, notifications, orders, plans, addresses, membership, membership/pause, attendance (QR scanner), clients/[id] |
| Gym portal | Home, Manage, Wallet; members, members/[id] (+ renew, due, pt), sale, service, transactions, invoice, catalog, enquiries, enquiry, expenses, attendance (+ settings, qr, member/[id]), pauses, predictions/renewals, staff, permissions (+ [userId]), templates, settings, branches, details |
| Super Admin | Overview, Users, Content, Gyms; users/[userId], gyms/[id], gyms/new, profile, ai-usage (+ history, budget), app-usage (+ members, retention, feature/[id]), programs, categories, exercises, promotions, home-content |

Shared building blocks: `SetupScreen`, `GymScreen`, `GymSectionScreen`, `AdminScreen`,
`GymSheet`, `BottomSheet`, `ActionSheet`, `ConfirmDialog`, `DatePickerSheet`, `Hud`,
`BottomTabBar`, `GymTabBar`, `PressableScale`, `Skeleton`, and since this audit `KeyboardAvoider`.

## Not in the app (so not tested)

These areas in the audit brief were removed earlier at the owner's request and are deliberately
absent: gym communities and feed, stories, direct chat between members, push notifications from a
server (only local meal reminders exist), payments and checkout (no billing), and food ordering
(Meals is a menu without checkout). Photo verification exists only as the body-fat photo estimate
in setup; attendance is QR plus GPS, not photo-based.

## Platform differences found

The single root cause behind most Android problems: **Android builds are edge to edge** (React
Native 0.88, `edgeToEdgeEnabled=true`). Two consequences the code did not account for:

1. **The window never resizes for the keyboard.** Eleven screens used
   `KeyboardAvoidingView behavior={ios ? "padding" : undefined}`, and eight admin forms relied on
   the iOS-only `automaticallyAdjustKeyboardInsets`. On Android the keyboard covered the lower
   fields and Save on every form: sign-in, setup, coach chat, macro forms, every gym form, every
   admin form. Confirmed on a OnePlus (Android 15). The keyboard height Android reports also
   leaves out the navigation bar, so a plain fix still left the last field half covered.
2. **Every Modal draws under the navigation bar.** Sheets with a fixed bottom padding put their
   last button under the 3-button navigation bar.

Other platform differences: the server voice clip was recorded as 3GP/AMR on Android but sent as
m4a; Android back and the iOS edge swipe skipped in-screen steps (confirm cards, the attendance
scanner, unsaved permission edits); the iOS call prompt opened "How did it go?" even when the call
was cancelled. Intended differences (native look) are listed in [FEATURE_PARITY.md](FEATURE_PARITY.md).

See [BUG_REPORT.md](BUG_REPORT.md) for every finding and its fix.
