import { Platform, View } from "react-native";
import { Stack } from "expo-router";

import { swipeBack } from "@/constants/navigation";
import { SessionExpiredBanner } from "@/components/SessionExpiredBanner";
import { useThemeColors } from "@/theme";

// The Super Admin portal opens on its tabs (Overview · Users · Content)
export const unstable_settings = { anchor: "(tabs)" };

// Admin screens. Only people with the "admin" role can open these (see the root layout).
export default function AdminLayout() {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          ...swipeBack,
          contentStyle: { backgroundColor: colors.cream },
          // iOS keeps its native push and swipe back; Android slides the same way instead of
          // its default fade-up, so the app moves alike on both
          animation: Platform.OS === "android" ? "slide_from_right" : "default",
        }}
      />
      <SessionExpiredBanner />
    </View>
  );
}
