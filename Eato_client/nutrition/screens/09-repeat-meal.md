# Repeat a meal — `/nutrition/repeat-meal`

Re-log anything from the last three days as a new meal today. Same shape as
Favourites, different source and no hearts.

Arrives with `{ slot, hour, minute }`.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Repeat a meal"**, spacer.
2. **Lead copy** *"Anything from the last 3 days — pick one to log it again
   today."*
3. **Grid of food cards**, two per row, same sizing as Favourites: photo or
   fallback, title, kcal, and a day label — *Today*, *Yesterday* or `MM/DD`.
   **No heart here.** Tapping selects.
4. **"Add to" + slot segmented control** — only when something is selected and
   no slot came from upstream.
5. **Error line.**
6. **Footer button — "Repeat {title}"** with a clockwise-arrow icon and a
   spinner while saving. Shown only while something is selected.

## States

- **Loading** — full-screen loading state.
- **Empty** — dashed block, icon `arrow.clockwise`, title **"Nothing to repeat
  yet"**, body *"Meals you log in the last 3 days will show up here."*
- **Validation** — not today → **"Meals can only be logged for today."**
- **Error** — the server message, or **"Could not repeat that meal."**
- **Success** — dismiss the logging stack back to the hub.

## Data

- `recentMeals({ limit: 12, today })` — the same read the Log food strip uses.
- `logMeal({ date, slot, title, loggedAt, photoId, source: 'repeat', items })` —
  the items are **copied**, not referenced, so editing or deleting the original
  meal later leaves this one untouched.

## Navigation

- No pushes. Back → Log food. On success, dismiss to the hub.

## Why it is separate from Favourites

Favourites are curated and permanent; repeats are recent and temporary. They
look alike on purpose but answer different questions — *"the thing I always
eat"* versus *"the thing I ate yesterday"*. If you only want one, keep repeat:
it needs no curation from the member.
