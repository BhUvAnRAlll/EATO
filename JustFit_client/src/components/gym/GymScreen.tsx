import type { ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type RefreshControlProps } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { useThemeColors } from "@/theme";

type GymScreenProps = {
  title: string;
  children: ReactNode;
  // Shown right of the title (a small action)
  right?: ReactNode;
  // false: the children scroll themselves (a list)
  scroll?: boolean;
  // Kept at the bottom right over the content (the round + button)
  floating?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
};

const back = () => (router.canGoBack() ? router.back() : router.replace("/gym"));

// A gym admin screen under the tabs: back, the title, then the content on the white page
export function GymScreen({ title, children, right, scroll = true, refreshControl, floating }: GymScreenProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <PressableScale onPress={back} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Back">
            <GymIcon name="chevron-left" size={17} color={colors.gymInk} />
          </PressableScale>
          <Text className="gym-header__name flex-1" numberOfLines={1} accessibilityRole="header">{title}</Text>
          {right}
        </View>
        {scroll ? (
          // The keyboard pushes the content up on iOS (Android resizes the window itself), so a
          // field low on a form and the Save under it stay in view; room is left under the content
          // for the round + button, which otherwise covered the last row's ⋯ (QA 2026-11-07)
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: floating ? 96 + insets.bottom : 48, gap: 16 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              showsVerticalScrollIndicator={false}
              refreshControl={refreshControl}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          children
        )}
        {floating ? <View className="absolute" style={{ right: 16, bottom: 16 + insets.bottom }}>{floating}</View> : null}
      </SafeAreaView>
    </View>
  );
}
