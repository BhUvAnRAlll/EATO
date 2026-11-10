# justFit: bug report (2026-11-08 cross-platform pass)

Platforms: **A** Android, **i** iOS, **all** both phones (and the web build where it applies).
Retest: **D** checked on the Android phone, **T** covered by an automated test, **C** fix
reviewed in code plus typecheck/lint/unit tests (still needs a manual check on a phone).
Steps to reproduce are short. "At 320" means a 320-point-wide phone (iPhone SE size), "large
text" means the system font size raised to 1.3× or more.

## High

| ID | Module | Platform | Problem and how to reproduce | Root cause | Fix | Retest |
| --- | --- | --- | --- | --- | --- | --- |
| B01 | Every form (sign-in, setup, coach chat, macro forms, membership pause, gym and admin screens) | A | Tap a field low on a form: the keyboard covers it and the Save button | Edge to edge: Android no longer resizes the window, and `KeyboardAvoidingView` had no Android behaviour | New `components/KeyboardAvoider.tsx` (padding on both, Android nav-bar offset) used by all 11 screens | D, T |
| B02 | Admin forms (new/edit gym, program, category, exercise, AI budget) | A | Same as B01 | Relied on iOS-only `automaticallyAdjustKeyboardInsets` | Wrapped in `KeyboardAvoider` | C, T |
| B03 | Gym sheets (`GymSheet`) | A | Type in the last field of a sheet: its button stays behind the keyboard | Android's keyboard height excludes the nav bar; the sheet window is edge to edge | Nav bar added to the lift on Android | C, T |
| B04 | Collect Due / Add Service / Sell Product with Send Invoice | all | Tick Send Invoice and save from a member's ⋯ sheet: the invoice opens hidden behind the still-open sheets | The sheet pushed the screen itself while its parents stayed open | Sheets hand "send invoice" to the caller, which closes every sheet then opens the invoice | C |
| B05 | Coach voice (server transcription) | A | Record a Kannada question on an Android phone whose recogniser lacks Kannada: poor or failed text | `LOW_QUALITY` preset records 3GP/AMR on Android, sent as m4a | AAC m4a 64 kbps on both phones | C, T (needs new dev build) |
| B06 | Gym Expenses / Enquiries | all | The round + sits on the Android nav bar / iPhone home indicator | `absolute` button ignores the parent's safe-area padding | Lists are a `flex-1` View, so the + sits inside the padding | C |
| B07 | Super Admin › App Usage › Export CSV | all phones | Export says "Saved to the app's files" (not reachable); a failure leaves the spinner forever | Wrote to the private cache with no share step, no try/catch, no timeout | Share sheet like attendance export, try/catch, timeout | C |
| B08 | Reminder Templates e2e | test | `gym-templates` e2e test 8 failed with 429 | Fixed 30/hour budget spent by earlier tests in the same file | Budget configurable (`GYM_TEMPLATE_CHANGES_PER_HOUR`, default 30), raised on the test server | T |

## Medium

