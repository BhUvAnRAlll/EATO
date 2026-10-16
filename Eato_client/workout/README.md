# Workout — build spec

A complete description of FORMA's workout feature, written so another app can
rebuild the same screens in its own visual style. Everything here is taken from
the shipped code, not from a design intent: copy strings, numbers, formulas,
rules and states are what the app actually does.

## How to use this folder

1. Read `01-workflow.md` first — it is the map of how the screens connect and
   what a training week looks like.
2. Read `04-plan-engine.md` before building any screen. The plan engine decides
   what every screen displays; the screens are mostly a view onto its output.
3. Build screen by screen from `screens/`. Each file is self-contained: layout
   top to bottom, every state, the data it needs, the actions it fires, and
   where it navigates.
4. `02-data-model.md` and `03-actions.md` describe the storage and the server
   operations, written backend-agnostically: the shapes and rules matter, the
   database does not.
5. `05-admin.md` covers the staff side.

## Screens

| Screen | File | Route |
|---|---|---|
| Workout hub | `screens/00-hub.md` | `/workout` |
| Training day | `screens/01-day.md` | `/workout/day` |
| Session player | `screens/02-session.md` | `/workout/session` |
| Preferences | `screens/03-preferences.md` | `/workout/preferences` |
| Rebuild my plan (6 steps) | `screens/04-recreate.md` | `/workout/recreate/…` |

## Making it look like your app

Nothing in this folder names a colour. Screens are described with **roles**, and
you map each role once to your own palette:

| Role | Used for |
|---|---|
| `background` | Screen behind the cards |
| `surface` | Cards, rows, sheets |
| `surfaceAlt` | Inputs, chips, icon tiles |
| `ink` | Primary text, filled buttons, selected chips |
| `inkInverse` | Text on `ink` |
| `muted` | Secondary text |
| `faint` | Placeholder text, disabled |
| `line` | Hairlines, dividers, empty track |
| `accent` | The brand colour: rings, progress, "today" |
| `accentSoft` | Accent background tint |
| `success` / `successSoft` | Done, completed sets |
| `warning` / `warningSoft` | Behind, skipped |
| `danger` / `dangerSoft` | Errors, destructive actions |

One thing to decide early: this feature has a **dark, focused surface** for the
screen a member looks at mid-set, with the phone propped against a rack. That
is a deliberate break from the everyday light UI — large numbers, high contrast,
few controls, readable at arm's length. If your app has no dark surface token,
agree one before building that screen rather than lightening it.

Type is described by role — `display`, `title`, `headline`, `subhead`, `body`,
`callout`, `caption`, `overline` — in decreasing size, headings heavy, body
regular. Use your own scale; the specs only say which role a piece of text
takes.

## Conventions used in every screen file

- **Dates** are the member's local day as `YYYY-MM-DD`.
- **Weekdays** are Sunday-first (0 = Sunday), matching `Date.getDay()`.
- A **plan** holds training **days**; a day holds **exercises**; an exercise
  holds prescribed **sets**.
- A **log** is one attempt at a day. It is a separate record from the plan:
  the plan is the intention, the log is what happened.
- Every data-driven screen has four states: loading, empty, error and content.
  The screen files give the exact copy for each.
