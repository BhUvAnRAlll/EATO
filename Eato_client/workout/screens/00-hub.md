# Workout hub — `/workout`

The tab's landing screen: today's session, the training week, and recent
history.

## Layout, top to bottom

1. **Header.** Title **"Workout"** with **"Stay consistent, get stronger"**
   under it; right, a gear button (*"Workout preferences"*) → Preferences. The
   gear does nothing until a plan exists.
2. **Today's hero** — a 280 pt photo card for the session type, with a scrim top
   and bottom:
   - Top left: an accent chip **"Today"** with a dumbbell, plus a glass chip
     **"Trainer plan"** when the plan came from a trainer.
   - Top right: a glass chip **"{minutes} min"**.
   - Bottom right: an accent pill with a play glyph reading **"Start"**,
     **"Continue"** (a session is under way) or **"Review"** (today is done).
   - Deliberately **no title text on the card** — the photo and the chips carry
     it. Tapping anywhere opens the day.
   - Its subtitle line, where shown, is `{n} exercises · {level}`.
3. **Rest day card** instead, when nothing is scheduled: overline **"Rest
   day"**, title **"Recharge to come back stronger"**, body **"Nothing scheduled
   today. Recovery is part of the plan."**, a success-tinted pill reading
   **"Rest · Recover · Be ready"**, and an illustration.
4. **"This week"** — heading with **"{done} of {scheduled} done"** on the right,
   then seven tiles (slightly taller than wide). Today's tile is filled in the
   deep success colour. Under each number a 5 pt status dot: danger for missed,
   success for completed, warning for in progress, line for upcoming — and
   **no dot at all on a rest day**. Tapping a tile that is not today fires a
   selection haptic.
5. **"History"** — the last 7 days, collapsed to 3 rows with a
   **"See all"** / **"Show less"** toggle when there are more. Each row: a 50 pt
   session thumbnail (a moon glyph for a rest day), the title (or **"Rest
   day"**), a caption **"{weekday, day month} · {minutes} min · {n}
   exercises"**, a status pill, and a chevron. Pills: **Completed**, **In
   progress**, **Missed**, **Planned**, **Rest day**.

## States

- **Loading** — spinner with **"Loading"**, or **"Building your plan"** when
  there is no plan yet and one is being generated.
- **Plan setup failed** — dashed block, warning triangle, title **"Could not set
  up your plan"**, body *"{error}. Tap to try again."*, tapping retries.
- **Empty history** — dashed block, title **"No sessions yet"**, body **"Finish
  a workout and it will show up here."**
- **Reschedule error** — the server's message, else **"That did not work. Try
  again."** The sheet stays open while the request is in flight and cannot be
  dismissed mid-request.

## Data

- `home({ date: today, dates: thisWeek, today })`
- `ensurePlan({ today })` — fired automatically whenever the plan is null
- `history({ from: today − 6 days, to: today })`
- `moveSessionToToday({ from, today })`, `swapDays({ a: today, b, today })`

## Tapping a day

| The day you tapped | What happens |
|---|---|
| Today | Open the day |
| Past, missed | Ask **"Do it today instead?"** |
| Future, scheduled, and today has a session | Ask **"Swap with today?"** |
| Anything else | Open the day |

Both prompts are bottom sheets:

- **Move** — 💪 **"Do it today instead?"** / *"You missed {day}. Move that
  session to today and pick up where you left off."* / **"Move to today"** /
  **"Not now"**.
- **Swap** — 🔁 **"Swap with today?"** / *"Today's session and {day} will trade
  places."* / **"Swap days"** / **"Not now"**.

## Navigation

- Opens the day with a `date` param; opens Preferences.
- No back button: this is the tab root.
