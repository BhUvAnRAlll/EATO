import { Stack } from "expo-router";

import { colors } from "@/theme";

// The Super Admin portal opens on its tabs (Overview · Users · Gyms · Reports · Content)
export const unstable_settings = { initialRouteName: "(tabs)" };

// Admin screens. Only people with the "admin" role can open these (see the root layout).
export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    />
  );
}
