import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { homeTabs } from "@/data/home";
import { colors } from "@/theme";

// The floating pill tab bar under the user's screens (see app/(user)/(tabs)/_layout.tsx).
// It replaces the navigator's own bar, so there is never a second one behind it. Tabs come
// from data/home.ts; a route without an entry there isn't shown.
export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Narrow phones: five labels only fit at a smaller size
  const { width } = useWindowDimensions();
  const narrow = width < 360;

  return (
    <View className="bg-cream pt-2" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
      <View className="tabbar" style={narrow ? { marginHorizontal: 8, padding: 4 } : undefined} accessibilityRole="tablist">
        {state.routes.map((route, routeIndex) => {
          const tab = homeTabs.find((candidate) => candidate.name === route.name);
          if (!tab) return null;
          const active = state.index === routeIndex;

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!active && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              className={active ? "tabbar__item tabbar__item--active" : "tabbar__item"}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <SymbolView name={tab.icon} size={22} tintColor={active ? colors.leafDark : colors.muted} />
              <Text className={active ? "tabbar__label tabbar__label--active" : "tabbar__label"} style={narrow ? { fontSize: 10, lineHeight: 12 } : undefined} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
