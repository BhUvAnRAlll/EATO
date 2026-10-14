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
    </Stack>
  );
}
