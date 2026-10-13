import { Stack } from "expo-router";

import { colors } from "@/theme";

// Sign up and sign in share the same layout, so switching between them
// cross-fades instead of sliding. Opening this group from onboarding still slides in.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        animationDuration: 250,
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
