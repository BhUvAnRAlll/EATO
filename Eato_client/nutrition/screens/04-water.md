# Water — `/nutrition/water`

Log and review the day's hydration against an estimated target. Reached from the
hub's drop button, the Daily screen's water card, and the active workout screen.

## Layout, top to bottom

1. **Header.** Back chevron; centre **"Water"** with the long date under it;
   right a calendar button (*"Jump to a day"*) opening the month sheet.
2. **Progress card.**
   - Left: an animated glass, 88 × 152 pt, filling over 450 ms when the amount
     changes, with tick labels at a quarter, half and three quarters of the
     target. Hidden from screen readers — the numbers next to it carry the
     meaning.
   - Right: overline **"Today"**, the consumed litres as a hero number with
     `/ {target} L` beside it, a pill reading *"{percent}% of goal"*, and a
     footnote: *"Estimated target reached"* when done, otherwise *"{remaining} L
     to go · about {n} glasses"* (a glass is 250 ml, rounded up).
   - Two optional notes: *"{minutes} min workout · +{ml} ml"* when a workout
     raised the target, and *"Add your weight in your profile for a closer
     estimate."* when the estimate fell back to defaults.
3. **Quick add** (today only) — two preset tiles, **+250 ml · Glass** and
   **+500 ml · Bottle**, plus a quieter **Custom / Pick amount** tile that opens
   the custom sheet.
4. **Reminders card** (today only) — bell icon, **"Hydration reminders"**, a
   summary line such as *"Every 2 hours · 8 AM – 8 PM"*, and a switch.
5. **Log section.** Header *"Today's log"* or *"Log"* with the entry count.
   One row per entry: drop icon, a title built from the label, time and source,
   the time, the amount in ml, and — on today only — an × to remove it.
6. **Floating action**, bottom: on today **"Add a glass · 250 ml"** with a plus;
   on another day **"Back to today"**. It hides (opacity 0, not pressable) while
   a sheet is open.

Every water log fires a light haptic on iOS before the write.

## States

- **Loading** — centred spinner.
- **Switching day** — the previous day stays at 55% opacity.
- **Empty log** — dashed block, icon `drop`, title *"Nothing logged yet"* /
  *"Nothing was logged"*, body *"Add your first glass to start the day."* /
  *"This day has no water logged. You can only log water on the day you drink
  it."*
- **Errors** — alerts: **"Could not log water"** / *"Please check your
  connection and try again."*; **"Could not remove entry"** / *"Please try
  again."*; **"Could not save reminders"** / *"Please try again."*
- **Success** — implicit: the glass animates and the total updates.

## The custom amount sheet

Drawn in the screen's own tree rather than as a modal, so it sits above the
floating button. A stepper in 50 ml steps starting at 300 ml, quick chips for
150 ml / 300 ml / 750 ml / 1 L, clamped to **10–3000 ml**, and a submit button
reading **"Add {amount} ml"**.

## Data

- `hydration.day({ date: selectedDate })`
- `hydration.logWater({ date, amountMl, source, label? })` — `quick_add` for the
  presets, `custom` for the sheet
- `hydration.removeEntry({ entryId })`
- `hydration.setReminders({ remindersEnabled })`
- The month sheet reads `dayProgress` — its rings grade **calories**, not water.
  Match that or give water its own grading; just don't mix the two meanings.

## Navigation

- No pushes. Back → the hub.
