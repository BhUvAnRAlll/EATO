# Server operations

What each screen calls. Names are FORMA's; the arguments and rules are the part
that matters. Reads are reactive in FORMA — a write updates every open screen
with no refetch — so none of the screens has a pull-to-refresh or a manual
reload. If your stack is request/response, add invalidation after each write.

**One rule runs through all of it: the signed-in member is resolved on the
server.** No screen ever sends a user id, and no operation accepts one.

## Reads

### `day({ date })`
`{ date, targets | null, totals, burned, meals[] }` — meals sorted by
`loggedAt`, each with its items, its summed totals and a resolved photo URL.
Returns `null` when the account is not provisioned; the UI treats that as
loading. `burned` is `0` in FORMA — there is no calorie-burn source yet, and the
Daily screen shows it rather than hiding the row.

### `dayProgress({ dates[] })`
`[{ date, kcal, target, ratio, status }]` for the week strip and month
calendar. Cap the list (FORMA: 40 dates).

### `periodSummary({ period, today })`
`period` is `today | week | month` (1, 7 or 30 days ending on `today`).
Returns averages per day against the daily target, plus **always** the last 7
days as `trend` and `trendAvg`:
`{ period, days, avg, targets, trend[], trendAvg }`. Returns `null` when there
is no target — the screen then shows its empty state rather than zeros.

### `recentMeals({ limit, today })`
Newest-first meals, filtered to the last 3 days, each with items and totals.
Clamp `limit` (FORMA: 1–50, default 12).

### `favorites.list()`
The member's favourites, newest first, each with items and summed totals.

### `targets.status()`
Either `{ status: 'ready', kcal, proteinG, carbsG, fatG, bmr, tdee, goal,
activityLevel, isManual, calculatedAt }` or `{ status: 'incomplete', missing[] }`.
The Adjust-targets screen branches on exactly this.

### `hydration.day({ date })`
`{ date, targetMl, baseTargetMl, activityAdjustmentMl, workoutAdjustmentMl,
consumedMl, remainingMl, progress, usedFallbacks, workoutMinutes, entries[],
preferences }`. A stored day row wins over a fresh estimate.

## Writes

### `logMeal({ date, slot, title, loggedAt, photoId?, source?, items[] })`
The single save path — manual entry, favourites and repeat all end here, which
is why one set of rules covers them all.

Validation, in this order:
1. `date` matches `YYYY-MM-DD`.
2. The date is today (within 24 h of the server's day), else
   **"Meals can only be logged for today"**.
3. `loggedAt` is finite and within −36 h … +18 h of now.
4. `items.length` is 1–50 — **"A meal needs at least one food"** /
   **"Too many foods in one meal"**.
5. Per item: all numbers finite; `0 < quantity ≤ 10000`; `0 ≤ kcal ≤ 5000`;
   each macro `0 ≤ g ≤ 2000`.
6. `title`, item `name` and `unit`: trimmed, non-empty, truncated to 120 chars.

Writes the meal row plus one item row each, and returns the meal id.

### `deleteMeal({ mealId })`
Deletes the items, then the meal. Verify the meal belongs to the caller and, if
not, fail with the same **"Meal not found"** as a missing row — do not reveal
that it exists.

### `favorites.toggle({ name, photoId?, items[], sourceKey? })`
With a `sourceKey`, a second call on the same key deletes the row; without one
it always inserts. Returns `{ favorited, favoriteId? }`. Name required, trimmed
to 120 chars; at least one item.

### `favorites.remove({ favoriteId })`
Ownership-checked delete.

### `favorites.logFromFavorite({ favoriteId, date, slot, loggedAt })`
Reads the favourite and calls `logMeal` with `source: 'favorite'`.

> **Carry over a fix here.** FORMA checks only that the favourite row *exists*,
> not that it belongs to the caller. Check ownership in your build: anyone who
> can guess an id could otherwise copy another member's favourite into their
> own day. Nothing is written to the other member's account, so it leaks data
> rather than corrupting it — but check it anyway.

### `targets.setManualTarget({ kcal, proteinG, carbsG, fatG })`
Rounds and saves, sets `isManual: true`. Requires an existing target row, else
**"Complete your profile before adjusting targets"**. Ranges: kcal 800–6000
(**"Calories must be between 800 and 6000"**), each macro 0–600 g
(**"Macro grams out of range"**).

### `targets.resetToCalculated()`
Clears `isManual`, recalculates immediately.

### `targets.recalculate()`
Recomputes from the profile. Called by the app after profile and plan changes,
and it **returns early when `isManual` is set**.

### `hydration.logWater({ date, amountMl, source?, label? })`
`date` must be today — **"Water can only be logged for today"**. Amount rounded
into 10–3000 ml. Max 60 entries per day —
**"Too many entries logged for one day"**. Label trimmed to 40 chars. Updates
the day's `consumedMl` cache.

### `hydration.removeEntry({ entryId })`
Ownership-checked, then refreshes the day cache. **"Entry not found"** when it
is missing or someone else's.

### `hydration.setReminders({ remindersEnabled, intervalHours?, startHour?, endHour? })`
Upsert. `intervalHours` clamped 1–12, hours 0–23, and
**"Reminder window must end after it starts"**.

### `hydration.recordWorkout({ date, minutes, intensity? })`
Called by the workout feature, not by any nutrition screen. Replaces the day's
workout adjustment and recomputes the target. `0 ≤ minutes ≤ 300`.

## Error handling the screens expect

- Form screens render the server's message inline, in the danger colour, with an
  alert accessibility role.
- One-shot actions (log water, remove entry, delete meal, save reminders) show
  a native alert with a title and a short retry line.
- Fire-and-forget actions (toggling a heart) have no error UI in FORMA. Worth
  adding a toast in your build.
