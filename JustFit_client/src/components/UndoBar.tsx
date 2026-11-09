import { useEffect } from "react";
import { Platform, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOut, ReduceMotion } from "react-native-reanimated";

import { undoPending } from "@/lib/undo";
import { SHAKE_INTERVAL_MS, restingShake, shakeStep } from "@/lib/undoRules";
import { useUndoStore } from "@/store/undo";
import { useThemeColors } from "@/theme";

// The Undo bar (lib/undo.ts offerUndo): "250 ml removed · Undo" above the tab bar for a few
// seconds, on every platform the same dark snackbar. While it shows, and only then, the phone's
// accelerometer is read so a shake does what Undo does (expo-sensors; not on the web). The Undo
// button stays the way to undo for anyone who can't or won't shake. Mounted once, at the root.
export function UndoBar() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const pending = useUndoStore((state) => state.pending);
  useShakeToUndo(pending !== null);
  if (!pending) return null;
  return (
    <Animated.View
      key={pending.id}
      entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
      className="undo-bar"
      style={{ bottom: insets.bottom + 88, backgroundColor: colors.inverse }}
    >
      <Text className="undo-bar__text" style={{ color: colors.onInverse }} numberOfLines={2}>{pending.text}</Text>
      <Pressable onPress={undoPending} hitSlop={8} className="undo-bar__action" accessibilityRole="button" accessibilityLabel={`Undo: ${pending.text}`}>
        <Text className="undo-bar__action-label" style={{ color: colors.onInverse }}>Undo</Text>
      </Pressable>
    </Animated.View>
  );
}

// expo-sensors is native: an app built before it was added (2026-11-09) has none, and importing
// it there would stop the app at launch. Read it only when it's there; until the next build, shake
// does nothing and the Undo button still works.
type AccelerometerModule = typeof import("expo-sensors").Accelerometer;
function loadAccelerometer(): AccelerometerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("expo-sensors") as typeof import("expo-sensors")).Accelerometer;
  } catch {
    return null;
  }
}

function useShakeToUndo(listening: boolean) {
  useEffect(() => {
    if (!listening || Platform.OS === "web") return;
    const Accelerometer = loadAccelerometer();
    if (!Accelerometer) return;
    let stopped = false;
    let subscription: { remove: () => void } | null = null;
    let state = restingShake();
    Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!available || stopped) return;
        Accelerometer.setUpdateInterval(SHAKE_INTERVAL_MS);
        subscription = Accelerometer.addListener((reading) => {
          const step = shakeStep(state, reading, Date.now());
          state = step.state;
          if (step.shaken) undoPending();
        });
      })
      .catch(() => {});
    return () => {
      stopped = true;
      subscription?.remove();
    };
  }, [listening]);
}
