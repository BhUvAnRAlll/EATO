import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { getHomeRoute } from "@/lib/roles";
import { useAuthStore } from "@/store/auth";
import { colors } from "@/theme";

// Start screen. Signed-out people go to onboarding; signed-in people open the dashboard for
// their role (members who haven't finished their profile go to setup first). Role and setup
// state are the server's answer for the saved session (see store/auth.ts).
export default function Index() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const notice = useAuthStore((state) => state.notice);
  const [signingOut, setSigningOut] = useState(false);

  // The saved session couldn't be checked (offline, or the server is down): keep it, because it
  // may still be valid, and offer to try again. Signing out here forgets it on this device.
  if (status === "unreachable") {
    return (
      <View className="flex-1 justify-center gap-4 bg-cream px-7.5">
        <FormAlert message="We couldn't reach justFit to check your account. Check your connection and try again." />
        <PrimaryButton label="Try again" onPress={() => useAuthStore.getState().restore()} />
        <Pressable
          onPress={async () => {
            setSigningOut(true);
            await useAuthStore.getState().signOut();
            setSigningOut(false);
          }}
          disabled={signingOut}
          className="btn-outline"
          accessibilityRole="button"
        >
          <Text className="btn-outline__label">Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (status === "restoring") {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  // A sign-out the server couldn't confirm: Log in says so (see store/auth.ts)
  if (status !== "signedIn" || !user) return <Redirect href={notice ? "/sign-in" : "/onboarding"} />;
  return <Redirect href={getHomeRoute(user)} />;
}
