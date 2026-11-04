import type { ReactElement, ReactNode } from "react";
import { Platform, ScrollView, Text, View, type RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type GymScreenProps = {
  title: string;
  children: ReactNode;
  // Shown right of the title (a small action)
  right?: ReactNode;
  // false: the children scroll themselves (a list)
  scroll?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
};

const back = () => (router.canGoBack() ? router.back() : router.replace("/gym"));

// A gym admin screen under the tabs: back, the title, then the content on the white page
export function GymScreen({ title, children, right, scroll = true, refreshControl }: GymScreenProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <PressableScale onPress={back} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={17} tintColor={colors.gymInk} />
          </PressableScale>
          <Text className="gym-header__name flex-1" numberOfLines={1} accessibilityRole="header">{title}</Text>
          {right}
        </View>
        {scroll ? (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </SafeAreaView>
    </View>
  );
}
