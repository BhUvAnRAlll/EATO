# Add meal — `/nutrition/add-meal`

Step one of logging: which meal, and what time. It writes nothing.

## Layout, top to bottom

1. **Header.** Back chevron, title **"Add meal"**, spacer.
2. **Heading** *"Which meal?"* with *"Choose a slot so your daily totals stay
   organised."* under it.
3. **Slot grid**, two per row, as a radio group. One card per slot in the order
   breakfast, lunch, snack, dinner. Each card: a tinted slot icon, a radio dot
   that becomes a check when selected, the slot name, and its window —
   breakfast *6:00 – 10:00*, lunch *12:00 – 14:00*, snack *Anytime*, dinner
   *18:00 – 21:00*. A slot already logged today also shows a green **"Logged
   today"** line. The selected card takes a 2 pt ink border.
4. **Time.** A horizontal chip row: a leading **"Now"** chip with a clock icon,
   selected by default, then half-hour chips covering the chosen slot's window.
   Changing the slot resets the choice back to "Now".
5. **Note card** with a sparkle icon: *"You have {remaining} kcal left today."*
   — `remaining = max(0, target − eaten)`, and 0 when there is no target.
6. **Footer button — "Continue"** with a trailing chevron.

## States

No loading, empty or error state. The grid renders immediately; the day data
only feeds the "Logged today" badges and the kcal note, and the screen is useful
without it.

## Data

- `day({ date: selectedDate })` and `dayProgress({ dates: week })`, read-only.

## Navigation

- **Continue** pushes Log food with `{ slot, hour, minute }`. The time is the
  chosen chip, or — when "Now" is selected — the current clock time on today, or
  the first option of the slot's window on another day.
- Back → the hub.

## If you simplify

This screen exists to keep totals tidy and to make the time explicit. A smaller
app can skip it and jump straight to the method chooser with `slot` defaulted
from the clock (before 10:00 breakfast, before 14:00 lunch, before 17:00 snack,
otherwise dinner) — the save path takes the slot either way.
