import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";

import { useAuthStore } from "@/store/auth";
import { colors } from "@/theme";

// Profile setup steps (shown after sign in until the profile is complete).
// Setup needs a signed-in account: a signed-out visitor (a direct link, or a session that
// ended while a step was open) is sent to Log in. Signing out clears the answers so far, so
// they can't pre-fill another account (see store/auth.ts).
export default function SetupLayout() {
  const status = useAuthStore((state) => state.status);

  // The saved session is still being checked: decide nothing yet (no flash, no redirect)
  if (status === "restoring") {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
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
      }}
    />
  );
}
