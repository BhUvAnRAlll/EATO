import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

// The mic beside Send in the coach chat. Tap to start listening, tap again to stop. While
// listening it turns red with a soft ring pulsing behind it; with Reduce Motion on the ring
// sits still.
export function MicButton({ listening, disabled, onPress }: { listening: boolean; disabled?: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!listening || reduceMotion) {
      pulse.set(withTiming(0, { duration: 150 }));
      return;
    }
    pulse.set(withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1));
  }, [listening, reduceMotion, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: listening ? 0.9 - 0.6 * pulse.get() : 0,
    transform: [{ scale: 1 + 0.45 * pulse.get() }],
  }));

  return (
    <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Animated.View pointerEvents="none" className="coach__mic-pulse" style={ring} />
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={listening ? "coach__mic coach__mic--on" : "coach__mic"}
        style={disabled ? { opacity: 0.4 } : undefined}
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop listening" : "Speak your question"}
        accessibilityState={{ disabled: !!disabled, selected: listening }}
        hitSlop={4}
      >
        <SymbolView
          name={listening ? { ios: "mic.fill", android: "mic", web: "mic" } : { ios: "mic", android: "mic", web: "mic" }}
          size={20}
          tintColor={listening ? colors.onPrimary : colors.forestInk}
        />
      </Pressable>
    </View>
  );
}
