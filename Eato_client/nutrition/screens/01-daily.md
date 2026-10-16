# Daily calories — `/nutrition/daily`

One day in full: what is left, water, macro progress, and the meals as a
timeline. Pushed from the hub's calorie card, and deep-linked from Home with a
`date` param.

## Layout, top to bottom

1. **Header.** Back chevron; centre title **"Daily calories"** with the long
   date under it; a spacer on the right so the title stays centred.
2. **Hero card, inverted** (ink background, light text):
   - Overline **"Remaining"**, then the remaining kcal as a large accent number,
     and under it *"kcal to reach your {target} target"*.
   - Right: a progress ring (100 pt, 10 pt stroke) with the percentage eaten in
     the middle.
   - A divider, then three stats across the bottom: **Eaten**, **Burned**,
     **Net** (eaten − burned).
   - `remaining = max(0, target − eaten)`, `percent = round(eaten / target × 100)`.
   - Burned is `0` in FORMA (nothing feeds it). Either wire it to your own
     activity source or drop the two stats.
3. **Water card** — appears once hydration data has loaded: drop icon,
   **"Water"** and the percentage, `{consumed} / {target} L`, a thin progress
   track, chevron → Water.
4. **Macros card.** Header **"Macros"** with a badge: **"On track"** (check, on
   a success tint) when protein ≥ 55% of its target and eaten ≤ the kcal target,
   otherwise **"Behind target"** (exclamation, warning tint). Then three rows —
   Protein, Carbs, Fat — each `{value}g / {target}g` with a bar.
5. **"Meals timeline".** One row per slot in the order **breakfast, lunch,
   snack, dinner** — every slot shows, logged or not:
   - A tinted slot marker with a connector line between rows.
   - Time: the logged time, or the slot's default (breakfast 7:30, lunch 12:30,
     snack 15:30, dinner 19:00).
   - Items joined with " · ", or **"Not logged yet"**.
   - Logged rows show kcal and open the meal detail sheet.
   - Unlogged rows are drawn with a dashed border and a plus glyph; on today
     they push Add meal with that `slot` pre-chosen, on other days they are not
     pressable.
6. **Footer button.** On today **"Add meal"** (plus icon) → Add meal. On another
   day **"Back to today"** (undo arrow), which jumps the date and pops back.

## States

- **Loading** — full-height spinner.
- **No target** — dashed block, icon `flame`, title **"Calorie target not set
  up yet"**, body *"Finish your profile (weight, height, birthday, workout days
  and goal) to see your daily calories here."* → profile. The rest of the screen
  is not drawn.
- **No water data yet** — the water card is simply absent; nothing shifts.
- **Empty slots** — shown as dashed "Not logged yet" rows rather than hidden.
- **Errors** — none inline; deletion errors come from the sheet.

## Data

- `day({ date: selectedDate })`, `dayProgress({ dates: week })`
- `hydration.day({ date: selectedDate })`
- `deleteMeal({ mealId })` via the sheet

## Navigation

- Pushes Water, Add meal (optionally with `slot`), the profile.
- Back → previous screen, falling back to the hub.
- Deep link: a `date` param that is a valid `YYYY-MM-DD` and not in the future
  jumps the shared date on mount.
