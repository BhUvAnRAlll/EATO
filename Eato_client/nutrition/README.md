# Nutrition — build spec

A complete description of FORMA's nutrition feature, written so another app can
rebuild the same screens in its own visual style. Everything here is taken from
the shipped code, not from a design intent: copy strings, numbers, rules and
states are what the app actually does.

## How to use this folder

1. Read `01-workflow.md` first — it is the map of how the screens connect.
2. Build screen by screen from `screens/`. Each file is self-contained: layout
   top to bottom, every state, the data it needs, the actions it fires, and
   where it navigates.
3. `02-data-model.md` and `03-actions.md` describe the storage and the server
   operations. They are written backend-agnostically: the shapes and rules
   matter, the database does not.
4. `04-admin.md` covers the staff side. Read it before planning admin work —
   most of what you might expect does not exist in FORMA.

## What is in scope

Ten member screens:

| Screen | File | Route |
|---|---|---|
| Nutrition hub | `screens/00-hub.md` | `/nutrition` |
| Daily calories | `screens/01-daily.md` | `/nutrition/daily` |
| Calories & macros | `screens/02-calories-macros.md` | `/nutrition/calories-macros` |
| Adjust targets | `screens/03-adjust-targets.md` | `/nutrition/adjust-targets` |
| Water | `screens/04-water.md` | `/nutrition/water` |
| Add meal | `screens/05-add-meal.md` | `/nutrition/add-meal` |
| Log food | `screens/06-log.md` | `/nutrition/log` |
| Manual entry | `screens/07-manual.md` | `/nutrition/manual` |
| Favourites | `screens/08-favorites.md` | `/nutrition/favorites` |
| Repeat a meal | `screens/09-repeat-meal.md` | `/nutrition/repeat-meal` |

## What is deliberately left out

- **AI photo scanning.** FORMA's scan and scan-review screens are excluded, as
  the target app has no AI scanning. Where the Log food screen offered a scan
  card, this spec drops it. Nothing else depends on it.
- **Recipes.** The recipe library and the recipe-log screen are excluded.
- **Manager role.** FORMA has admin, manager, trainer and member roles; the
  target app has no manager. `04-admin.md` is written for a single staff role.

If you later want any of these, they slot in without changing the other screens:
each is an extra entry on the Log food screen plus its own save path.

## Making it look like your app

Nothing in this folder names a colour. Screens are described with **roles**, and
you map each role once to your own palette:

| Role | Used for | FORMA's value (reference only) |
|---|---|---|
| `background` | Screen behind the cards | light grey |
| `surface` | Cards, rows, sheets | white |
| `surfaceAlt` | Inputs, chips, icon tiles | lighter grey |
| `ink` | Primary text, filled buttons, selected chips | near-black |
| `inkInverse` | Text on `ink` | white |
| `muted` | Secondary text | mid grey |
| `faint` | Placeholder text, disabled | light grey |
| `line` | Hairlines, dividers, empty track | very light grey |
| `accent` | The brand colour: rings, the active bar, "today" | lime |
| `accentSoft` | Accent background tint | pale lime |
| `success` / `successSoft` | On-track badges | green |
| `warning` / `warningSoft` | Behind-target badges | amber |
| `danger` / `dangerSoft` | Errors, destructive actions | red |
| `protein` / `carbs` / `fat` | The three macros, everywhere | red / amber / blue |

Two rules worth keeping whatever your palette is:

- **The three macro colours are fixed data colours.** Protein, carbs and fat
  keep the same colour in every ring, bar, dot and legend, in both themes.
- **One accent.** Rings and the selected state use the accent; everything else
  is ink and greys. Semantic colours appear only to carry meaning.

Type is described by role too — `display`, `title`, `headline`, `subhead`,
`body`, `callout`, `caption`, `overline` — in decreasing size, with headings
heavy and body text regular. Use your own scale; the specs only say which role
a piece of text takes.

## Conventions used in every screen file

- **Dates** are the member's local day as `YYYY-MM-DD`. Never a timestamp.
- **Slots** are `breakfast | lunch | dinner | snack`.
- **Totals** are always `{ kcal, proteinG, carbsG, fatG }`.
- **Today only.** Meals and water can only be logged for the current day; past
  days are read-only. This is enforced on the server, not just hidden in the UI.
- Every list screen has four states: loading, empty, error, and content. The
  screen files give the exact copy for each.
