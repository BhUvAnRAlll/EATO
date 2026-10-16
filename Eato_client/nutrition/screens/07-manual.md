# Manual entry — `/nutrition/manual`

Type a food's numbers and save it as a meal. The main save path once scanning is
out of scope.

Arrives with `{ slot, hour, minute }`.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Manual entry"**, spacer. (FORMA also puts
   a "Scan instead" button here; drop it.)
2. **Lead copy** *"Know the numbers? Type them in and we'll add it to your
   day."*
3. **Food name** — text input with a pencil icon, placeholder *Homemade turkey
   chilli*.
4. **Quantity and serving size**, side by side: a numeric input (placeholder
   `350`) and a small segmented control **g / oz / cup**.
5. **Calories** — flame icon, numeric, placeholder `480`, trailing **kcal**.
6. **Macros** — three numeric boxes: Protein, Carbs, Fat, each with its
   macro-coloured dot, placeholder `0`, unit **g**.
7. **Add to** — a segmented control over the four slots, pre-set from the param.
8. **Sanity note** — the same 15% rule as Adjust targets: *"Macros add up to
   **{macroKcal} kcal** — close to your {kcal} entry. Looks good."* or *"…far
   from your {kcal} entry. Worth a second look."* A nudge, never a block.
9. **Error line** — danger colour, alert role.
10. **Footer button — "Add food"** with a plus icon and a spinner while saving.

Keep the whole form inside a keyboard-avoiding scroll view: six inputs do not
fit above the keyboard on a small phone.

## States

- **Validation**, in this order:
  1. Not today → **"Meals can only be logged for today."**
  2. Empty name → **"Give the food a name."**
  3. Calories 0 or blank → **"Enter the calories."**
- **Saving** — the footer button shows a spinner.
- **Server error** — the message inline, or **"Could not save that food."**
- **Success** — dismiss the whole logging stack back to the hub, where the new
  meal is already in the list.

## Data

One call: `logMeal({ date, slot, title, loggedAt, source: 'manual', items: [one
item] })`, where the item is `{ name, quantity, unit, kcal, proteinG, carbsG,
fatG }`. Quantity defaults to 1 and the unit to `serving` when quantity is left
blank. `loggedAt` is built from the selected date plus the `hour` and `minute`
params.

## Navigation

- Back → Log food. On success, dismiss to the hub (not a plain back).
