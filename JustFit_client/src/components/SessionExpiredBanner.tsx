import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SESSION_EXPIRED_MESSAGE, returnToSignIn, useSessionExpiry } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Over every member and admin screen once the server has refused the session (lib/session.ts):
// the sign-in-again message and the one way forward. Setup's screens show their own.
export function SessionExpiredBanner() {
  const expired = useSessionExpiry((state) => state.expired);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  if (!expired) return null;
  return (
    <View
      className="absolute left-0 right-0 top-0 px-4"
      style={{ paddingTop: insets.top + 8, zIndex: 50 }}
      pointerEvents="box-none"
    >
      <View
        className="alert items-center rounded-2xl border px-4 py-3"
        style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}
        accessibilityRole="alert"
      >
        <Text className="alert__text flex-1">{SESSION_EXPIRED_MESSAGE}</Text>
        <Pressable onPress={() => returnToSignIn()} className="btn-outline" accessibilityRole="button" hitSlop={8}>
          <Text className="btn-outline__label">Sign in again</Text>
        </Pressable>
      </View>
    </View>
  );
}
