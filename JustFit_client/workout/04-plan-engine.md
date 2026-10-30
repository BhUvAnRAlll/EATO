# The plan engine

Pure, deterministic arithmetic: no database, no clock, no randomness, **no AI**.
The same answers and the same library always produce the same plan, and every
tie is broken by exercise name. Build this first and unit-test it — it decides
what every screen shows.

Version the engine (FORMA is at 2) and stamp every plan with the version, the
input hash, a snapshot of the inputs and the calibration. That is how you later
tell which plans came from which rules.

## Inputs

Thirteen answers: `gender`, `ageYears`, `weightKg`, `heightCm`, `bodyType`,
`goal`, `weekdays[]`, `pace`, `fitnessBase`, `squatScore`, `pushScore`,
`pullScore`, `seriousInjury`, plus an optional `split`.

Validation, each with its own message: age 13–100, weight 25–300 kg, height
100–250 cm, 1–7 unique weekdays, the four scores 1–4, enums from their lists.

When generating silently from a thin profile, default cautiously: gender
`other`, age 30, weight 70 kg, height 170 cm, body type `average`, goal
`get_fitter`, pace `standard`, 3 days, `fitnessBase` from experience (advanced
4, intermediate 3, beginner 1, unknown 2), missing capability scores from the
base (base 1 → 2, base 4 → 4, otherwise 3), no injury, split automatic.

## Calibration

```
score = (fitnessBase + squat + push + pull) / 4
level = fitnessBase === 1 || score < 2.5 ? beginner
      : score < 3.5                      ? intermediate
      :                                    advanced

per-group tier:  tier(s) = s <= 2 ? 1 : s === 3 ? 2 : 3
group ceiling:   clamp(L + sign(tier − L), 1..3)   // at most one step either way
age band:        <18 under18 | >=60 senior | >=45 mid | else adult
global cap:      safetyMode ? 1 : (under18 || senior) ? 2 : 3
safetyMode       = seriousInjury, and it forces level to beginner
```

Groups are `lower | push | pull | other`, each of the 18 movement patterns
mapping to one. A member who squats well but cannot do a pull-up gets harder leg
work and easier pulling — one number per group, not one for the whole body.

## Split and session types

Days are clamped 1–7. With an explicit split: all full-body; or upper/lower
alternating; or push/pull/legs cycling. Automatic:

| Days | Sessions |
|---|---|
| ≤3 | full body each time |
| 4 | upper, lower, upper, lower |
| 5 | upper, lower, push, pull, legs |
| 6 | push, pull, legs, push, pull, legs |
| 7 | push, pull, legs, push, pull, legs, full body |

Automatic weekday spreads when the member does not choose: 1 → Wed; 2 → Tue,
Thu; 3 → Mon, Wed, Fri; 4 → Mon, Tue, Thu, Fri; 5 → Mon–Fri; 6+ → Mon–Sat.

## Templates

Each session type is a list of slots, each slot being one or more acceptable
patterns plus a role:

- **full body** — squat/lunge (main), horizontal push (main), horizontal or
  vertical pull (main), hinge (secondary), then a rotating isolation
  (shoulder abduction / elbow flexion / elbow extension) and core.
- **upper** — horizontal push, horizontal pull (main); vertical push, vertical
  pull (secondary); elbow flexion, elbow extension (isolation).
- **lower / legs** — squat, hinge (main); lunge (secondary); knee flexion,
  calf, core (isolation).
- **push** — horizontal push (main); vertical push, horizontal push
  (secondary); shoulder abduction, elbow extension (isolation).
- **pull** — vertical pull, horizontal pull (main); horizontal pull
  (secondary); rear delt, elbow flexion (isolation).

Then by level: **beginners drop the last isolation slot**; **advanced gain an
extra secondary slot** repeating the first slot's patterns; intermediates take
the template as it is.

## Sets, reps, rest

Sets = `ceil(min + (max − min) × paceFactor)`, with pace factors slow 0,
standard 0.25, brisk 0.5:

| Level | Main | Secondary | Isolation |
|---|---|---|---|
| beginner | 2–3 | 2 | 2 |
| intermediate | 3–4 | 3 | 2–3 |
| advanced | 3–5 | 3–4 | 3–4 |

Reps by goal — build muscle: main 6–12, secondary 8–12, isolation 10–15;
lose weight and stay fit: main 8–12, secondary 8–12, isolation 10–15. Each
generated set carries the **top** of the range, with the range stored for
display. Timed exercises get `durationSec = timedSec × hold factor`, where the
factors are beginner 1, intermediate 1.5, advanced 2.

Rest in seconds: main 90 / 120 / 150 by level; secondary 90; isolation 60;
conditioning 0. Add 15 s to main for the 45–59 band, and 30 s to main and
secondary for 60+.

**No weights are ever prescribed.** See `02-data-model.md` for why.

## Conditioning

- Lose weight → a finisher in **every** session: 600 s slow, 720 s standard,
  900 s brisk.
- Stay fit → the first session, plus the middle one when there are two or more;
  600 s.
- Build muscle → none.

## Choosing each exercise

Each exercise may appear at most **twice a week**. A candidate is rejected when
its difficulty is above the group ceiling, when it is high-risk and the member
is in safety mode or outside the 18–59 bands, when it is not low-impact and the
body type calls for low impact, or when it is already used twice.

Score the survivors: +3 if the difficulty exactly equals the ceiling, +3 if the
pattern is the slot's first choice, +1 machine for beginners, +1 non-machine for
advanced, +1 machine for seniors, +2 for a matching region, −4 per use already
this week. Ties break on name.

Three passes, in order: the exact patterns; the same patterns one difficulty
step up, noting *"No exercise at your level for this movement; used the next
step up."*; then the whole pattern family, noting *"Swapped to a related
movement in the same family."* A slot with no candidate is skipped rather than
filled with something wrong.

## Assembling a day

1. One **warm-up** matched to the first main pattern's region, 60 s by default,
   no rest.
2. Each slot in order. Rotating slots advance by how many times that session
   type has already appeared this week. **Recovery rule:** if a main squat or
   hinge lands on the calendar day straight after a heavy-lower day, it is
   rewritten to a lunge at secondary.
3. The conditioning finisher, when this session index calls for one.
4. Exactly **two stretches**, 40 s each, no rest.

## Time and energy

`setSeconds = durationSec ?? reps × 3`;
`exerciseSeconds = Σ setSeconds + restSec × (sets − 1) + 45` setup;
minutes = rounded.

Calories: `MET × weightKg × minutes / 60`, with METs full body 6, legs/lower 5,
upper 4, push/pull 3.5, default 3.5 (2011 Compendium of Physical Activities).
Return **null** when the profile has no weight rather than guessing — the day
screen then hides the row.

## The input hash

Canonical JSON of the normalised inputs plus the engine version, keys sorted,
hashed with djb2, rendered as 8 hex characters. Cheap, stable, and enough to
answer "are these the same answers as last time?"
