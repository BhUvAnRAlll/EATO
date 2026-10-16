# Workflow

## The shape of the feature

Nutrition is one tab with a hub and nine drill-downs. The hub is the only screen
in the bottom tab bar; everything else is pushed on top of it and slides in from
the right. No screen uses a native header — each draws its own header row with a
back chevron on the left.

```
Nutrition tab
└── Hub  (/nutrition)                    the day at a glance
    ├── Daily calories                   one day in full
    │     └── Water
    ├── Calories & macros                averages and the weekly trend
    │     └── Adjust targets             override the calculated target
    ├── Water                            log and review hydration
    └── Add meal ─→ Log food ─┬─→ Manual entry
                              ├─→ Favourites
                              └─→ Repeat a meal
```

## One shared date

Every screen in the tab reads one **selected date** held by the tab, not by any
screen. A provider at the tab root exposes:

- `selectedDate` — the day being viewed, default today
- `today` — the member's real local day
- `week` — seven days, oldest first, ending on the week anchor
- `isToday` — `selectedDate === today`
- `selectDate(date)` — move inside the visible week
- `jumpToDate(date)` — move the selection *and* the visible week

Consequences worth copying:

- Changing the day on the hub changes it for Daily calories and Water too.
- Any screen can offer "Back to today" by calling `jumpToDate(today)`.
- Deep links carry a `date` param; the screen validates it as `YYYY-MM-DD` and
  not in the future, then calls `jumpToDate`.

## The logging flow

Logging is deliberately three steps: *when*, then *how*, then *what*.

```
Add meal              Log food                 The save screen
──────────            ────────                 ───────────────
pick slot      ─────→ pick a method     ─────→ Manual entry  ─┐
pick time             (manual /                Favourites     ├─→ saved
                       favourites /            Repeat a meal ─┘
                       repeat)                       │
                                                     ▼
                                          dismiss the whole stack
                                          back to the hub
```

- **Add meal** collects `slot` and a time, then pushes `{ slot, hour, minute }`.
- **Log food** adds nothing; it forwards those three params unchanged to
  whichever method the member picks.
- Each save screen writes one meal and then **dismisses the entire logging
  stack** back to the hub, so the member lands where they started rather than
  reversing through three screens.
- The slot picker reappears on Favourites and Repeat only when the slot was
  *not* already chosen upstream — i.e. when the screen was opened directly.

### Entry points into the flow

| From | Goes to | Params |
|---|---|---|
| Hub floating button (today) | Add meal | — |
| Hub empty-meals state (today) | Add meal | — |
| Daily calories footer button | Add meal | — |
| Daily calories, an unlogged timeline row (today) | Add meal | `slot` |

On a past day the floating button and footer button change to **"Back to
today"** instead, and the unlogged timeline rows are not pressable.

## The water flow

Water is separate from meals and simpler: one screen, no sub-flow.

```
Hub (drop button) ─┐
Daily water card  ─┼─→ Water ──→ quick add 250 / 500 ml
Workout screen    ─┘             custom amount sheet (10–3000 ml)
                                 remove an entry (today only)
                                 reminders on/off
```

The day's target is estimated from the member's body and activity, and is
**written once per day**: a day the member already saw keeps the target it
showed, even if their profile changes later. Only a recorded workout changes it.

## The targets flow

```
Calories & macros ──→ Adjust targets ──→ save a manual target
                                    └──→ reset to the calculated one
```

- The target is normally **calculated** from the profile (see `02-data-model.md`
  for the formula) and recalculated whenever the profile or workout plan
  changes.
- Saving a manual target sets a flag that **stops automatic recalculation** —
  the app never silently overwrites a number the member typed.
- Reset clears the flag and recalculates immediately.

## States every screen shares

- **Loading** — a centred spinner. The hub keeps its header and week strip
  visible while the body spins.
- **Switching day** — the previous day stays on screen at 55% opacity while the
  new one loads, so the screen never flashes empty.
- **No target yet** — a dashed empty block: *"Calorie target not set up yet"*,
  tapping it opens the profile. This is the one state that blocks a screen.
- **Nothing logged** — a dashed empty block, tappable only on today.
- **Errors** — inline red text on form screens; an alert for one-shot actions
  such as logging water or deleting a meal.
