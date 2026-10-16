# Workflow

## The shape of the feature

One tab, a hub, and four things reachable from it. Two of them are full-screen
modals, because they interrupt rather than drill down.

```
Workout tab
└── Hub  (/workout)                  today, the week, and history
    ├── Day  (/workout/day)          one session in full          [push]
    │    └── Session player          run it set by set            [push, fade]
    ├── Preferences                  four settings                [full-screen modal]
    │    └── Rebuild my plan         basics → goals → performance [nested modal]
    │                                → review → analysing → reveal
    └── (the player can also be entered from the day's exercise list)
```

No screen has a native header; each draws its own. The player fades in rather
than sliding, because a slide under a video looks like a glitch.

## What a plan is

```
Plan ─┬─ day (pinned to a weekday)  ─┬─ exercise (section, order)  ── sets[]
      ├─ day                         ├─ exercise
      └─ day …                       └─ exercise …
```

- A **plan** has a goal, a level, days per week and a split. One plan is
  `ACTIVE` at a time; older ones become `SUPERSEDED` and are kept.
- A **day** is pinned to a weekday, not to a date. "Monday's session" recurs.
- Each day holds exercises in three sections, always in this order: **warm up**,
  **workout**, **stretch** (stored as `cooldown`).
- Each exercise holds its prescribed **sets**, its rest in seconds, and a rep
  range for display.

## What a date resolves to

This is the heart of the feature. Given a date, the day it runs is decided in
this precedence:

1. A **log** for that date — a completed log wins over one in progress.
2. A **per-date override** — what "move" and "swap" write.
3. The plan's day **pinned to that weekday**.
4. Nothing: a rest day.

A date's **status** then follows: `completed` → `in_progress` → `missed` (it was
scheduled and the date is past) → `none`.

Because an override is just a row pointing a date at a day, moving a missed
session to today costs nothing and loses nothing.

## Rescheduling

From the hub's week strip and history rows:

- A **past, missed** day offers **"Do it today instead?"** → writes an override
  pointing today at that day.
- A **future, scheduled** day offers **"Swap with today?"** → writes two
  overrides, crossing the days.
- Today, or anything else, just opens the day.

Both are refused server-side in the obvious ways: a finished session cannot be
moved or swapped, a session already under way cannot be swapped, and you cannot
move a second session onto a day whose session is already done.

## Running a session

```
Day screen ──→ Start / Continue ──→ Session player
                                      │
      step list = every set of every exercise, in order,
      with a rest step after each set except the very last
                                      │
      each completed set is written immediately
                                      ▼
                            Finish ──→ log marked completed
```

- Starting creates a log **only for today**. Past and future days are read-only.
- Each set is logged as it finishes, so a dropped connection or a killed app
  loses at most the set in progress.
- Ending early marks the log abandoned, and the date goes back to *planned* —
  the member can start again or move another session there. Sets already logged
  are kept.

## Building and rebuilding a plan

Two paths, both ending in a generated plan:

- **Preferences** — change any of goal, level, training days or split, submit,
  and a new plan supersedes the old one. Four taps.
- **Rebuild my plan** — the six-step flow, for when the body or the ambition has
  changed: basics (gender, age, weight, height, body type) → goals (goal, days,
  weekdays, pace, fitness statement) → performance (squats, push-ups, pull-ups,
  injury) → review → analysing → reveal.

The first time a member opens the tab with no plan, one is generated silently
from whatever the profile already holds, using cautious defaults.

**The generator is deterministic arithmetic — there is no AI anywhere in this
feature.** The same answers and the same exercise library always produce the
same plan, and every tie is broken by exercise name. The "analysing" screen
paces real stages of a real mutation; it is honest theatre, not a model call.
If you are porting this, you need no AI budget, no API key and no fallback for
when a model is down.

## What is kept when a plan is replaced

Everything. The old plan's days, the overrides, the logs and the set logs all
stay; only the plan's status changes. History never breaks, and the member is
told so before they commit: *"Your current plan will remain unchanged until the
new plan is successfully created. Your workout history stays with it."*
