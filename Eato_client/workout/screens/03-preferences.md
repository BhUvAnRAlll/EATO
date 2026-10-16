# Preferences — `/workout/preferences`

Four settings, and the door to the full rebuild. A full-screen modal rising from
the bottom: changing a plan is an interruption, not a drill-down.

Note for the port: inside a full-screen modal the native safe-area container may
report no top inset. Apply the inset by hand rather than wondering why the close
button sits under the clock.

## Layout

1. **Header** — a single close button, top right.
2. **Heading** — **"Workout preferences"** with **"Review your workout
   preferences. You can edit anytime before submitting."**
3. **Trainer notice**, when the plan is trainer-managed: an info-tinted strip —
   **"Your trainer manages this plan, so these settings are read-only."** The
   rows then lose their pencils and their press handlers.
4. **Four rows**, each a card with a 46 pt icon disc, an overline label over the
   current value, and a trailing pencil disc:
   - **Fitness goal** → the goal label
   - **Fitness level** → the level label
   - **Workout days** → the weekdays, formatted
   - **Workout split** → the split label
5. **Footer** — an optional centred error line; **"Submit"**, disabled until
   something changed; an **"OR"** divider between two hairlines; and a ghost
   **"Re-create plan"**.

## The sheets

- **Option sheet** for goal, level and split: radio rows with an accent check on
  the selected one; picking closes the sheet. Split options carry a one-line
  note each explaining what the split means.
- **Weekday sheet**: title **"Workout days"**, subtitle **"Pick at least 3 days
  ({n} chosen)."** while under the minimum, otherwise **"{n} days a week"**.
  Seven toggles, Monday first. **"Done"** is disabled below three days.
  Reopening resets to the saved value, so an abandoned edit does not leak.

## States

- **Loading** — a bare spinner, and no footer at all. Do not show a submit
  button over data that has not arrived.
- **Dirty tracking** — compare goal, level and split directly, and weekdays as a
  set. Submit stays disabled until something really changed.
- **Error** — the server's message, else **"Could not save your preferences"**.
- **Success** — no toast; the modal closes and the hub behind it already shows
  the new plan.

## Data

- `preferences()` — the four values plus whether they are editable
- `updatePreferences({ goal, level, weekdays, split, today })`

Submitting generates a whole new plan and supersedes the old one. Say so near
the button if your members would be surprised; FORMA relies on the rebuild
flow's copy to carry that message.

## Navigation

- Close → back, falling back to the hub.
- **"Re-create plan"** → the rebuild flow at step 1.
