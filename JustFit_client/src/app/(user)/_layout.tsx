import { Platform, View } from "react-native";
import { Redirect, Stack, usePathname } from "expo-router";

import { swipeBack } from "@/constants/navigation";
import { SessionExpiredBanner } from "@/components/SessionExpiredBanner";
import { useThemeColors } from "@/theme";
import { useAuthStore } from "@/store/auth";

// AI Coach, Workout and Fitness screens: not part of a trainer's account (the server refuses them too);
// nor Gym membership or Gym Hub (2026-11-09): a trainer has no membership of their own
const NOT_FOR_TRAINERS = /^\/(coach|workout|fitness|membership|gym-hub)(\/|$)/;

// A member's screens: the tab bar group plus the screens pushed over it
// (notifications, addresses, nutrition, goals). Only members ("user") and a gym's trainers
// ("trainer") get here (root layout).
export default function UserLayout() {
  const colors = useThemeColors();
  // A trainer who reaches a Coach or Fitness screen anyway (a link, an old reminder, a promotion)
  // is sent Home before the screen renders, so it never shows for a frame or calls the server
  const pathname = usePathname();
  const trainer = useAuthStore((state) => state.user?.role === "trainer");
  if (trainer && NOT_FOR_TRAINERS.test(pathname)) return <Redirect href="/home" />;
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
      >
        <Stack.Screen name="(tabs)" />
        {/* The session player fades in: a slide under a full-screen timer reads as a glitch */}
        <Stack.Screen name="workout/session" options={{ animation: "fade" }} />
      </Stack>
      <SessionExpiredBanner />
    </View>
  );
}
