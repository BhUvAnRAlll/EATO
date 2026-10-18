import { Stack } from "expo-router";

import { colors } from "@/theme";

// The gym owner portal: its tabs plus the screens pushed over them (Renewals). Any signed-in
// account can open the route (root layout); the server decides, per gym, who may see it: the
// gym's active owner and admins, and EATO platform admins.
export default function OwnerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    />
  );
}
