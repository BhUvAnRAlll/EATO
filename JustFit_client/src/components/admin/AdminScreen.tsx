import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { useThemeColors } from "@/theme";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { AdminTabHeader } from "@/components/admin/AdminTabHeader";

type AdminScreenProps = {
  title: string;
  subtitle?: string;
  // Small control on the right of the header (e.g. a "New" button); on a tab root, the row of actions under the title
  headerRight?: ReactNode;
  // Reads the screen's data again when it is pulled down (screens that only show a form leave it out)
  onRefresh?: () => Promise<unknown>;
  // A tab root has no back arrow, and its bottom edge is the tab bar's (no safe-area inset there)
  hideBack?: boolean;
  children: ReactNode;
};

const none = async () => {};

// Shared frame for the admin screens: a stack screen's circled back button and centred title (a
// tab root's eyebrow and large title instead), then the scrolling content (pull to refresh with onRefresh)
export function AdminScreen({ title, subtitle, headerRight, onRefresh, hideBack = false, children }: AdminScreenProps) {
  const colors = useThemeColors();
  const { refreshControl } = usePullToRefresh(onRefresh ?? none);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={hideBack ? ["top", "left", "right"] : undefined}>
        {hideBack ? (
          // A tab root: the shared tab header (title, bell, profile), headerRight as its actions row
          <AdminTabHeader title={title} actions={headerRight} />
        ) : (
          // A stack screen: the circled back button and a centred title
          <View className="screen-bar">
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin"))} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
              <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
            </Pressable>
            <Text className="screen-bar__title" numberOfLines={2} accessibilityRole="header">{title}</Text>
            {headerRight ?? <View className="screen-bar__spacer" />}
          </View>
        )}

        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: hideBack ? 110 : 32 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            refreshControl={onRefresh ? refreshControl : undefined}
          >
            {subtitle && <Text className="auth__subtitle mb-4">{subtitle}</Text>}
            {children}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}

type AdminButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  // Shares a row equally with its neighbours (a card's line of actions)
  grow?: boolean;
};

// Whole class strings per variant: Tailwind only generates classes it can read in the source
const buttonClass = {
  default: "admin__action",
  primary: "admin__action admin__action--primary",
  danger: "admin__action admin__action--danger",
};
const buttonLabelClass = {
  default: "admin__action-label",
  primary: "admin__action-label admin__action-label--primary",
  danger: "admin__action-label admin__action-label--danger",
};

// Small pill action used in the admin lists and forms. Disabled, every variant looks the same:
// a light grey fill with faint text (btn--disabled), like the app's other disabled buttons
export function AdminButton({ label, onPress, variant = "default", disabled = false, grow = false }: AdminButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={disabled ? "admin__action admin__action--disabled" : buttonClass[variant]}
      style={grow ? { flex: 1, paddingHorizontal: 6 } : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text className={disabled ? "admin__action-label btn--disabled-label" : buttonLabelClass[variant]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
