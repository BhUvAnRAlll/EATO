import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { tweenAt } from "@/lib/motionRules";

// A number that eases to `target` whenever it changes (a ring's fill, a bar's width), instead of
// jumping. It starts at the target, so a screen opens on its real values; with Reduce Motion on
// it follows the target at once. Runs on the JS thread: use it for a handful of values per
// screen, not a long list.
export function useTween(target: number, duration = 650): number {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(target);
  // Where the value is right now, so a new target eases on from there (even mid-tween)
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    let frame = 0;
    const start = Date.now();
    const step = () => {
      const next = reduceMotion ? target : tweenAt(from, target, Date.now() - start, duration);
      shown.current = next;
      setValue(next);
      if (next !== target) frame = requestAnimationFrame(step);
    };
    if (from !== target) frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduceMotion]);

  return value;
}
