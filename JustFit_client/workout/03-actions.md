# Server operations

Names are FORMA's; the arguments and rules are what matter. Reads are reactive
in FORMA — a write updates every open screen — so no screen has a refresh
control. If your stack is request/response, add invalidation after each write.

**The member is resolved from the session on the server.** No screen sends a
user id.

Error messages are thrown as a typed error so the text survives production
redaction, and the screens show it verbatim. Keep that: *"Finish today's session
before moving another one here"* is a useful sentence; *"Something went wrong"*
is not.

## Reads

### `home({ date, dates[], today })`
The hub and the day screen both live on this one call. Returns the active plan
(id, name, goal, level, daysPerWeek, source, `requiresProfessionalReview`,
training weekdays), the resolved day for `date` with its full exercise list, and
`week[]` of `{ date, status }` for the strip. Cap `dates` (FORMA: 14).
Returns `null` when the account is not provisioned, and `{ plan: null }` when
there is no plan yet.

### `history({ from, to })`
One row per date that was scheduled or trained, newest first:
`{ date, status, title, sessionType, totalMinutes, exerciseCount }`.

### `sessionProgress({ date })`
The completed log for that date if there is one, else the in-progress log, plus
its set logs (cap: 500).

### `planOverview()`
What the reveal screen shows: goal, level, days per week, pace, split label,
`requiresProfessionalReview`, every session with its title, minutes and exercise
count, and the first session's exercises. Exercise counts here count the
**workout** section only — warm-ups and stretches are not "exercises" to a
member reading a summary.

### `preferences()`
`{ goal, level, weekdays, split, editable }` — `editable` is false when the plan
came from a trainer.

### `recreateInputs()`
The thirteen saved answers (null where never asked), unit preferences,
`hasPlan`, `trainerManaged`.

## Writes

### `ensurePlan({ today })`
Idempotent. Returns the active plan's id, or generates one from whatever the
profile holds, using the cautious defaults in `04-plan-engine.md`. Call it
automatically when the hub finds no plan — a member should never meet an empty
workout tab.

### `updatePreferences({ today, goal, level, weekdays[], split })`
Normalises, saves the answers onto the profile, generates a new plan and
supersedes the old one. Refuses: *"Your trainer manages this plan"*,
*"Profile missing"*, *"Pick at least 3 training days"*.

### `recreatePlan({ today, ...13 answers })`
Validates every answer, saves them all, generates, activates, then writes the
**calibrated** level back to the profile. Returns
`{ planId, level, goal, daysPerWeek, requiresProfessionalReview }`.
Split is forced to automatic here: the flow asks about the body, not the split.

### `moveSessionToToday({ from, today })`
Writes one override. Refuses: *"Only a past session can be moved"*, *"No active
plan"*, *"Nothing was scheduled that day"*, *"That session is already done"*,
*"Today's session is already done"*, *"Finish today's session before moving
another one here"*.

### `swapDays({ a, b, today })`
Writes two overrides. Refuses: *"Pick two different dates"*, *"A past session
cannot be swapped"*, *"No active plan"*, *"Both days need a session to swap"*,
*"A finished session cannot be swapped"*, *"A session already under way cannot
be swapped"*.

### `startSession({ date, today })`
Returns the running log if there is one, else creates it. Refuses: *"Invalid
date"*, *"Only today's session can be started"*, *"No active plan"*, *"Nothing
is scheduled today"*, *"That session is already done"*.

### `logSet({ logId, workoutExerciseId, setIndex, reps?, weightKg?, durationSec? })`
Upsert keyed by (log, exercise, set index). Checks: the log is the caller's and
still running (*"Session not found"*, *"That session is no longer running"*);
the exercise belongs to that session's day (*"That exercise is not part of this
session"*); the set index is an integer inside the prescribed sets (*"Invalid
set"*); reps ≤ 1000, weight ≤ 1000 kg, duration ≤ 3600 s.

### `completeSession({ logId })` / `abandonSession({ logId })`
Mark the log completed or abandoned. Abandoning releases the date back to
*planned* while keeping the sets already logged.

## Staff operations (one role in your app)

### `exercises.list({ search?, muscleGroup? })`
Indexed by muscle group or a capped scan, filtered case-insensitively, sorted by
name. Returns archived rows too, flagged — staff need to see what they archived.

### `exercises.create({ name, muscleGroup, equipment, pattern, difficulty, highRisk, lowImpact, machine, region, timedSec?, instructions? })`
The engine fields are **required**, not optional: a row the engine cannot place
is dead weight. Name unique case-insensitively (*"An exercise with that name
already exists"*), ≤ 80 chars; ≤ 10 instruction lines of ≤ 200 chars;
`timedSec` ≤ 3600.

### `exercises.update({ exerciseId, ...fields })`
Patches supplied fields with the same cleaners. (FORMA implements this but never
calls it — there is no edit screen. Build one.)

### `exercises.setArchived({ exerciseId, archived })`
Keeps the row so existing plans still resolve; only future generation changes.

### `exercises.createUploadUrl()` / `exercises.attachMedia({ exerciseId, storageId, kind })`
Upload a demo video or thumbnail and attach it, deleting the replaced blob.
