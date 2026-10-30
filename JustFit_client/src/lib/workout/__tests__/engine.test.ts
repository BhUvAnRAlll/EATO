/// <reference types="node" />
// The workout engine's rules, ported with the engine from FORMA's __tests__/workout-plan.test.ts.
// Run with: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISE_LIBRARY } from '../library.ts';
import {
  DEFAULT_MET,
  ENGINE_VERSION,
  type PlanInputs,
  SESSION_MET,
  SETUP_SECONDS_PER_EXERCISE,
  ageOn,
  calibrate,
  estimateKcal,
  exerciseSeconds,
  generatePlan,
  inputHashOf,
  inputsFromProfile,
  isValidWeekdays,
  metFor,
  normalizeInputs,
  sessionTypesFor,
  setSeconds,
  setsFor,
  sortWeekdays,
  toMinutes,
  trainingWeekdays,
} from '../engine.ts';

/** The engine is pure, so every rule is tested directly: no Convex, no clock, no network. */

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0;

/** The worked fixture: 22, average build, gain muscle, 3 days, healthy pace, off fitness 6 months, squats 6-15, push-ups 1-5, pull-ups 1-5. */
const FIXTURE: PlanInputs = {
  gender: 'male',
  ageYears: 22,
  weightKg: 50,
  heightCm: 157,
  bodyType: 'average',
  goal: 'build_muscle',
  weekdays: [MON, WED, FRI],
  pace: 'standard',
  fitnessBase: 2,
  squatScore: 3,
  pushScore: 2,
  pullScore: 2,
  seriousInjury: false,
};

const byName = new Map(EXERCISE_LIBRARY.map((e) => [e.name, e]));
const meta = (name: string) => {
  const e = byName.get(name);
  assert.ok(e, `library is missing "${name}"`);
  return e;
};
const working = (day: ReturnType<typeof generatePlan>['days'][number]) => day.exercises.filter((e) => e.section === 'workout' && e.role !== 'conditioning');

describe('time estimate', () => {
  it('counts reps at a fixed tempo and timed sets by their seconds', () => {
    assert.equal(setSeconds({ reps: 10 }), 30);
    assert.equal(setSeconds({ durationSec: 45 }), 45);
    assert.equal(exerciseSeconds({ sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }], restSec: 60 }), 3 * 30 + 2 * 60 + SETUP_SECONDS_PER_EXERCISE);
    assert.equal(exerciseSeconds({ sets: [], restSec: 60 }), 0);
    assert.equal(toMinutes(90), 2);
  });
});

describe('calorie estimate', () => {
  it('applies kcal = MET x weightKg x hours', () => {
    assert.equal(estimateKcal(6, 70, 60), 420);
    assert.equal(estimateKcal(3.5, 70, 30), 123); // 122.5 rounded
    assert.equal(estimateKcal(6, 70, 0), 0);
    assert.equal(estimateKcal(6, 0, 60), 0);
  });

  it('keeps every session MET inside the resistance-training band, heaviest first', () => {
    for (const met of Object.values(SESSION_MET)) {
      assert.ok(met >= 3.5 && met <= 6, `${met} is not a resistance-training MET`);
    }
    assert.ok(SESSION_MET.full_body > SESSION_MET.upper);
    assert.ok(SESSION_MET.legs > SESSION_MET.push);
  });

  it('falls back to moderate lifting for a missing or unknown session type', () => {
    assert.equal(metFor('full_body'), SESSION_MET.full_body);
    assert.equal(metFor(null), DEFAULT_MET);
    assert.equal(metFor(undefined), DEFAULT_MET);
    assert.equal(metFor('yoga'), DEFAULT_MET);
  });
});

describe('weekdays', () => {
  it('spreads automatic frequencies and validates chosen days', () => {
    for (let days = 1; days <= 6; days++) assert.equal(new Set(trainingWeekdays(days)).size, days);
    assert.ok(isValidWeekdays([1, 3, 5]));
    assert.ok(!isValidWeekdays([]));
    assert.ok(!isValidWeekdays([1, 1]));
    assert.ok(!isValidWeekdays([7]));
    assert.deepEqual(sortWeekdays([SUN, SAT, MON]), [MON, SAT, SUN]);
  });

  it('computes whole years for a birthday', () => {
    assert.equal(ageOn('2004-09-15', '2026-09-15'), 22);
    assert.equal(ageOn('2004-09-16', '2026-09-15'), 21);
  });
});

