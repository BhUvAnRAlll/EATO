import { Platform } from "react-native";
import { Stack } from "expo-router";

import { useThemeColors } from "@/theme";

// A member's screens: the tab bar group plus the screens pushed over it
// (notifications, addresses, nutrition, goals). Only the "user" role gets here (root layout).
export default function UserLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
        // iOS keeps its native push and swipe back; Android slides the same way instead of
        // its default fade-up, so the app moves alike on both
        animation: Platform.OS === "android" ? "slide_from_right" : "default",
      }}
    >
      <Stack.Screen name="(tabs)" />
      {/* The session player fades in: a slide under a full-screen timer reads as a glitch */}
      <Stack.Screen name="workout/session" options={{ animation: "fade" }} />
      {/* Changing the plan interrupts rather than drills down: a full-screen modal */}
      <Stack.Screen name="workout/preferences" options={{ presentation: "fullScreenModal" }} />
      {/* "Rebuild my plan" opens over Preferences as its own full-screen modal */}
      <Stack.Screen name="workout/recreate" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}
