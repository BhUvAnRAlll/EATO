import { Stack } from "expo-router";

import { colors } from "@/theme";

// A member's screens: the tab bar group plus the screens pushed over it
// (notifications, addresses, nutrition, goals). Only the "user" role gets here (root layout).
export default function UserLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    >
      <Stack.Screen name="(tabs)" />
      {/* Workout: opened from Profile since AI Coach took its tab */}
      <Stack.Screen name="workout/index" />
      {/* The session player fades in: a slide under a full-screen timer reads as a glitch */}
      <Stack.Screen name="workout/session" options={{ animation: "fade" }} />
      {/* Changing the plan interrupts rather than drills down: a full-screen modal */}
      <Stack.Screen name="workout/preferences" options={{ presentation: "fullScreenModal" }} />
      {/* "Rebuild my plan" opens over Preferences as its own full-screen modal */}
      <Stack.Screen name="workout/recreate" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}
