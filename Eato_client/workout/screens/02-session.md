# Session player — `/workout/session`

Run the session set by set, full-bleed over the exercise's demo clip. This is
the dark, focused screen: the phone is propped against a rack and read at arm's
length.

Pushed with a fade (a slide under a video reads as a glitch). Params: `date`,
and optionally `exercise` to start partway in. The status bar is hidden and the
root is black.

## The step list

Built once from the day: **every set of every exercise in plan order**, with a
rest step inserted after each set — except after the very last set of the last
exercise, and except where the exercise's rest is zero.

So a day of 3 exercises × 3 sets with rest is: set, rest, set, rest, set, rest,
set … ending on the final set, not on a rest.

## Layout

- **Backdrop** — the exercise's demo clip, looping, muted, no native controls,
  with picture-in-picture and full-screen disabled. Wrap it in a non-interactive
  view so taps reach the controls above it: an un-wrapped video steals touches
  and opens the system player.
  Falls back to the exercise thumbnail, then to the session photo. One player
  instance for the whole session; swap its source when the exercise changes.
  Choose the fit by comparing the clip's orientation with the screen's: fill
  when they agree, letterbox when they do not.
- **Scrim** over the video, then the controls in a centred column (max 560 pt):
  - Top left: a back chevron, *"Leave session"*. Top right: a rotate button,
    *"Turn the player sideways"* / *"Follow the phone again"*, filled in the
    accent colour while forced.
  - Overline in the accent colour: **"Set {n} of {total}"**, or **"Rest"**.
  - The exercise name, 28 pt, one line.
  - **The timer row** — the centre of the screen:
    - left, a restart button, *"Restart this set"*;
    - the big figure (56 pt, or 72 pt upright) showing the countdown or the rep
      count, with the unit **"min"**, **"secs"** or **"reps"** under it;
    - right, pause/play on a timed step, or an accent **tick disc** on a rep
      step, *"Set done"*.
  - **"Next up"** card: a badge showing the next step's seconds or set number
    (**"secs"** / **"of {n}"**, or a tick / **"end"** at the finish), the
    caption **"Next up"** over **"Rest"**, the next exercise name, or
    **"Finish"**; and a skip button, *"Skip ahead"*.
  - **Progress strip**: one 3 pt segment per exercise, each filling as its sets
    are done.

## Orientation

Landscape is **opt-in**, not automatic: the rotate button locks landscape, and
pressing it again releases back to following the phone. Always restore portrait
when leaving. The layout otherwise reacts to the window size.

This matters more than it sounds: a member resting between sets puts the phone
down, and a player that spins on its own is maddening.

## Timers

One 1-second tick while a step is running and time remains. Reaching zero
completes a timed set or ends a rest and advances. Restart re-arms the step;
pause/resume toggles; skip just advances.

## What a finished set records

- Timed set → its duration.
- Rep set → the prescribed reps (the member's entry if you add one, else the
  set's reps, else the top of the range), plus the set's weight if present.

FORMA's hook accepts member-entered reps and weight but the player never asks
for them — worth adding in your build, since logged load is the one thing a
training history really wants.

## States

- **Loading** — a centred spinner on black.
- **Nothing scheduled** — **"Nothing scheduled"** and a **"Back"** button.
- **Errors** — a danger-tinted pill across the top, tap to dismiss: **"Could not
  start the session"**, **"Could not save that set"**, **"Could not finish the
  session"**.
- **Finished** — fades in: accent overline **"Workout complete"**, the hero line
  **"{done} of {total} sets"**, **"Logged to today. Nice work."**, and a
  **"Done"** button that returns to the day.

## Data

- `home({ date, … })` and `sessionProgress({ date })`
- `startSession({ date, today })` — fired once, only when the date is today
- `logSet({ logId, workoutExerciseId, setIndex, … })` — as each set finishes
- `completeSession({ logId })`

Key the player on the day's id, so a re-pointed date (after a move or swap)
restarts it cleanly rather than carrying stale steps.
