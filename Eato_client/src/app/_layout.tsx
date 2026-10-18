import "../global.css";

import { ClerkProvider, useAuth, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { getRole } from "@/lib/roles";
import { colors } from "@/theme";

// Public key from .env (pulled with `clerk env pull`). Safe to ship in the app.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

if (!publishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Add your key to .env.\nRun: 1) clerk auth login  2) clerk link  3) clerk env pull — then restart the dev server."
  );
}

// Each role can only open its own dashboard. If someone opens a screen they
// aren't allowed to (or signs out), Expo Router sends them back to the start
// screen, which redirects them to the right place.
function RootStack() {
  const { isLoaded } = useAuth();
  const { user } = useUser();
  const role = getRole(user);

  // Until Clerk has restored the saved session, nobody's role is known yet. The guards
  // below would treat every screen as forbidden and send a deep link (a reloaded page or
  // a shared link) to the start screen, so wait here instead. This only happens at launch.
  if (!isLoaded) {
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
      <Stack.Protected guard={role === "trainer"}>
        <Stack.Screen name="trainer" />
      </Stack.Protected>
      {/* The gym owner portal: open to every signed-in role; the server allows a gym's own
          owner and admins, and EATO platform admins */}
      <Stack.Protected guard={role !== null}>
        <Stack.Screen name="owner" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    // tokenCache keeps the signed-in session in the device's secure storage
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <RootStack />
    </ClerkProvider>
  );
}
