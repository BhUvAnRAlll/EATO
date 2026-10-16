# Data model and calculations

Seven stores, all keyed by the member. Field names are FORMA's; keep or rename
them, but keep the shapes — the screens assume them.

## Stores

### `nutritionTargets` — one row per member
| Field | Type | Notes |
|---|---|---|
| `userId` | member ref | unique; index on it |
| `kcal`, `proteinG`, `carbsG`, `fatG` | number | the daily target |
| `bmr`, `tdee` | number | kept so the number can be explained |
| `goal`, `activityLevel` | enum | the inputs that produced it |
| `calcVersion`, `calculatedAt` | number | which formula, and when |
| `isManual` | boolean? | **true stops automatic recalculation** |
| `updatedAt` | number | |

### `meals` — one row per logged meal
| Field | Type | Notes |
|---|---|---|
| `userId` | member ref | |
| `date` | `YYYY-MM-DD` | the member's local day |
| `slot` | `breakfast\|lunch\|dinner\|snack` | |
| `title` | string | trimmed, max 120 chars |
| `loggedAt` | number | timestamp, drives the timeline order |
| `photoId` | file ref? | optional meal photo |
| `source` | `manual\|favorite\|repeat` | how it was logged; shown as a label |

Indexes: by `(userId, date)` for a day, by `(userId, loggedAt)` for "recent".

### `mealItems` — the foods inside a meal
`mealId`, `userId`, `name`, `quantity`, `unit`, `kcal`, `proteinG`, `carbsG`,
`fatG`. Indexed by `mealId`. A meal's totals are always **summed from its
items** — never stored on the meal, so an edit cannot drift.

### `favoriteFoods`
`userId`, `name`, `photoId?`, `items[]` (same shape as meal items),
`sourceKey?`, `createdAt`. Indexes: by `userId`, and by `(userId, sourceKey)`.

`sourceKey` is what makes the heart a true toggle: a meal hearted as
`meal:<id>` un-hearts on the second tap. A favourite saved without a source key
always inserts a new row.

### `waterLogs`
`userId`, `date`, `amountMl`, `loggedAt`, `source` (`quick_add | custom |
workout`), `label?`. Indexed by `(userId, date)`.

### `hydrationDays` — one row per member per day
`userId`, `date`, `targetMl`, `baseTargetMl`, `activityAdjustmentMl`,
`workoutAdjustmentMl`, `environmentalAdjustmentMl`, `consumedMl`,
`workoutMinutes?`, `workoutIntensity?`, `calcVersion`.

Created on the first write of the day, holding that day's estimate.
`consumedMl` is a cache refreshed on every write; the day screen still sums the
entries rather than trusting it.

### `hydrationPreferences` — one row per member
`userId`, `remindersEnabled`, `intervalHours`, `startHour`, `endHour`.
Defaults: on, every 2 hours, 08:00–20:00.

### Profile inputs (already in your app, probably)
The calorie and hydration maths need: `gender`, `dateOfBirth`, `heightCm`,
`weightKg`, `daysPerWeek`, `goal`.

## Calorie target

Mifflin-St Jeor, then activity, then the goal.

```
base = 10 × weightKg + 6.25 × heightCm − 5 × age
bmr  = male   → base + 5
       female → base − 161
       other  → base − 78

activity from daysPerWeek:
  ≤1 sedentary 1.2 | ≤3 light 1.375 | ≤5 moderate 1.55 | 6 very 1.725 | 7 extreme 1.9

tdee = bmr × multiplier

goal: lose_weight → −500 | build_muscle → +300 | otherwise 0

kcal = clamp(round((tdee + goalAdjustment) / 10) × 10, 1200, 4500)
```

Macros from that number:

```
proteinPerKg = goal is gain ? 2.0 : 1.6
proteinG     = round(weightKg × proteinPerKg)
fatG         = round(kcal × 0.25 / 9)
carbsG       = max(0, round((kcal − proteinG×4 − fatG×9) / 4))
```

Validation before calculating — report which inputs are missing rather than
throwing: age 13–100, weight 25–300 kg, height 100–250 cm, daysPerWeek 0–7.
Missing inputs are named to the member as *sex, weight, height, age,
activityLevel, goal*.

Recalculate whenever the profile's body metrics, goal or weekly workout days
change — **unless `isManual` is set**.

## Hydration target

```
mlPerKg   = age < 30 → 35 | age < 56 → 33 | else 30
sexFactor = male 1.0 | female 0.95 | other/unset 0.97
base      = round(clamp(weightKg, 30, 250) × mlPerKg × sexFactor)

activity from daysPerWeek: ≥5 → +250 ml | ≥3 → +150 ml | else 0

workout:  ml = (minutes / 60) × 500 × intensity, rounded to 25 ml
          intensity: light 0.75 | moderate 1.0 | high 1.25, minutes capped at 300
          this REPLACES the day's workout adjustment, it never accumulates

environment (only if you have readings):
          temp ≥ 30 °C → +500 | temp ≥ 25 °C → +250;  humidity ≥ 70 % → +150

target = clamp(roundTo50(base + activity + workout + environment), 1500, 5000)
```

Fallbacks when the profile is thin: weight 70 kg, age 30 — and set a
`usedFallbacks` flag so the screen can say *"Add your weight in your profile for
a closer estimate."*

## Grading a day

Used by the week strip and the month calendar to colour each day's ring:

```
ratio = kcal eaten / kcal target
none      no meals, or no target
complete  ratio ≥ 0.9     → success colour
partial   ratio ≥ 0.5     → warning colour
low       anything else   → danger colour
```

## Other numbers the UI uses

- Macro energy: protein 4 kcal/g, carbs 4, fat 9. Used for every split, ring and
  sanity check.
- "On track" badge on Daily calories: `protein ≥ 55% of target` **and**
  `eaten ≤ kcal target`.
- Manual-entry sanity check: flag when the typed macros imply a calorie figure
  more than **15%** away from the typed calories. A warning, never a block.
- Recent meals: the last **3 days**, newest first, capped at 12 shown.
