import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@clerk/expo";

import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";

// Profile setup steps (shown after sign in until the profile is complete).
// Setup needs a signed-in account: a signed-out visitor (a direct link, or a session that
// ended while a step was open) is sent to Log in, and the answers so far are cleared so
// they can't pre-fill another account (as when leaving setup from the first step).
export default function SetupLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const signedOut = isLoaded && !isSignedIn;

  useEffect(() => {
    if (signedOut) useSetupStore.getState().reset();
  }, [signedOut]);

  // Clerk is still restoring the saved session: decide nothing yet (no flash, no redirect)
  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    />
  );
}
