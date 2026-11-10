# justFit: final QA report (2026-11-10)

This covers the cross-platform audit, the responsive layout work, the device checks and the test
runs from 2026-11-08 to 11-10. The details are in `CROSS_PLATFORM_AUDIT.md`, `FEATURE_PARITY.md`
and `BUG_REPORT.md` (B01 to B58, R1 to R7).

## Devices

| Device | Width | How it was checked |
| --- | --- | --- |
| OnePlus CPH2467, Android 15, gesture navigation, text size 1.15 | 360 pt | USB, development build, screen by screen |
| iPhone 15 Plus | 430 pt | USB, development build, side by side with the OnePlus |
| Other Android sizes | 320 to 430 | The OnePlus's display density changed for each size, then put back |
| Web build | 320, 340, 360, 375, 390, 412, 430 | The automated layout suite (`responsive.ui.test.js`) |

## Responsive layout

- One layout on every phone: the app is laid out at the iPhone 15 Plus width (430 pt) and shrunk
  evenly on narrower phones (to 0.8 at most). Text, buttons, cards and icons keep the same
  proportions. A 360 pt phone shows the iPhone's screen at 0.84.
- The phone's own text-size setting is ignored, so text is the same size on both phones.
- On Android, every form keeps its field and Save button above the keyboard.
- The page colour is the same cream on both phones, and Android draws the iPhone-style icons.
- Automated: every main screen fits from 320 to 430 px with no sideways overflow (signed out, the
  member app, the gym portal, the Super Admin).

## Test results

| Suite | Result | When |
| --- | --- | --- |
| Client unit tests | 424 / 424 pass | 11-10 |
| Server unit tests | 622 / 622 pass (one test failed once and passed on the rerun) | 11-10 |
| Typecheck and lint (client) | clean | 11-10 |
| End-to-end (server against `justfit_test`) | 403 / 403 pass | 11-08; not rerun since other sessions added gym registration, reviews and meal ordering |
| UI (Expo web + Chrome), full run | 187 / 193 pass | 11-09 |
| UI: the 4 files with failures, rerun | admin 3/3, coach 13/13, templates 6/6, sign-out 5/5 | 11-10 |

What the 6 failures were:
- **Coach chat and the template test:** clashes, not bugs. Other sessions were editing files and
  sharing the test database during the run, and both pass on their own.
- **The admin test:** it was out of date, written before the new Orders tab.
- **The 3 sign-out tests:** a real bug. A nested button on the Meals tab (B57) put an error toast
  over the screen, and it is now fixed.

## Performance

Not measured with tools in this pass: no profiler traces or start-up timings were recorded.
What was observed: on both phones, screens open and scroll without visible stutter in the
development build. A development build is slower than a release build, so this says little about
release speed. The changes made for speed are in the gym portal's 2026-11-07 pass (paged lists,
parallel queries, photos shrunk before upload).

## Still open

| What | Needs |
| --- | --- |
| Gym portal and Super Admin checked side by side on both phones | The owner signed in as gym admin and Super Admin |
| A few Android icons differ slightly from the iPhone's (R6) | Hand-drawn icons, if wanted |
| Full UI and e2e runs on the latest code (other sessions are still adding features) | One run at a time on `justfit_test` |
| R1 to R5 in `BUG_REPORT.md` | The owner's decisions (exact alarms, a Terms page, and others) |
| A release build tested on both phones | A local release build (`npm run build:android`; Xcode Archive) |
