# The prompt

Copy the whole `workout/` folder into the other app's repo (anywhere — say
`docs/workout/`), then paste everything below the line into that project.

---

Build a workout feature in this app, following the spec in `docs/workout/`.

Read it in this order before writing any code: `README.md`, `01-workflow.md`,
then `02-data-model.md`, `03-actions.md` and `04-plan-engine.md`, then each file
in `screens/`. The spec is lifted from a working app, so its copy strings,
numbers, formulas and states are the requirement, not suggestions.

## Make it look like this app, not like the spec's app

Do this first, before any screen work.

1. Find this app's design tokens — a theme file, a tailwind config, a constants
   file, or whatever this codebase uses. If there is no token file, read three
   or four existing screens, write down the colours, text sizes and spacing they
   actually use, and put them in one place.
2. The spec names colours by **role**, never by value: `background`, `surface`,
   `surfaceAlt`, `ink`, `inkInverse`, `muted`, `faint`, `line`, `accent`,
   `accentSoft`, `success`/`successSoft`, `warning`/`warningSoft`,
   `danger`/`dangerSoft`. Map each one to this app's existing palette and show
   me that mapping before you build.
3. Never introduce a new colour. If a role has no match here, use the nearest
   existing one and tell me, rather than inventing a hex.
4. One part of this feature is deliberately **dark and focused**: the screen a
   member uses mid-set, phone propped against a rack. The spec describes it as
   an inverted surface. If this app has a dark surface token, use it; if not,
   ask me before introducing one.
5. Type is described by role — `display`, `title`, `headline`, `subhead`,
   `body`, `callout`, `caption`, `overline`. Map them to this app's existing
   text styles. Do not add new font sizes.
6. Reuse this app's existing components — buttons, cards, inputs, sheets, empty
   states, loading states, icons, progress indicators. Build something new only
   when nothing here fits, and build it in this app's style.

Someone who knows this app should not be able to tell which screens came from
the spec.

## Scope

The member workout screens listed in `README.md`, plus the plan engine that
feeds them.

Out of scope unless I say otherwise: any manager role (this app has one staff
role), and anything the spec marks as not existing in the original app. Do not
invent a feature to fill a gap — tell me about the gap instead.

## Order of work

Build vertically, one slice at a time, and check each with me before moving on:

1. The data model and the plan engine from `02-data-model.md` and
   `04-plan-engine.md`. **Unit-test the engine first** — it is pure logic, it
   decides what every screen shows, and it is the one part where a quiet mistake
   is invisible for weeks.
2. The workout hub and the day view, read-only against a generated plan.
3. The session player end to end: start, log a set, rest, finish.
4. Preferences, and regenerating a plan.
5. Whatever remains in `screens/`.

## Rules that must survive the port

- **The plan is generated, not guessed.** Follow the formulas and constants in
  `04-plan-engine.md` exactly, including the version stamp. If you think one is
  wrong, tell me — do not quietly improve it.
- **A session records what actually happened**, not what was prescribed. Logged
  sets are their own records; the plan is the intention.
- **The member is resolved from the session on the server.** No screen sends a
  user id, and no operation accepts one.
- **Ownership is checked on every write**, and a row belonging to someone else
  fails with the same message as a missing row.
- **Never invent a number.** If something has no data behind it, wire it to a
  real source or leave it out.
- Keep the spec's validation limits and error strings word for word.

## Done means

For each screen: loading, empty, error and success states implemented with the
spec's copy; navigation in and out as described; validation messages word for
word; and it reads as this app's design.

Before you call a slice finished: run this project's type check, linter and
tests, and tell me the result. If you could not verify something, say which part
and why — do not describe it as working.

## If something does not fit

This app's conventions win over the spec's. If a screen fights this app's
navigation model, state management or component set, stop and tell me the
conflict and your suggested change, rather than importing the other app's
patterns wholesale.