describe('normalizeInputs', () => {
  it('rejects out-of-range answers with the field named', () => {
    assert.throws(() => normalizeInputs({ ...FIXTURE, ageYears: 9 }), /Age/);
    assert.throws(() => normalizeInputs({ ...FIXTURE, weekdays: [] }), /days/);
    assert.throws(() => normalizeInputs({ ...FIXTURE, squatScore: 5 as never }), /squats/);
    assert.throws(() => normalizeInputs({ ...FIXTURE, bodyType: 'slim' as never }), /body type/);
  });

  it('canonicalises so equal answers hash the same', () => {
    const a = normalizeInputs({ ...FIXTURE, weekdays: [FRI, MON, WED] });
    const b = normalizeInputs(FIXTURE);
    assert.deepEqual(a, b);
    assert.equal(inputHashOf(a, ENGINE_VERSION), inputHashOf(b, ENGINE_VERSION));
    assert.notEqual(inputHashOf({ ...b, pace: 'brisk' }, ENGINE_VERSION), inputHashOf(b, ENGINE_VERSION));
  });
});

describe('calibration', () => {
  it('worked fixture: scores 2/3/2/2 average 2.25 is a beginner with a stronger lower body', () => {
    const c = calibrate(FIXTURE);
    assert.equal(c.score, 2.25);
    assert.equal(c.level, 'beginner');
    assert.deepEqual(c.ceilings, { lower: 2, push: 1, pull: 1, other: 1 });
  });

  it('strong legs and weak push (2/4/1/1) stay a beginner; the lower ceiling rises one step only', () => {
    const c = calibrate({ ...FIXTURE, fitnessBase: 2, squatScore: 4, pushScore: 1, pullScore: 1 });
    assert.equal(c.level, 'beginner');
    assert.deepEqual(c.ceilings, { lower: 2, push: 1, pull: 1, other: 1 });
  });

  it('strong push and weak pull mirror the ceilings', () => {
    const c = calibrate({ ...FIXTURE, fitnessBase: 3, squatScore: 3, pushScore: 4, pullScore: 1 });
    assert.equal(c.level, 'intermediate');
    assert.deepEqual(c.ceilings, { lower: 2, push: 3, pull: 1, other: 2 });
  });

  it('a base answer of 1 is always a beginner, whatever the average', () => {
    assert.equal(calibrate({ ...FIXTURE, fitnessBase: 1, squatScore: 4, pushScore: 4, pullScore: 4 }).level, 'beginner');
  });

  it('a serious injury pins every ceiling to 1 and flags the plan for review', () => {
    const c = calibrate({ ...FIXTURE, fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4, seriousInjury: true });
    assert.equal(c.safetyMode, true);
    assert.deepEqual(c.ceilings, { lower: 1, push: 1, pull: 1, other: 1 });
    const plan = generatePlan({ ...FIXTURE, seriousInjury: true }, EXERCISE_LIBRARY);
    assert.equal(plan.requiresProfessionalReview, true);
    for (const day of plan.days) for (const e of day.exercises) assert.equal(meta(e.name).highRisk, false, `${e.name} is high risk`);
  });

  it('age only caps: under 18 and 60+ never exceed intermediate', () => {
    const strong: PlanInputs = { ...FIXTURE, fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4 };
    assert.deepEqual(calibrate({ ...strong, ageYears: 16 }).ceilings, { lower: 2, push: 2, pull: 2, other: 2 });
    assert.deepEqual(calibrate({ ...strong, ageYears: 64 }).ceilings, { lower: 2, push: 2, pull: 2, other: 2 });
    assert.deepEqual(calibrate({ ...strong, ageYears: 30 }).ceilings, { lower: 3, push: 3, pull: 3, other: 3 });
  });
});

