# Data model

Seven stores. Field names are FORMA's; keep the shapes.

## `exercises` — the library the engine draws from
| Field | Type | Notes |
|---|---|---|
| `name` | string | **the stable key**; plans resolve against it, so it must be unique |
| `muscleGroup` | enum | legs, chest, back, shoulders, arms, core, full_body, cardio |
| `equipment` | string? | free text |
| `thumbnailId`, `videoId` | file ref? | demo media, uploaded by staff |
| `instructions` | string[]? | numbered how-to lines |
| `pattern` | enum? | one of 18 movement patterns — **the engine needs this** |
| `difficulty` | 1\|2\|3? | complexity/stability/skill/loading, *not* effort — **needed** |
| `highRisk` | bool? | heavy axial loading, plyometrics |
| `lowImpact` | bool? | |
| `machine` | bool? | machines and cables |
| `region` | `lower\|upper\|any`? | used to match warm-ups and stretches |
| `timedSec` | number? | for holds and conditioning |
| `createdBy` | user ref? | set only on staff-authored rows |
| `archivedAt` | number? | hidden from future generation, never deleted |

Index by `muscleGroup`. A row without `pattern` and `difficulty` can never be
programmed — say so in the admin UI rather than letting it sit there silently.

## `workoutPlans`
`userId`, `name`, `goal`, `level`, `daysPerWeek`, `split?`, `source`
(`member | trainer | ai`), `createdBy?`, `status` (`ACTIVE | ARCHIVED |
SUPERSEDED`), `engineVersion?`, `inputHash?`, `inputsSnapshot?`, `calibration?`,
`requiresProfessionalReview?`, `startDate?`, timestamps.
Index by `(userId, status)`.

Keep `engineVersion`, `inputHash`, `inputsSnapshot` and `calibration`. They are
what let you answer "why did it give me this?" months later, and what tells you
which plans predate an engine change.

## `workoutDays`
`planId`, `userId`, `weekday` (0 = Sunday), `title`, `sessionType?`, `createdAt`.
Index by `(planId, weekday)`.

## `workoutExercises`
`dayId`, `planId`, `userId`, `exerciseId`, `section` (`warmup | workout |
cooldown`), `order`, `sets: [{ reps?, durationSec?, weightKg? }]`, `restSec`,
`role?`, `repsMin?`, `repsMax?`, `note?`, `createdAt`.
Index by `(dayId, section, order)`.

`note` carries the engine's own explanation when it had to substitute —
e.g. *"Swapped to a related movement in the same family."* Show it; it is the
difference between a plan that feels thought-through and one that feels random.

## `workoutDayOverrides`
`userId`, `date` (`YYYY-MM-DD`), `dayId`, `createdAt`. Index by `(userId, date)`.
One row = "on this date, run that day". This is all that move and swap write.

## `workoutLogs`
`userId`, `planId?`, `dayId?`, `date`, `startedAt`, `completedAt?`, `status`
(`IN_PROGRESS | COMPLETED | ABANDONED`). Index by `(userId, date)`.

## `workoutSetLogs`
`logId`, `userId`, `workoutExerciseId`, `setIndex`, `reps?`, `weightKg?`,
`durationSec?`, `completedAt`.
Indexes: by `logId`, and by `(logId, workoutExerciseId, setIndex)` — the second
one makes logging a set an upsert, so re-doing a set replaces rather than
duplicates.

## Profile fields the engine reads
On the member's profile row: `gender`, `dateOfBirth`, `goal`, `experience`,
`heightCm`, `weightKg`, `bodyType`, `pace`, `fitnessBase`, `squatScore`,
`pushScore`, `pullScore`, `seriousInjury`, `trainingWeekdays[]`, `daysPerWeek`.

## Two absences worth copying on purpose

- **No personal-records table.** Nothing in FORMA detects or stores PRs, despite
  its own docs listing them. Do not half-build it: either design PR detection
  properly or leave it out and say so.
- **No prescribed weights.** The engine never sets `weightKg` on a generated
  set. The field exists and is echoed back when a member logs a load, but the
  plan does not tell anyone what to lift. That is a deliberate safety position —
  prescribing load from four self-reported answers is how people get hurt.