| ID | Module | Platform | Problem | Fix | Retest |
| --- | --- | --- | --- | --- | --- |
| B09 | Android action sheet (`ActionSheet`) | A | Cancel under the 3-button nav bar | Bottom padding + inset | C, T |
| B10 | Sign-in code sheet (`VerificationModal`) | A | Resend row under the nav bar; code field low with keyboard | Inset + Android keyboard offset | C, T |
| B11 | Macro calendar sheet, Water custom sheet | A, i | Last row under nav bar / home indicator | Bottom padding + inset | C, T |
| B12 | Workout "End this session?" / Move-Swap prompt (`WorkoutSheet`) | all | Android back leaves the screen mid-prompt; prompt doesn't cover the tab bar; buttons under the nav bar | Now a Modal with back handling and inset | C, T |
| B13 | Setup › Select sheet (activity level) | all | At 320 with large text the sheet grows past the screen; top options unreachable | Options scroll; sheet capped at 86% | C |
| B14 | Scan report, Measurements confirm card | all | Android back / iOS swipe on the confirm card leaves the screen and loses typed values | `usePreventRemove`: back returns to the form | C |
| B15 | Member attendance (QR) | all | Back from scanner/result leaves the screen; result can pop over after leaving the step; hint under nav bar | Back steps back inside the flow, ignored while checking; bottom inset | C |
| B16 | Setup › Lifestyle | all, 320 | Tile labels break mid-word ("Car-dio", "Afternoo-n") | Two tiles a row under 360 wide | C |
| B17 | Setup › Targets | all, 320 | "30% of kcal" spills out of its tile | Text column shrinks | C |
| B18 | Home promotion slide | all, 375 | CTA clipped with a 3-line headline or large text | Height is a minimum, text capped at 1.3× | C |
| B19 | Coach › Swap meal › Edit portions | all, 320 | Food name shrinks to "B…" | Steppers on their own row under the name | C |
| B20 | Water, Daily | all | Quick day switches leave the wrong day dimmed | Stale-response guard | C |
| B21 | Favourites, Repeat meal, Scan food | all | Double tap logs the meal twice | Ref guard | C |
| B22 | Date row in gym sheets (`DateSelect`) | all, 320 | "Pay the other ₹2,500 by" pushes the date button off the sheet | Row wraps | C |
| B23 | Member list round + | all | Shown to Staff without Add Member; floated 34 pt high on iPhones; two Add buttons on Members | Shown only in Manage, only with Add Member, above the tab bar | C |
| B24 | Confirm dialogs | all, small phone + large text | Edit/Confirm pushed off screen by 7 rows | Rows scroll, buttons stay | C |
| B25 | Admin AI Usage / history / exercise rows (`ai-kv`) | all | Values cut off at the card edge | Both sides shrink | C |
| B26 | Role & Permission editor | all | Back/swipe drops unsaved ticks without asking | "Discard changes?" prompt | C |
| B27 | Gym attendance chart | all | Per-bar counts show "…" | Count drawn only where it fits | C |
| B28 | Enquiries call follow-up | i | "How did it go?" after cancelling the call prompt | Ask only after the app went to the background | C |
| B29 | Branch details | all | Save left the screen, dropping unsaved invoice edits; did nothing on a deep link | Stays on screen, shows "Branch details saved" | C |
| B30 | Send Reminder for Staff without SMS | all | "Couldn't check credits" and a 403 on every bell | Credits not asked for; SMS opens the phone's Messages app | C |
| B31 | HUD snackbar | A | Hidden behind the keyboard while typing | Rides above the keyboard | C |

## Low

| ID | Module | Platform | Problem | Fix | Retest |
| --- | --- | --- | --- | --- | --- |
| B32 | Send Reminder tiles | all, 320 | Tick spills out of the tile; "Notification" breaks mid-word | Tick in the corner; label shrinks to fit | C |
| B33 | Member page plan row | all, 320 | Long plan name pushes the status off | Plan text shrinks (2 lines) | C |
| B34 | Member card PT pill | all | Long package name overflows the card | Pill capped at the card width | C |
| B35 | Due Members ID | all, large text | Long ID pushes the PT tag out | ID shrinks | C |
| B36 | Add Member steps 2 and 3 | all | Step opens scrolled down; drag-to-close stops working | `GymSheet` `scrollKey` scrolls to top per step | C |
| B37 | Workout player figure | all, 320 / large text | Timer wraps or overflows | One line, fits | C |
| B38 | Manual food header | all, 320 | Long name pushes Remove off | Name truncates | C |
| B39 | Workout day About rows | all, 320 | Long title overflows | Value wraps right-aligned | C |
| B40 | Segmented control, Add meal button, badge, metric pill, home pill | all, large text | Text clipped by fixed heights | `min-height` | C |
| B41 | Meal plan, swap meal, fitness search, category grid, Profile | A, i | Last row under the nav bar | Bottom inset | C |
| B42 | Coach chat Apply / Undo | all | Meal reminder kept the old dish's name | Reminders re-synced after apply/undo | C |
| B43 | Catalogue day-plan pill | all, 320 | Price pushed off | Pill shrinks | C |
| B44 | Attendance stat labels | all, 320 | "Completed" cut off | Shrinks to fit (native) | C |
| B45 | Enquiry contact options | all, 320 | "replied"/"no reply" cut off | Two lines | C |
| B46 | Admin back arrow, promotion save | all | Did nothing on a cold deep link | Falls back to the admin home | C |
| B47 | Busy-hours ticks | all | Labels drift from their bars | One tick cell per bar | C |
| B48 | Logo picker | all | Unhandled error, double picker | Caught, guarded | C |
| B49 | Sign-up "Terms & Privacy" | all | Looked like a link, did nothing | Link styling removed (no justFit terms page exists yet) | C |
| B50 | expo-router warning | all | `initialRouteName` deprecated warning on every start | `anchor` | D |

