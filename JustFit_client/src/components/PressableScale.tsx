import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { haptic, type HapticKind } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, "style"> & {
  className?: string;
  style?: StyleProp<ViewStyle>;
  // How far it shrinks while held (0.97 by default; big cards use less)
  scaleTo?: number;
  // A haptic to play on press (none by default)
  haptic?: HapticKind;
};

// A Pressable that eases down to ~97% while held and springs back on release, the iOS feel
// for buttons and cards. It runs on the UI thread (Reanimated), so it stays smooth while the
// JS thread is busy, and it doesn't move at all when the phone asks for reduced motion.
export function PressableScale({ scaleTo = 0.97, haptic: kind, onPressIn, onPressOut, onPress, disabled, style, ...rest }: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const pressIn = (event: GestureResponderEvent) => {
    if (!reduceMotion) scale.set(withTiming(scaleTo, { duration: 90 }));
    onPressIn?.(event);
  };
  const pressOut = (event: GestureResponderEvent) => {
    if (!reduceMotion) scale.set(withSpring(1, { damping: 18, stiffness: 320, mass: 0.6 }));
    onPressOut?.(event);
  };
  const press = (event: GestureResponderEvent) => {
    if (kind) haptic[kind]();
    onPress?.(event);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={onPress ? press : undefined}
      style={[style, animated]}
    />
  );
}
