import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { SymbolView } from "@/components/SymbolView";
import { GradientFill } from "@/components/gym/GradientFill";
import { gymTabs } from "@/data/gymDashboard";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// The gym admin portal's bar: white, a hairline on top, the active tab's icon white on the portal's
// gradient (the user's design, in the portal's theme).
export function GymTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View className="gym-tabbar" style={{ paddingBottom: Math.max(insets.bottom, 10) }} accessibilityRole="tablist">
      {state.routes.map((route, routeIndex) => {
        const tab = gymTabs.find((candidate) => candidate.name === route.name);
        if (!tab) return null;
        const active = state.index === routeIndex;
        const onPress = () => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!active && !event.defaultPrevented) {
            haptic.select();
            navigateToTab(route.key);
          }
        };
        return (
          <Pressable key={route.key} onPress={onPress} className="gym-tabbar__item" accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tab.label}>
            <View className={active ? "gym-tabbar__icon gym-tabbar__icon--active" : "gym-tabbar__icon"}>
              {active && <GradientFill radius={12} />}
              <SymbolView name={tab.icon} size={20} tintColor={active ? colors.white : colors.gymFaint} />
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
