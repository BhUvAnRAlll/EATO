import { Platform, View } from "react-native";
import { Stack } from "expo-router";

import { SessionExpiredBanner } from "@/components/SessionExpiredBanner";
import { useThemeColors } from "@/theme";

// The gym admin portal opens on its tabs (Home · Settings · Wallet)
export const unstable_settings = { initialRouteName: "(tabs)" };

// Gym admin screens. Only people with the "gym_admin" role can open these (see the root layout).
export default function GymLayout() {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.gymPage },
          animation: Platform.OS === "android" ? "slide_from_right" : "default",
        }}
      />
      <SessionExpiredBanner />
    </View>
  );
}
