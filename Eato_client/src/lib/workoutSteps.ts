// The session player's step list, built once from the day: every set of every exercise in plan
// order, with a rest after each set except after the very last one and where the exercise has
// no rest. Pure (no React Native imports), so it is unit-tested in __tests__/workoutSteps.test.ts.

export type StepExercise = {
  id: string;
  name: string;
  sets: { reps?: number; durationSec?: number; weightKg?: number }[];
  restSec: number;
  repsMin: number | null;
  repsMax: number | null;
};

export type SetStep = {
  kind: "set";
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  setIndex: number;
  setCount: number;
  // A timed set counts down from this; a rep set shows `reps` and waits for "Set done"
  durationSec: number | null;
  reps: number;
  weightKg: number | null;
};
export type RestStep = { kind: "rest"; exerciseIndex: number; durationSec: number };
export type Step = SetStep | RestStep;

// The reps a set asks for: the set's own reps, else the top of the range
export function prescribedReps(exercise: StepExercise, setIndex: number): number {
  return exercise.sets[setIndex]?.reps ?? exercise.repsMax ?? exercise.repsMin ?? 0;
}

export function buildSteps(exercises: StepExercise[]): Step[] {
  const steps: Step[] = [];
  exercises.forEach((exercise, exerciseIndex) => {
    exercise.sets.forEach((set, setIndex) => {
      steps.push({
        kind: "set",
        exerciseIndex,
        exerciseId: exercise.id,
        name: exercise.name,
        setIndex,
        setCount: exercise.sets.length,
        durationSec: set.durationSec ?? null,
        reps: prescribedReps(exercise, setIndex),
        weightKg: set.weightKg ?? null,
      });
      const lastOfAll = exerciseIndex === exercises.length - 1 && setIndex === exercise.sets.length - 1;
      if (!lastOfAll && exercise.restSec > 0) steps.push({ kind: "rest", exerciseIndex, durationSec: exercise.restSec });
    });
  });
  return steps;
}

export const setKey = (exerciseId: string, setIndex: number) => `${exerciseId}:${setIndex}`;

/**
 * Where the player opens: the first set of `startExerciseId` when one is asked for, else the
 * first set not yet logged. Returns steps.length when every set is already done.
 */
export function startIndex(steps: Step[], logged: Set<string>, startExerciseId?: string | null): number {
  if (startExerciseId) {
    const at = steps.findIndex((s) => s.kind === "set" && s.exerciseId === startExerciseId);
    if (at >= 0) return at;
  }
  const open = steps.findIndex((s) => s.kind === "set" && !logged.has(setKey(s.exerciseId, s.setIndex)));
  return open >= 0 ? open : steps.length;
}

// How far each exercise is, 0 to 1, for the progress strip (one segment per exercise)
export function exerciseProgress(exercises: StepExercise[], logged: Set<string>): number[] {
  return exercises.map((e) => {
    if (e.sets.length === 0) return 0;
    const done = e.sets.filter((_, i) => logged.has(setKey(e.id, i))).length;
    return done / e.sets.length;
  });
}

// The total number of sets, and how many are logged: "8 of 12 sets"
export function setTotals(steps: Step[], logged: Set<string>) {
  const sets = steps.filter((s): s is SetStep => s.kind === "set");
  return { total: sets.length, done: sets.filter((s) => logged.has(setKey(s.exerciseId, s.setIndex))).length };
}
