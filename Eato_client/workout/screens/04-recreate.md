# Rebuild my plan — `/workout/recreate/*`

Six screens inside a nested full-screen modal: three question steps, a review, a
generating screen and a reveal. Reached from Preferences.

## The shared frame

Every step sits in one shell: a bar with a round back button, a **three-node
numbered stepper** (short names *Basic / Goals / Fitness*), and a round close
button; then a heading block with the overline **"Step {n} of 3"** (or **"Review
& create"**), the title, a subtitle, and optional aside and notice cards; then a
footer with an optional 120 pt secondary button beside the primary one.

All of it is inside a keyboard-avoiding scroll view, and field groups fade in
staggered by about 60 ms each.

Draft state lives in a provider around the whole flow, seeded once from the
member's saved answers, with per-step validation. Errors appear inline under a
field, with an alert role, and **only after a failed Continue** — never while
someone is still typing.

Every choice tap and every number nudge fires a selection haptic. On a form this
long it is the difference between tapping and poking.

## Step 1 — Basics

Title **"Recreate your plan"**, subtitle **"Update your fitness details and
we'll create a new workout plan based on your current goals."**, notice **"Your
current plan won't be changed until your new plan is successfully created."**

Fields: **Gender** (three cards), **Age** (number, 13–100, unit *years*),
**Weight** (number, 25–300, unit *kg*, step 0.5), **Height** (number, 100–250,
unit *cm*), **Body type** (three icon cards).

Body type carries a note — **"Only shapes the conditioning we pick. It never
changes how hard you train."** — and a **"Learn more"** link explaining that
sets, reps and intensity come from the goal and the performance answers, not
from body type. Keep this. It is the question members are most likely to read as
judgement, and the honest answer defuses it.

Errors: **"Pick your gender"**, **"Enter an age between 13 and 100"**, **"Enter
a weight between 25 and 300 kg"**, **"Enter a height between 100 and 250 cm"**,
**"Pick the closest body type"**.

When the plan is trainer-managed: **"Your trainer manages your current plan, so
it cannot be recreated here."** and Continue stays disabled.

## Step 2 — Goals & experience

Subtitle **"What you're training for, how often, and how fast you want to
move."**

Fields: **Fitness goal** (lose weight / gain muscle / stay fit); **Workout
days** (3–7, five cards); **Selected weekdays** (seven chips, Monday first, hint
**"{n} of {target} chosen"**); **Pace** (*"I'll take my time" / "Healthy" /
"Take it up a notch"*); **Current fitness level** (four statements — *Just
starting out, Getting back into it, Training regularly, In great shape* — each
with a note, scored 1–4).

Pace notes show expected weight change (*0.5–1 kg a month*, *1–2*, *2–3*) **only
when the goal is losing weight**, which is the only goal where that promise is
meaningful.

Lowering the day count truncates the chosen weekdays to fit.

Errors: **"Pick a goal"**, **"Pick how many days you train"**, **"Select at
least 3 days ({n} chosen)"** / **"Select {target} days ({n} chosen)"**, **"Pick
a pace"**, **"Pick the statement that fits you"**.

## Step 3 — Performance

Title **"Your current performance"**, subtitle **"These answers help FORMA
choose the right training intensity for you."**, aside **"Be real." / "This
helps us create a safer, better plan for you."**, footnote **"You can always
update this later in settings."**

Four radio groups: **Bodyweight squats** (0 / 1–5 / 6–15 / >15), **Push-ups**
(0 / 1–5 / 6–10 / >10), **Pull-ups** (same), and **Serious injury** (No / Yes,
asked as *"Anything a doctor or physio has told you to train around?"*).

Answering yes shows a warning panel: **"For your safety, your new plan will use
beginner-level exercises and exclude high-risk movements. Please review it with
a qualified healthcare professional or trainer before exercising."** That answer
drives safety mode in the engine — it is not decoration.

Errors: **"Pick a range"** ×3, **"Answer yes or no"**.

## Step 4 — Review

Three summary cards — **Profile**, **Goal & Schedule**, **Fitness** — each with
an **"Edit"** pencil that jumps back to its step. Unanswered values render as an
em dash. A closing note: accent overline **"New plan"**, then **"Your updated
information will be used to create your new workout plan."** and, quieter,
**"Your current plan will remain unchanged until the new plan is successfully
created. Your workout history stays with it."**

Primary button: **"Generate my plan"**.

## Step 5 — Analysing

Fades in, and **swipe-back is disabled** — nobody should gesture their way out
mid-generation. The only control is a close button.

A 140 pt ring with an animated sweep and a pulsing dumbbell in the middle; the
title **"Creating your plan"**; the subtitle **"Built from your answers by
FORMA's workout engine."**; then a six-stage checklist, each line with a dot
that fills with a tick as it completes and a status of **"Completed"** or **"In
progress"**:

1. *Analysing user inputs* — Understanding your goals and preferences
2. *Calibrating workout intensity* — Matching the right challenge for you
3. *Building workout split* — Structuring your training days
4. *Selecting exercises* — Choosing the best movements for your goal
5. *Balancing training volume* — Fine-tuning for the best results
6. *Finalising your plan* — Almost there…

Below: a progress bar with the percentage, a tip card (**"· Good things take a
moment"** / *"A better, stronger you is on the way."*), and three chips —
*Personalized*, *Balanced*, *Effective*.

The pacing runs at about 650 ms a stage and is raced against the real mutation:
the screen advances through stage five, waits for the server, then shows the
tick and moves on after a beat. **Fire the mutation exactly once**, guarded by a
ref — a double-generation here creates two plans.

On success it **replaces** itself with the reveal, so the generating screen is
not in the back stack.

On failure: the ring turns red, the title becomes **"Something went wrong"**,
the subtitle carries the error or **"We couldn't create your plan"**, and a
footer **"Back to review"** appears.

## Step 6 — Reveal

Reached by replace, with no back or close button — the way out is the footer.
Everything here is read from the database, not from the draft: this is what was
actually saved.

- **Hero** over the goal photo: overline **"Your new plan"**, title **"Your plan
  is ready"**, body **"Your workout plan has been built around your goal,
  fitness level and schedule."**, then three glass pills — goal, level, and
  **"{n} days / week"**.
- **"Built for you"** card with an **"Edit"** button and five rows — Goal,
  Fitness level, Training days, Pace, Workout split — each row also tapping
  through to Preferences.
- **Safety card** when the plan needs review: **"This plan uses beginner-level
  exercise selections and excludes high-risk movements. Please review your plan
  with a qualified healthcare professional or qualified trainer before
  exercising."**
- **"Your workout journey"** — three numbered steps: *Build your foundation*,
  *Progress & get stronger* ("Training load rises when your logged performance
  qualifies"), *Reach your goal*. Deliberately free of numbers the engine does
  not produce — no "+5 kg in 6 weeks" promises.
- **"This week"** — one row per session: a day badge (accent-filled when that
  date is today), the title, and **"{minutes} min · {n} exercises"**. Dates are
  the next occurrence of each weekday, today included.
- **"Your first workout"** — the first session's exercises with their
  prescriptions and rest.
- Footer: **"View my workout"** and a ghost **"View plan details"**.

Leaving dismisses the whole modal first, then pushes the day — so the member
lands on the hub's stack, not inside a modal they cannot escape.

## Data

- The provider reads the saved answers once.
- Step 5 calls `recreatePlan({ today, ...13 answers })`.
- Step 6 calls `planOverview()`.
