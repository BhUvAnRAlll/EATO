# The admin side

## What FORMA actually has

**One real feature: the exercise library.** It is a staff screen (manager-only
in FORMA; make it your single staff role) with three parts:

1. **List** — header **"Exercise library"** with **"{n} of {m} have a demo
   video"**, a search box, nine muscle-group chips (All, Legs, Chest, Back,
   Shoulders, Arms, Core, Cardio, Full body), and a row per exercise with inline
   video upload. Empty: **"Nothing matches"** / *"No exercise matches
   "{search}"."* or *"No exercises in this group yet."*
2. **Detail** — media first: upload or replace the demo video and thumbnail,
   then a metadata card (muscle group, equipment, movement pattern, difficulty,
   flags), and an archive/restore toggle. When the pattern or difficulty is
   missing it warns: **"Without a movement pattern and difficulty the plan
   engine cannot place this exercise, so it is never programmed."**
   Missing row: **"Exercise not found"** / *"It may have been removed."*
3. **Create** — name, equipment (defaulting to *Bodyweight*), muscle group,
   movement pattern grouped as *Legs / Push / Pull / Other*, difficulty, and the
   three flags. Error fallback: **"Could not save that exercise."**

Archiving keeps the row so existing plans still resolve; only future generation
changes. That is the right default — deleting an exercise that is already
written into plans breaks history.

**Two gaps to know about before you plan work:**

- **There is no edit screen.** The update operation exists and is never called:
  staff can create, archive and attach media, but cannot fix a typo. Build the
  edit screen; it is an hour's work against an operation that already exists.
- **Plan assignment does not exist.** Nothing anywhere creates a trainer-written
  plan. The member UI is fully prepared for one — "Trainer plan" chips, the
  read-only preferences notice, "Your trainer manages this plan" refusals — but
  there is no builder and no assign operation. If you want coaches writing
  plans, that is a new feature, not a port.

**Staff visibility into member workouts is almost nil:** a completed/started
flag next to a member on the attendance list, and an aggregate "did this member
use the app" count in reports. No staff screen shows anyone's sessions, sets or
history.

## What this means for your app

You have one staff role. In priority order:

### 1. The exercise library (do this first)
Without it there is nothing to generate plans from. Seed it in code — FORMA
ships **77 exercises** as a code constant and syncs them into the table on
demand, which means a fresh environment is never empty and the engine always has
something to pick. Then let staff add their own and upload demo media.

The engine fields are not optional metadata. An exercise without a movement
pattern and a difficulty is invisible to the generator, so make them required
at creation and warn loudly anywhere one is missing.

### 2. The edit screen FORMA never built
Create, edit, archive, restore, upload media. Straightforward, and it closes the
most obvious gap.

### 3. Coverage reporting
The generator silently skips a slot when no exercise fits — a library thin in
pulling movements quietly produces worse plans, and nobody finds out. A small
staff screen showing exercises per pattern and per difficulty, with the empty
combinations called out, is worth more than it costs.

### 4. Per-member oversight — think before you build it
A coach reading a client's training log is a real feature and a privacy
decision. Gate it on the member's consent rather than the staff role alone,
scope it to that coach's own clients, keep it read-only, and log who looked.
The member-facing reads already return what a coach would need; they only need
a path that takes a member id **after** those checks.

### What not to do
Do not let staff edit a member's generated plan row by row without a real
builder behind it. The plan is a snapshot of an engine run, stamped with the
inputs and version that produced it; hand-editing it breaks that provenance and
leaves nobody able to explain where a session came from.
