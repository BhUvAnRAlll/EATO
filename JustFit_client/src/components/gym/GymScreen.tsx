import type { ReactElement, ReactNode } from "react";
import { Platform, ScrollView, Text, View, type RefreshControlProps } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { FAB_CLEARANCE, FloatingSlot, useFabOnScroll } from "@/components/FloatingSlot";
import { useThemeColors } from "@/theme";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

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
  const fab = useFabOnScroll();
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
          // The keyboard pushes the content up on both phones (KeyboardAvoider), so a field low
          // on a form and the Save under it stay in view; room is left under the content
          // for the round + button, which otherwise covered the last row's ⋯ (QA 2026-11-07)
          <KeyboardAvoider>
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: floating ? FAB_CLEARANCE + insets.bottom : 48, gap: 16 }}
              onScroll={floating ? fab.onScroll : undefined}
              scrollEventThrottle={fab.scrollEventThrottle}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              showsVerticalScrollIndicator={false}
              refreshControl={refreshControl}
            >
              {children}
            </ScrollView>
          </KeyboardAvoider>
        ) : (
          children
        )}
        {floating ? <FloatingSlot hidden={fab.hidden} bottom={16 + insets.bottom}>{floating}</FloatingSlot> : null}
      </SafeAreaView>
    </View>
  );
}
