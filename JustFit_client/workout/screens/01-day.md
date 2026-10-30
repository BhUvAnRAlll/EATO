# Training day — `/workout/day`

One day's session in full: the exercise list, what it trains, and the facts
about it — with the way into the player. Pushed with a `date` param, falling
back to today.

## Layout, top to bottom

This screen is full-bleed: light status bar, art to the top edge, no safe-area
container.

1. **Art block, 384 pt.** The session-type photo under a gradient that darkens
   top and bottom. Over it:
   - Chips: the level in an accent chip, plus a glass **"Trainer plan"** chip
     when applicable.
   - Title, 28 pt, up to 2 lines: **"{session title} · {goal focus}"**.
   - Two meta lines: the gym name (when known), and **"{Today | long date} ·
     Main Workout"**.
   - A glass stats bar: exercise count labelled **"Exercises"**, a hairline,
     then minutes with the unit **"min"** labelled **"Duration"**.
   - Floating circular buttons over the art: back on the left, share on the
     right.
2. **Sheet**, overlapping the art by 28 pt with a large top radius. It opens
   with a three-tab bar — **Exercises / Muscles / About** — the active tab
   marked with an ink pill.

### Exercises tab
One group per non-empty section, in order **Warm Up / Workout / Stretch**. Each
group heads with the section name, then **"· {minutes} min"**; the first group
also shows **"{n} sets total"** on the right.

Rows: a 52 pt thumbnail (or a muscle-group glyph), the exercise name over
**"{muscle} · {focus}"**, and on the right **"{sets} × {repsMin}–{repsMax}"**
over **"sets × reps"** — or **"{n} sets"** over the full prescription for timed
work. A "more" button opens an alert with the prescription and up to three
actions: **"Start from this exercise"**, **"Watch demo"** (opens the video),
**"How to do it"** (a nested alert with the numbered instructions).

Tapping a row starts the player at that exercise — only on today, and only when
the session is not already complete.

### Muscles tab
Computed on the device from the exercise list: one row per muscle group with its
icon, the label, **"{n} exercises · {m} sets"**, and a bar scaled to the busiest
group. Sorted by sets, descending.

### About tab
Rows: **Level**, **Goal**, **Session**, **Duration**, **Exercises** (*"{n} ·
{m} sets"*), **Estimated burn** (*"~{kcal} kcal"*, hidden when it cannot be
computed), **Gym** (when known), and **Planned by** — *"Your trainer"* or
**"FORMA workout engine"**. Name your own engine here; the member deserves to
know a machine wrote it.

## Footer

- Today and completed → not a button but a success badge with a tick reading
  **"Completed"**.
- Otherwise a button, disabled unless the date is today: **"Start Workout"**,
  **"Continue Workout"**, or — disabled — **"Missed"**, **"Completed"**, **"Not
  yet"** (future), **"Not today"** (past).
- A session under way also gets a ghost **"End session"** button, which confirms
  with 🛑 **"End this session?"** / *"The sets you logged are kept. Today goes
  back to planned, so you can start again or move another session here."* /
  **"End session"** / **"Keep going"**.

## States

- **Loading** — spinner with **"Loading"**.
- **Rest day** — dashed block, moon icon, title **"Rest day"**, body **"Nothing
  scheduled today. Recovery is part of the plan."** on today, or **"Nothing is
  scheduled on this day."** otherwise.
- **End-session error** — **"Could not end the session. Try again."**

## Data

- `home({ date, dates: weekOf(date), today })`
- `sessionProgress({ date })` — only while a session is running
- `abandonSession({ logId })`

## Share

Shares a plain-text block: the title and long date, the minutes, a blank line,
then one bullet per exercise with its prescription.

## Navigation

- Opens the player with `date`, plus `exercise` when started from a row.
- Back → wherever it was pushed from.
