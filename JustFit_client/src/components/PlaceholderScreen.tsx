import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type PlaceholderScreenProps = {
  title: string;
  subtitle: string;
  icon: Icon;
  // Extra content under the message (e.g. the profile's sign-out button)
  children?: ReactNode;
  // Tab screens pass false: the tab bar is the way around, so no back arrow
  showBack?: boolean;
};

// A screen for an area that isn't built yet: title, a friendly note and a way back.
// Tab screens have no back arrow (the tab bar is the way around); pushed screens do.
export function PlaceholderScreen({ title, subtitle, icon, children, showBack = true }: PlaceholderScreenProps) {
  const colors = useThemeColors();
  const canGoBack = showBack && router.canGoBack();

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          {canGoBack ? (
            <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
              <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
            </Pressable>
          ) : (
            <View className="screen-bar__spacer" />
          )}
          <Text className="screen-bar__title">{title}</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <View className="flex-1 items-center justify-center gap-3 py-10">
            <View className="placeholder__icon">
              <SymbolView name={icon} size={30} tintColor={colors.leaf} />
            </View>
            <Text className="setup__title text-center">{title}</Text>
            <Text className="placeholder__text">{subtitle}</Text>
            <View className="badge badge--pending mt-1 self-center">
              <Text className="badge__label badge__label--pending">Coming soon</Text>
            </View>
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
