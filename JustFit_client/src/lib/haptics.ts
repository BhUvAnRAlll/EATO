import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// One place for the app's taps and buzzes, so they stay light and consistent:
//   haptic.select()  a soft tick when an option, chip, tab or toggle is chosen
//   haptic.tap()     a light knock for an important button (start, save, replace)
//   haptic.success() a workout finished, a check-in done, a plan saved
//   haptic.warning() something needs a second look (e.g. a destructive confirm)
//   haptic.error()   a form or request failed
// The web has no haptics, so every call is a no-op there. Calls closer together than
// MIN_GAP_MS are dropped so a fast scroll through chips never turns into a buzz.
const MIN_GAP_MS = 80;
let last = 0;

function fire(run: () => Promise<void>) {
  if (Platform.OS === "web") return;
  const now = Date.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;
  run().catch(() => {});
}

export const haptic = {
  select: () => fire(() => Haptics.selectionAsync()),
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export type HapticKind = keyof typeof haptic;
