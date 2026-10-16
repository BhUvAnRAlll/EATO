# Log food — `/nutrition/log`

Step two: how to log. A chooser plus a strip of recent meals. It writes nothing
except a heart toggle.

Arrives with `{ slot, hour, minute }` and **forwards all three unchanged** to
whichever route the member picks.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Log food"**, spacer.
2. **Heading** *"How would you like to log?"*
3. **Method cards.** In FORMA this is a scan hero plus four options; with
   scanning and recipes out of scope, two remain, as full-width rows with an
   icon tile, title, subtitle and chevron:
   - **Manual Entry** — *"Type calories & macros"* → Manual entry.
   - A second row of two quick pills: **Favourites** (heart) → Favourites, and
     **Repeat meal** (clockwise arrow) → Repeat a meal.

   Give the most-used method the largest target. With scanning gone, manual
   entry is that method, so it takes the full-width card and the pills sit
   under it.
4. **Recent meals** — rendered only when there is at least one. A horizontal
   strip of food cards: photo (or a fork-and-knife fallback), a heart toggle in
   the corner, the title, `{kcal} kcal`, and a day label — *Today*,
   *Yesterday*, or `MM/DD`. Tapping a card opens the meal detail sheet for that
   meal; tapping the heart saves or removes it as a favourite.
5. **No footer button.** The cards are the actions.

## States

- **Loading** — none. The page is static; the recent strip appears when its data
  arrives.
- **Empty** — no recent meals simply means no strip.
- **Errors** — the heart toggle is fire-and-forget with no error UI in FORMA.
  Add a toast if you want one.

## Data

- `recentMeals({ limit: 12, today })` — last 3 days.
- `favorites.list()` — to know which hearts are filled.
- `favorites.toggle({ name, photoId?, sourceKey: 'meal:<id>', items })`.
- `deleteMeal({ mealId })` via the sheet.

## Navigation

- Pushes Manual entry, Favourites, Repeat a meal — each with the same
  `{ slot, hour, minute }` params.
- Back → Add meal.
