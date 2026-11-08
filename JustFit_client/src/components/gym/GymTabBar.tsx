import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { GymIcon } from "@/components/gym/GymIcon";
import { GradientFill } from "@/components/gym/GradientFill";
import { gymTabs } from "@/data/gymDashboard";
import { haptic } from "@/lib/haptics";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// The gym admin portal's bar: white, a hairline on top, the active tab's icon white on the portal's
// gradient (the user's design, in the portal's theme).
export function GymTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const can = useCan();
  // Role & Permission: the Wallet is a Payments screen; Manage needs at least one of its areas
  const shown = (name: string) => (name === "wallet" ? can("payments") : name === "manage" ? can("members") || can("catalog") || can("enquiries") : true);

  return (
    <View className="gym-tabbar" style={{ paddingBottom: Math.max(insets.bottom, 10) }} accessibilityRole="tablist">
      {state.routes.map((route, routeIndex) => {
        const tab = gymTabs.find((candidate) => candidate.name === route.name);
        if (!tab || !shown(route.name)) return null;
        const active = state.index === routeIndex;
        // Manage has no top tabs: its tab always opens Members, even after a link opened another
        // section there (?tab=catalog), since a tab keeps the params it was last opened with
        const linkedTab = (route.params as { tab?: string } | undefined)?.tab;
        const otherSection = route.name === "manage" && linkedTab !== undefined && linkedTab !== "member";
        const onPress = () => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (event.defaultPrevented || (active && !otherSection)) return;
          haptic.select();
          if (otherSection) router.navigate("/gym/manage?tab=member");
          else navigateToTab(route.key);
        };
        return (
          <Pressable key={route.key} onPress={onPress} className="gym-tabbar__item" accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tab.label}>
            <View className={active ? "gym-tabbar__icon gym-tabbar__icon--active" : "gym-tabbar__icon"}>
              {active && <GradientFill radius={12} />}
              <GymIcon name={tab.icon} size={20} color={active ? colors.white : colors.gymFaint} />
            </View>
            <Text className={active ? "gym-tabbar__label gym-tabbar__label--active" : "gym-tabbar__label"} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
