import { useEffect, useRef } from "react";
import type { StyleProp, TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

type AnimatedNumberProps = {
  // The value as shown ("1,040", "52/120g"); a new string animates in
  children: string;
  className?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
};

// A figure that changes in place: calories left, eaten, a macro's grams. When it changes, the
// new figure rises the last few points into place as it brightens, so the change reads as a
// change instead of a jump. It stays one Text in the layout the whole time (no swapped copies),
// so it never shifts its neighbours. The screen opens on the value as it is; Reduce Motion
// shows changes at once.
export function AnimatedNumber({ children, style, ...text }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const arrive = useSharedValue(1);
  const shown = useRef(children);

  useEffect(() => {
    if (shown.current === children) return;
    shown.current = children;
    if (reduceMotion) return;
    arrive.set(0);
    arrive.set(withTiming(1, { duration: 320 }));
  }, [children, reduceMotion, arrive]);

  const motion = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * arrive.get(), transform: [{ translateY: 6 * (1 - arrive.get()) }] }));

  return (
    <Animated.Text {...text} style={[style, motion]}>
      {children}
    </Animated.Text>
  );
}
