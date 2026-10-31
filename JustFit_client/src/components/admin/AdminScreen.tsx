import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { colors } from "@/theme";

type AdminScreenProps = {
  title: string;
  subtitle?: string;
  // Small control on the right of the header (e.g. a "New" button)
  headerRight?: ReactNode;
  // Reads the screen's data again when it is pulled down (screens that only show a form leave it out)
  onRefresh?: () => Promise<unknown>;
  children: ReactNode;
};

const none = async () => {};

// Shared frame for the admin screens: back arrow, title, scrolling content (pull to refresh with onRefresh)
export function AdminScreen({ title, subtitle, headerRight, onRefresh, children }: AdminScreenProps) {
  const { refreshControl } = usePullToRefresh(onRefresh ?? none);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>
            {title}
          </Text>
          {headerRight}
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={onRefresh ? refreshControl : undefined}
          >
            {subtitle && <Text className="auth__subtitle mb-4">{subtitle}</Text>}
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

type AdminButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
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

// Small pill action used in the admin lists and forms
export function AdminButton({ label, onPress, variant = "default", disabled = false }: AdminButtonProps) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className={buttonClass[variant]} style={{ opacity: disabled ? 0.5 : 1 }} accessibilityRole="button">
      <Text className={buttonLabelClass[variant]}>{label}</Text>
    </Pressable>
  );
}
