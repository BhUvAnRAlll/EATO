# Adjust targets — `/nutrition/adjust-targets`

Override the calculated calorie and macro target by hand, or hand control back
to the calculation. Pushed from Calories & macros.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Adjust targets"**, spacer.
2. **Lead copy**, which depends on where the current target came from:
   - Manual: *"You set these by hand. FORMA will keep them until you reset to
     the calculated target."*
   - Calculated: *"These were calculated from your profile. Change them and
     FORMA will stop recalculating automatically."*
3. **Daily calories** — a single row: flame icon, numeric input (placeholder
   `2000`), trailing unit **"kcal"**.
4. **Macros** — three numeric boxes side by side: Protein, Carbs, Fat, each
   with its macro-coloured dot, placeholder `0`, unit **"g"**.
5. **Sanity note**, shown once both a calorie figure and some macros are typed.
   Compute `macroKcal = protein×4 + carbs×4 + fat×9`; "close enough" is within
   **15%** of the typed calories. Copy: *"Macros add up to **{macroKcal} kcal** —
   close to your {kcal} entry."* with a check, or *"…far from your {kcal}
   entry."* with a warning triangle. It never blocks saving.
6. **Error line** — danger colour, marked as an alert for screen readers.
7. **"Reset to calculated"** — a ghost button with a counter-clockwise arrow,
   shown only when the current target is manual.
8. **Footer button — "Save targets"**, with a spinner while saving.

The four fields are seeded from the saved target once, on first load, and never
re-seeded, so typing is never overwritten by a background update.

## States

- **Loading** — full-screen loading state.
- **Profile incomplete** — the header, then centred copy: *"Finish your profile
  first — there's no calculated target yet to adjust."* No action button, no
  form.
- **Client validation** — empty or zero calories → **"Enter your daily
  calories."**
- **Server errors** — shown inline: *"Calories must be between 800 and 6000"*,
  *"Macro grams out of range"*, *"Complete your profile before adjusting
  targets"*.
- **Success** — no toast; the screen simply pops back, and the previous screen
  already shows the new numbers.

## Data

- `targets.status()` — `ready` with the current values and the `isManual` flag,
  or `incomplete` with the missing fields.
- `targets.setManualTarget({ kcal, proteinG, carbsG, fatG })` — blank fields
  send 0.
- `targets.resetToCalculated()`.

## Navigation

- No pushes. Back → Calories & macros. Save and reset both pop back.
