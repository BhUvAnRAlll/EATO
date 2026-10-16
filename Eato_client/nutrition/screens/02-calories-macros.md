# Calories & macros — `/nutrition/calories-macros`

Averages and the split for Today, this Week or this Month, plus the seven-day
calorie trend. Pushed from the hub's "Calories & macros" row.

## Layout, top to bottom

1. **Header.** Back chevron; title **"Calories & macros"**; right, a share
   button. Share sends the line *"My {period} on FORMA: {kcal} / {target} kcal ·
   P {g}g · C {g}g · F {g}g"*. On failure: alert **"Couldn't share"** /
   *"Try again in a moment."*
2. **Segmented control** — **Today / Week / Month**. Switching re-reads the
   summary for 1, 7 or 30 days ending today.
3. **Ring card.** A three-arc donut split by each macro's **share of calories**
   (protein ×4, carbs ×4, fat ×9), not by grams. With nothing logged it falls
   back to an even third each so the ring never collapses. The centre shows the
   average kcal and the word "kcal". To the right, a legend: Protein, Carbs, Fat
   with their percentages, a divider, then *"Target split {p} / {c} / {f}"*.
   Ring 148 pt, dropping to 120 pt (13 pt stroke) under 375 pt wide.
4. **Three macro tiles** in a row — Protein, Carbs, Fat. Each: an icon, the
   grams rounded, the label, a progress track, and *"{pct}% of {target}g"*.
5. **"This week" card.** Caption *"Avg {kcal} kcal · target {target}"*, and a
   delta pill: under target shows a down-right arrow on a success tint, over
   target an up-right arrow on a warning tint, reading *"{+}{delta} avg"*.
   Below, a seven-bar chart (max height 96 pt) scaled to
   `max(target × 1.15, highest day, 1)`, today's bar in the accent colour and
   the rest in the line colour, weekday initials underneath.
6. **Footer action** — a secondary button **"Adjust targets"** → Adjust targets.

## States

- **Loading** — full-screen loading state.
- **No target** — dashed block, icon `chart.pie`, title **"Calorie target not
  set up yet"**, body *"Finish your profile to see your calories and macros
  here."* → profile.
- **Nothing logged** — not a separate state: averages read 0 and the ring shows
  its even fallback split.
- **Errors** — only the share alert.

## Data

- `periodSummary({ period, today })` — averages, targets, and always the 7-day
  trend regardless of the selected period.

## Navigation

- Pushes Adjust targets, the profile.
- Back → previous screen, falling back to the hub.