## Not fixed (documented)

| ID | Problem | Why not |
| --- | --- | --- |
| R1 | Meal reminders can arrive late on Android 12+ under Doze | Needs the exact-alarm permission (a native permission and a Play Store declaration): owner's decision |
| R2 | Camera preview and Google map show square corners on Android | Platform surface views ignore rounded clipping; cosmetic |
| R3 | A photo can be lost if Android kills the app while the camera is open | Needs `getPendingResultAsync` handling on each photo screen; low frequency |
| R4 | Gym sheets don't ask before discarding a half-filled form on back/drag | Behaviour change across every sheet; needs the owner's call on when to ask |
| R5 | justFit has no Terms / Privacy page | Content the owner must provide (also needed for the YouTube API terms) |

## Update 2026-11-08 to 11-10: same look on both phones, then the full UI run

Both phones were checked side by side on the device: the OnePlus CPH2467 (Android 15, 360 pt
wide, text size 1.15) and the iPhone 15 Plus (430 pt wide).

| ID | Module | Platform | Problem | Fix | Retest |
| --- | --- | --- | --- | --- | --- |
| B51 | Whole app | A, narrow phones | Android rearranged or squeezed screens that the iPhone showed comfortably | The app lays out at 430 pt and shrinks evenly on narrower phones (`constants/uiScale.ts`, `lib/reactNative.js`, `lib/safeArea.js`). Modals, the keyboard and the insets use the same scale | D (both phones, side by side) |
| B52 | All text | A | The OnePlus's 1.15 text setting made its text larger than the iPhone's | The phone's text size is ignored (`MAX_FONT_SCALE` = 1), the owner's choice | D |
| B53 | Page background | A | Looked pure white on Android, cream on the iPhone | Page colour `#F6F4EF` in the tokens and `app.json` | D (both measured 246,244,239) |
| B54 | Icons | A, web | Material icons looked unlike the iPhone's SF Symbols | Lucide twins for 223 names, filled shapes, hand-drawn sparkles and gear | D (most match; see R6) |
| B55 | Macro › Add meal | A | An inline button instead of the iPhone's floating dark pill | `FloatingSlot`, the same pill on every phone | D |
| B56 | App start | A, i | A crash after a cache clear (`Platform` undefined), and the iPhone stuck on the splash screen | The `react-native` shim exports a lazy Proxy; the root falls back to unscaled if the shim is missing | D (both phones) |
| B57 | Meals tab, Deliver-to card | web (all) | A button nested inside a button. On the web build the error toast covered "Log in", and 3 sign-out UI tests failed | The card is two sibling buttons | T (sign-out 5/5) |
| B58 | Super Admin Overview UI test | test | It expected no Orders tab, which was added with meal ordering | The test now expects Overview, Orders, Users, Gyms, Content | T (admin 3/3) |

| ID | Not fixed | Why not |
| --- | --- | --- |
| R6 | A few Android icons still differ slightly from the iPhone's (house, fork and knife, some person badges, map pin, moon) | Lucide has no exact twin; each would need hand drawing |
| R7 | The gym portal and Super Admin are not yet checked side by side on both phones | Needs the owner signed in on each phone |
