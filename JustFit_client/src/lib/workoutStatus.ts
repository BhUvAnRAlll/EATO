// What the phone shows about a running workout outside the app (2026-11-09): Android's ongoing
// notification (lib/workoutNotification.ts) and, on iPhone, the Live Activity. Pure, so both read
// the same words and the tests pin them. No timer ticks here: a rest names its length and what
// follows, and the line changes when the step does.

import type { Step } from "./workoutSteps.ts";

export type WorkoutStatusInput = {
  dayTitle: string;
  step: Step | null;
  // The exercise the step belongs to, and the next exercise's name when the next step is a set
  exerciseName: string;
  nextName: string | null;
  done: number;
  total: number;
  paused: boolean;
};

export type WorkoutStatus = { title: string; body: string; progress: number };

export function workoutStatus({ dayTitle, step, exerciseName, nextName, done, total, paused }: WorkoutStatusInput): WorkoutStatus {
  const progress = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const sets = `${done} of ${total} sets done`;
  if (!step) return { title: `${dayTitle} · last set done`, body: `${sets}. Open justFit to finish.`, progress };
  const pause = paused ? " · paused" : "";
  if (step.kind === "rest") {
    const then = nextName ? `, then ${nextName}` : "";
    return { title: `Rest ${restLength(step.durationSec)}${pause}`, body: `${sets}${then}`, progress };
  }
  return { title: `${exerciseName} · set ${step.setIndex + 1} of ${step.setCount}${pause}`, body: `${dayTitle} · ${sets}`, progress };
}

// "45 s", "1 min", "1 min 30 s"
export function restLength(seconds: number): string {
  const secs = Math.max(0, Math.round(seconds));
  if (secs < 60) return `${secs} s`;
  const min = Math.floor(secs / 60);
  const rest = secs % 60;
  return rest ? `${min} min ${rest} s` : `${min} min`;
}
