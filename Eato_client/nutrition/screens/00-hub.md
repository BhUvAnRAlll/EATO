# Nutrition hub — `/nutrition`

The tab's landing screen. The day at a glance: how many calories are left, and
what has been eaten.

## Layout, top to bottom

1. **Header row.** Left: the selected day in long form (*"Monday 14 October"*)
   as a small muted line, with the title **"Nutrition"** under it. Right: two
   round icon buttons — a drop (*"Water"*) → Water, and a calendar
   (*"Jump to a day"*) → opens the month calendar sheet.
2. **Week strip.** Seven day rings, oldest first, with the weekday initial under
   each. The ring is graded by that day's status (see grading in
   `02-data-model.md`); a day with nothing logged draws a dashed ring. Tapping
   one selects it, with a selection haptic.
3. **Calorie card** — only when a target exists. A large progress ring with
   **kcal left** as the number and "kcal left" under it; to its right two stat
   columns, **Eaten** and **Target**; along the bottom three macro bars
   (Protein, Carbs, Fat) each reading `{value}/{target}g`. The whole card is
   tappable → Daily calories. Ring 148 pt, dropping to 120 pt under 375 pt wide.
4. **"Calories & macros" row.** Pie icon, title, subtitle *"Split, weekly trend
   & targets"*, chevron → Calories & macros.
5. **Section header.** *"Today's meals"* on today, *"Meals"* on any other day.
6. **Meal list.** One card per logged meal: photo thumbnail (or a slot glyph
   when there is no photo), the slot label, the item names joined with commas,
   the kcal, and the logged time. Tapping one opens the meal detail sheet.
   The list fades in over 200 ms when the day changes, and sits at 55% opacity
   while a new day loads.
7. **Floating action button**, bottom right, pill-shaped: on today a camera icon
   with **"Add meal"** → Add meal; on any other day an undo-arrow with
   **"Back to today"**, which jumps the selection back.

## States

- **Loading** — spinner in the body; the header and week strip stay put.
- **No target** — in place of the calorie card: a dashed block, icon `flame`,
  title **"Calorie target not set up yet"**, body *"Finish your profile
  (weight, height, birthday, workout days and goal) to see your daily calorie
  target here."* Tapping it opens the profile.
- **No meals** — a dashed block, icon `fork.knife`, title *"Nothing logged
  yet"* on today or *"Nothing was logged"* otherwise; body *"Add your first
  meal to start today."* or *"This day has no meals. You can only log meals on
  the day you eat them."* Tappable only on today → Add meal.
- **Errors** — none on this screen; a failed day read is treated as loading.

## Data

- `day({ date: selectedDate })` — targets, totals, meals.
- `dayProgress({ dates: week })` — the strip's ring colours.
- `dayProgress({ dates: monthDays })` — only while the calendar sheet is open.

## Actions and navigation

- Meal detail sheet → `deleteMeal({ mealId })`.
- Pushes: Water, Daily calories, Calories & macros, Add meal, and the profile.
- No back button: this is the tab root.

## Sheets used here

- **Meal detail sheet** — photo, title, slot and time, the source label
  (*"Logged"*, *"From favourites"*, *"Repeated"*), macro bars, and an
  ingredients table with Amount and Calories columns. Its one action is delete:
  confirm with **"Remove this meal?"** / *"{title} will be taken off your day."*
  (Keep / Remove), the button reading *"Removing…"* while it works, and on
  failure an alert **"Could not remove that meal"** / *"Check your connection
  and try again."*
- **Month calendar** — a sheet titled *"Jump to a day"* with a Done button,
  month navigation capped at today, a grid of day rings, and a legend: *On
  target*, *Part way*, *Nothing logged*.
