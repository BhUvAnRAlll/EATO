import { useEffect, useState, type ReactNode } from "react";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";

// Symbol effects (2026-11-09, step 4 of the native interactions plan): an icon gives a short
// bounce when something it stands for happens: a tab becomes the selected one, a tick appears,
// a count changes. iPhone's SF Symbols play their own effect (SymbolView); everything else (the
// Lucide icons on Android and the web, and the gym portal's icons everywhere) uses this scale.
// Holds still with Reduce Motion on.

// How many times the icon should have bounced: +1 each time `trigger` changes to a truthy value
// after the first render (a tab becoming selected, a count going up from 0 or changing; never on
// going back to false, 0 or null), and once at mount with `onMount`. Nothing with Reduce Motion on.
export function useBounceCount(trigger: unknown, onMount = false) {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(onMount && !reduceMotion ? 1 : 0);
  // React's "adjust state when a prop changes": compared during render, never in an effect
  const [last, setLast] = useState(trigger);
  if (!Object.is(last, trigger)) {
    setLast(trigger);
    if (trigger && !reduceMotion) setCount(count + 1);
  }
  return count;
}

// The scale itself: up to 1.18 and back with a soft spring, about a third of a second
export function Bounce({ count, children }: { count: number; children: ReactNode }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (count === 0) return;
    scale.value = withSequence(withTiming(1.18, { duration: 120 }), withSpring(1, { damping: 9, stiffness: 260 }));
  }, [count, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={style} pointerEvents="none">{children}</Animated.View>;
}