describe('splits', () => {
  it('picks the split by frequency', () => {
    assert.deepEqual(sessionTypesFor('auto', 3), ['full_body', 'full_body', 'full_body']);
    assert.deepEqual(sessionTypesFor('auto', 4), ['upper', 'lower', 'upper', 'lower']);
    assert.deepEqual(sessionTypesFor('auto', 5), ['upper', 'lower', 'push', 'pull', 'legs']);
    assert.deepEqual(sessionTypesFor('auto', 6), ['push', 'pull', 'legs', 'push', 'pull', 'legs']);
    assert.deepEqual(sessionTypesFor('upper_lower', 3), ['upper', 'lower', 'upper']);
  });
});

describe('pace', () => {
  it('moves sets up from the bottom of the range without changing the range', () => {
    assert.equal(setsFor('beginner', 'main', 'slow'), 2);
    assert.equal(setsFor('beginner', 'main', 'standard'), 3);
    assert.equal(setsFor('beginner', 'main', 'brisk'), 3);
    assert.equal(setsFor('intermediate', 'main', 'slow'), 3);
    assert.equal(setsFor('intermediate', 'main', 'brisk'), 4);
    assert.equal(setsFor('advanced', 'main', 'brisk'), 4);
  });
});

describe('generatePlan', () => {
  it('worked fixture: three full-body days with the expected structure', () => {
    const plan = generatePlan(FIXTURE, EXERCISE_LIBRARY);
    assert.equal(plan.level, 'beginner');
    assert.equal(plan.engineVersion, ENGINE_VERSION);
    assert.deepEqual(plan.days.map((d) => d.weekday), [MON, WED, FRI]);
    assert.deepEqual(plan.days.map((d) => d.sessionType), ['full_body', 'full_body', 'full_body']);
    for (const day of plan.days) {
      assert.equal(day.exercises.filter((e) => e.section === 'warmup').length, 1);
      const work = working(day);
      assert.equal(work.length, 5, 'five working exercises');
      assert.deepEqual(work.map((e) => e.role), ['main', 'main', 'main', 'secondary', 'isolation']);
      assert.deepEqual(work.map((e) => meta(e.name).pattern).slice(0, 4), ['squat', 'horizontal_push', work[2].name === 'Lat Pulldown' ? 'vertical_pull' : 'horizontal_pull', 'hinge']);
      assert.ok(meta(work[0].name).difficulty <= 2, 'squat within the lower ceiling');
      assert.equal(meta(work[1].name).difficulty, 1, 'push at the push ceiling');
      assert.equal(meta(work[2].name).difficulty, 1, 'pull at the pull ceiling');
      assert.ok(day.exercises.every((e) => e.role !== 'conditioning'), 'no conditioning for gain muscle');
      assert.deepEqual([work[0].sets.length, work[3].sets.length, work[4].sets.length], [3, 2, 2]);
      assert.deepEqual([work[0].repsMin, work[0].repsMax], [6, 12]);
      assert.deepEqual([work[3].repsMin, work[3].repsMax], [8, 12]);
      assert.deepEqual([work[4].repsMin, work[4].repsMax], [10, 15]);
      assert.deepEqual([work[0].restSec, work[3].restSec, work[4].restSec], [90, 90, 60]);
      for (const e of day.exercises) assert.ok(byName.has(e.name), `${e.name} comes from the library`);
    }
  });

  it('beginner + lose weight + 4 days: upper/lower with a finisher each session and 8-12 reps', () => {
    const plan = generatePlan({ ...FIXTURE, goal: 'lose_weight', weekdays: [MON, TUE, THU, FRI] }, EXERCISE_LIBRARY);
    assert.deepEqual(plan.days.map((d) => d.sessionType), ['upper', 'lower', 'upper', 'lower']);
    for (const day of plan.days) {
      assert.equal(day.exercises.filter((e) => e.role === 'conditioning').length, 1);
      for (const e of working(day)) if (e.repsMin !== undefined) assert.ok(e.repsMin! >= 8 && e.repsMax! <= 15);
      const mains = working(day).filter((e) => e.role === 'main');
      mains.forEach((e) => assert.deepEqual([e.repsMin, e.repsMax], [8, 12]));
    }
  });

  it('intermediate + gain muscle + 5 days: the five-way split with intermediate volume', () => {
    const plan = generatePlan({ ...FIXTURE, fitnessBase: 3, squatScore: 3, pushScore: 3, pullScore: 3, weekdays: [MON, TUE, WED, THU, FRI] }, EXERCISE_LIBRARY);
    assert.equal(plan.level, 'intermediate');
    assert.deepEqual(plan.days.map((d) => d.sessionType), ['upper', 'lower', 'push', 'pull', 'legs']);
    const main = working(plan.days[0]).find((e) => e.role === 'main');
    assert.equal(main?.sets.length, 4);
    assert.equal(main?.restSec, 120);
  });

  it('advanced + stay fit + 6 days: push/pull/legs twice with two finishers a week', () => {
    const plan = generatePlan({ ...FIXTURE, goal: 'get_fitter', fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4, ageYears: 30, weekdays: [MON, TUE, WED, THU, FRI, SAT] }, EXERCISE_LIBRARY);
    assert.equal(plan.level, 'advanced');
    assert.deepEqual(plan.days.map((d) => d.sessionType), ['push', 'pull', 'legs', 'push', 'pull', 'legs']);
    const finishers = plan.days.flatMap((d) => d.exercises.filter((e) => e.role === 'conditioning'));
    assert.equal(finishers.length, 2);
  });

  it('lands sessions on the chosen weekdays and softens a back-to-back lower day', () => {
    const plan = generatePlan({ ...FIXTURE, weekdays: [MON, TUE, FRI] }, EXERCISE_LIBRARY);
    assert.deepEqual(plan.days.map((d) => d.weekday), [MON, TUE, FRI]);
    const monFirst = working(plan.days[0])[0];
    const tueFirst = working(plan.days[1])[0];
    assert.equal(meta(monFirst.name).pattern, 'squat');
    assert.equal(meta(tueFirst.name).pattern, 'lunge');
    assert.equal(tueFirst.role, 'secondary');
    assert.equal(meta(working(plan.days[2])[0].name).pattern, 'squat');
  });

  it('is deterministic and never repeats an exercise more than twice a week', () => {
    const a = generatePlan(FIXTURE, EXERCISE_LIBRARY);
    const b = generatePlan({ ...FIXTURE, weekdays: [FRI, WED, MON] }, EXERCISE_LIBRARY);
    assert.deepEqual(a, b);
    assert.equal(a.inputHash, b.inputHash);
    const counts = new Map<string, number>();
    for (const day of a.days) for (const e of day.exercises) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    for (const [name, n] of counts) assert.ok(n <= 2, `${name} appears ${n} times`);
  });

  it('heavier body types get low-impact conditioning and no jumps', () => {
    const plan = generatePlan({ ...FIXTURE, goal: 'lose_weight', bodyType: 'obese', weekdays: [MON, WED, FRI] }, EXERCISE_LIBRARY);
    for (const day of plan.days) for (const e of day.exercises) assert.equal(meta(e.name).lowImpact, true, `${e.name} is not low impact`);
    assert.ok(plan.days.every((d) => d.exercises.some((e) => e.role === 'conditioning')));
  });

  it('builds cautious inputs from a profile that never answered the engine questions', () => {
    const inputs = inputsFromProfile({ goal: 'build_muscle', experience: 'beginner', daysPerWeek: 3, dateOfBirth: '2000-01-01' }, '2026-09-15');
    assert.equal(inputs.ageYears, 26);
    assert.equal(inputs.fitnessBase, 1);
    assert.deepEqual(inputs.weekdays, trainingWeekdays(3));
    assert.equal(generatePlan(inputs, EXERCISE_LIBRARY).level, 'beginner');
  });

  it('keeps library names unique so plans resolve to one row each', () => {
    const names = EXERCISE_LIBRARY.map((e) => e.name);
    assert.equal(new Set(names).size, names.length);
  });
});
