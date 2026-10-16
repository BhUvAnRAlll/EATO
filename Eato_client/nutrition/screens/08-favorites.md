# Favourites — `/nutrition/favorites`

Pick a food the member hearted earlier and log it in one tap.

Arrives with `{ slot, hour, minute }` when reached through the flow; it can also
be opened directly, in which case it asks for the slot itself.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Favourites"**, spacer.
2. **Grid of food cards**, two per row: photo or fallback glyph, a filled heart,
   the name and its kcal. Card width is `min(200, (screen − gutters − gap) / 2)`
   so two always fit. Tapping a card selects it; tapping its heart removes the
   favourite (and clears the selection if that was the selected one).
3. **"Add to" + slot segmented control** — shown only when something is selected
   **and** no slot came from upstream.
4. **Error line.**
5. **Footer button — "Log {name}"** with a plus icon and a spinner while saving.
   The footer exists only while something is selected.

## States

- **Loading** — full-screen loading state.
- **Empty** — dashed block, icon `heart`, title **"No favourites yet"**, body
  *"Tap the heart on a recent meal, a recipe, or right after a scan to save it
  here."* No action. **Reword this** if you drop recipes and scanning: *"Tap the
  heart on a recent meal to save it here."*
- **Validation** — not today → **"Meals can only be logged for today."**
- **Error** — the server message, or **"Could not log that favourite."**
- **Success** — dismiss the whole logging stack back to the hub.
- Removing a favourite is fire-and-forget in FORMA, with no error UI.

## Data

- `favorites.list()`
- `favorites.remove({ favoriteId })`
- `favorites.logFromFavorite({ favoriteId, date, slot, loggedAt })` — which
  copies the favourite's items into a new meal with `source: 'favorite'`.
  **Check ownership of the favourite server-side** (see `03-actions.md`).

## Navigation

- No pushes. Back → Log food. On success, dismiss to the hub.

## Where favourites come from

Nothing on this screen creates one. Hearts live on the recent-meals strip
(Log food) and inside the meal detail sheet. Each heart saves with a
`sourceKey` like `meal:<id>` so a second tap removes it again.
