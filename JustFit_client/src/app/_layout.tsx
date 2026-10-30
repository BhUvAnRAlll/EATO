import "../global.css";

import { useEffect } from "react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { fontFiles } from "@/constants/fonts";
import { useAuthStore } from "@/store/auth";
import { colors } from "@/theme";
import { startAnalytics } from "@/lib/analytics";

// Each role can only open its own dashboard. If someone opens a screen they
// aren't allowed to (or signs out), Expo Router sends them back to the start
// screen, which redirects them to the right place. The role is the server's answer
// to GET /api/auth/me for the saved session (store/auth.ts), never anything stored here.
function RootStack() {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => (state.status === "signedIn" ? state.user?.role ?? null : null));

  // Ask the server about the saved session once at launch (the store runs one check at a time)
  useEffect(() => {
    useAuthStore.getState().restore().then(startAnalytics);
  }, []);

  // Until the saved session has been checked, nobody's role is known yet. The guards below
  // would treat every screen as forbidden and send a deep link (a reloaded page or a shared
  // link) to the start screen, so wait here instead. This happens at launch and on "Try again".
  if (status === "restoring") {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={role === "user"}>
        <Stack.Screen name="(user)" />
      </Stack.Protected>
      <Stack.Protected guard={role === "admin"}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
      {/* The gym owner portal: open to every signed-in role; the server allows a gym's own
          owner and admins, and justFit platform admins */}
      <Stack.Protected guard={role !== null}>
        <Stack.Screen name="owner" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // Poppins loads from the app bundle in a moment; if it ever fails, the system font is used
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  if (!fontsLoaded && !fontError) {
    return <View className="flex-1 bg-cream" />;
  }

  return <RootStack />;
}
