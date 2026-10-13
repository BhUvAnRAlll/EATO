import { Stack } from "expo-router";

import { colors } from "@/theme";

// Trainer screens. Only people with the "trainer" role can open these (see the root layout).
export default function TrainerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    />
  );
}
