import "../global.css";

import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";

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
  const { user } = useUser();
  const role = getRole(user);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={role === "user"}>
        <Stack.Screen name="home" />
      </Stack.Protected>
      <Stack.Protected guard={role === "admin"}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
      <Stack.Protected guard={role === "trainer"}>
        <Stack.Screen name="trainer" />
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
