import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from "react-native-reanimated";

import { useThemeColors } from "@/theme";

function Dot({ phase, color }: { phase: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * phase.get(), transform: [{ translateY: -2 * phase.get() }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

// Three dots that rise and brighten in turn while the coach writes a reply, in place of a
// spinner. With Reduce Motion on they sit still at half strength.
export function TypingDots() {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    const beat = (delay: number) => withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 300 }), withTiming(0, { duration: 300 }), withTiming(0, { duration: 300 })), -1));
    a.set(beat(0));
    b.set(beat(150));
    c.set(beat(300));
  }, [a, b, c, reduceMotion]);

  return (
    <View className="flex-row items-center" style={{ gap: 5, height: 22 }}>
      {[a, b, c].map((phase, i) => (
        <Dot key={i} phase={phase} color={colors.faint} />
      ))}
    </View>
  );
}
