# Rehearsal: justfit-hero

Gold: `phone-touch`. Kept: a single phone pinned one gutter from the top and running off the bottom; the touch cursor; `Expand` for the open; a loop that leaves the way a phone does. Changed: the content is justFit's Macro look (tokens, Poppins, the CaloriesCard ring and tracks, the MealCard and coach Log button). The app opens out of a lock-screen notification (an `Expand` with `face`), not out of a list card. The loop ends by locking the phone, with a cover sheet sliding down, instead of folding a card back. Wallpaper is a flat #1c1c1e (the app's inverse colour), not the kit's gradient.

Beats: 1. lunch reminder tapped and the app launches out of it. 2. Today's plan loads from skeleton into the lunch card. 3. Log meal pressed and turns into Logged. 4. The ring, kcal and three macros roll a beat later. 5. Payoff: Priya's protein tip drops in and streams, and holds 2.6s. Then the lock and the next reminder. Loop ≈ 12.7s.

Captured: wide (460 × 720) and compact (358 × 640, at a 390 viewport); `--states`; open and lock beats at 70–80ms; posters at both widths; `--reduced` (shows the poster); the real page at 1280 and 390 (`JustFit_marketing`, dev server). Light look only (the site has no dark mode).

Film:
- Gate: `rehearsal passed` at both widths, in the playground and on the page.
- `handoff shift` on the notification (1–3px): the launch face is already scaling on the first frame after the swap. At rest the lock banner and the face measure the same (x, y, w, h within 0.1px). Stands.
- `near-empty frames` around the lock: the lock screen is a clock, a date and one banner, and the detector counts elements. The empty lock now lasts 0.15s before the next banner rises. Stands.
- `layout: jf-next … bottom padding`: the snack card is filler cut by the phone's screen edge, past the stage crop. Stands.
- `small text: ss-notification__time "now"` at 390: the kit draws notifications at true iOS size and never scales them. Stands.
- `kit override` (production bundle only): every kit rule is still inside `@layer stageshow` in `dist`. The detector can't tell kit CSS from demo CSS once Vite merges them into one file. The dev server, which serves them separately, passes. Stands.

Review (fresh-eye reviewer):
- Hard line under the phone: this was the filming tool's 16px pad. On the page the phone runs off the stage edge. No change.
- Lunch card ended about 20px short of the crop: fixed by making both stages 40px taller, so the snack card's top now shows.
- Gradient lock screen: replaced with flat #1c1c1e.
- Lock beat empty for too long: the reset now takes 0.15s, then the banner rises.
- Skeleton bars where the eye lands: kept. They are the brief's beat 2 ("the meal plan appears") and last about 0.7s.
- Double image on launch: fixed in two ways. The lock banner now hides at once, so Expand's face is the only copy. The app's surface comes up in 100ms, so the clock doesn't show through.
- Crossfade back to the lock screen: replaced by the cover sheet sliding down.
- No visible press on Log meal: the touch dot and the 0.96 press scale are both there, before the label changes.
- "1 ,040" in the poster: fixed. Numbers use `Roll` instead of `Count`, because Poppins' tabular 1 leaves a gap.

Assumptions: the figures (2,000 kcal target, 420 kcal breakfast, 540 kcal lunch, 68 g protein short) and Priya's tip are illustrative, not from a real account. The screen combines the Macro tab's summary with the coach's planned meal card, which the app shows on two different screens.

Unresolved: none blocking.

Not checked: Safari and Firefox (filmed in Chrome only); a real phone; the loop seam frame by frame at 40ms; how the hero sits in a final site layout with nav and sections around it.
