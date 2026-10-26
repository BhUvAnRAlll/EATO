import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { homeTabs } from "@/data/home";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// raised: drawn as a round button lifted above the bar (the member's AI Coach)
export type TabItem = { name: string; label: string; icon: Icon; raised?: boolean };

type Props = BottomTabBarProps & {
  // The tabs to show, in order (default: the member's five, from data/home.ts)
  tabs?: TabItem[];
  // A count bubble on a tab's icon (route name → count; 0 hides it)
  badges?: Record<string, number>;
};

// The flat iOS-style tab bar (white, hairline on top, lavender active tab) under the member's screens (app/(user)/(tabs)/_layout.tsx) and the
// gym owner portal's (app/owner/(tabs)/_layout.tsx). It replaces the navigator's own bar, so
// there is never a second one behind it. A route without an entry in `tabs` isn't shown.
export function BottomTabBar({ state, emitter, navigateToTab, tabs = homeTabs, badges = {} }: Props) {
  const insets = useSafeAreaInsets();
  // Narrow phones (or six tabs): the labels only fit at a smaller size
  const { width } = useWindowDimensions();
  const narrow = width < 360 || (tabs.length > 5 && width < 400);

  return (
    <View className="tabbar" style={{ paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: narrow ? 2 : 8 }} accessibilityRole="tablist">
        {state.routes.map((route, routeIndex) => {
          const tab = tabs.find((candidate) => candidate.name === route.name);
          if (!tab) return null;
          const active = state.index === routeIndex;
          const badge = badges[tab.name] ?? 0;

          const onPress = () => {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!active && !event.defaultPrevented) navigateToTab(route.key);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              className={active ? "tabbar__item tabbar__item--active" : "tabbar__item"}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={badge > 0 ? `${tab.label}, ${badge} waiting` : tab.label}
            >
              <View>
                {tab.raised ? (
                  <View className={active ? "tabbar__raised tabbar__raised--active" : "tabbar__raised"}>
                    <SymbolView name={tab.icon} size={24} tintColor={colors.white} />
                  </View>
                ) : (
                  <SymbolView name={tab.icon} size={22} tintColor={active ? colors.leaf : colors.faint} />
                )}
                {badge > 0 && (
                  <View className="owner-tab-badge">
                    <Text className="owner-tab-badge__label">{badge > 99 ? "99+" : badge}</Text>
                  </View>
                )}
              </View>
              <Text className={active ? "tabbar__label tabbar__label--active" : "tabbar__label"} style={narrow ? { fontSize: 10, lineHeight: 12 } : undefined} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}
