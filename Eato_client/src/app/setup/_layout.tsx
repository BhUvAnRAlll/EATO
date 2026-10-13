import { Stack } from "expo-router";

import { colors } from "@/theme";

// Profile setup steps (shown after sign in until the profile is complete)
export default function SetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    />
  );
}
