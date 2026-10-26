import { useCallback } from "react";
import { Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import * as ScreenCapture from "expo-screen-capture";

// Blocks screenshots and screen recording while a screen with private body data is in front:
// Android shows a blank screen in captures, iOS 13+ blanks screenshots and recordings, and iOS
// also blurs the screen in the app switcher. Web browsers can't be stopped, so nothing happens there.
//
// On iOS the module protects the whole app window by moving it inside a secure layer, so it is
// switched on as late and as briefly as possible: only while this screen is focused, and only
// after its slide-in animation has finished (moving the window mid-transition can leave the
// screen black). Native stack transitions take about 350 ms, so it waits a little longer. Use it on one screen at a time, never on a screen that opens the photo picker.
export function useScreenProtection(key: string) {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      let active = false;
      const timer = setTimeout(() => {
        active = true;
        ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
        if (Platform.OS === "ios") ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
      }, 450);
      return () => {
        clearTimeout(timer);
        if (!active) return;
        ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
        if (Platform.OS === "ios") ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      };
    }, [key]),
  );
}
