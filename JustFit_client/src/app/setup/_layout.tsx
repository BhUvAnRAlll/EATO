import { ActivityIndicator, View, Platform } from "react-native";
import { Redirect, Stack } from "expo-router";

import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// Profile setup steps (shown after sign in until the profile is complete).
// Setup needs a signed-in account: a signed-out visitor (a direct link, or a session that
// ended while a step was open) is sent to Log in. Signing out clears the answers so far, so
// they can't pre-fill another account (see store/auth.ts).
export default function SetupLayout() {
  const colors = useThemeColors();
  const status = useAuthStore((state) => state.status);

  // The saved session is still being checked: decide nothing yet (no flash, no redirect)
  if (status === "restoring") {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.leaf} />
      </View>
    );
  }
  // Couldn't check it (offline): the start screen offers to try again
  if (status === "unreachable") return <Redirect href="/" />;
  if (status !== "signedIn") return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
        // iOS keeps its native push and swipe back; Android slides the same way instead of
        // its default fade-up, so the app moves alike on both
        animation: Platform.OS === "android" ? "slide_from_right" : "default",
      }}
    />
  );
}
