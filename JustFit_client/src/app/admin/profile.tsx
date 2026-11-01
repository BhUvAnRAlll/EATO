import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";
import { AppearanceCard } from "@/components/profile/AppearanceCard";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin"));

// Super Admin › Profile: who is signed in, the admin-only tools (AI Usage) and Sign out
export default function AdminProfile() {
  const colors = useThemeColors();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "justFit admin";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Profile</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View className="admin-list">
            <View className="admin-row">
              <View className="admin-initials">
                <Text className="admin-initials__label">{name.charAt(0).toUpperCase()}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="card__title" numberOfLines={1}>{name}</Text>
                <Text className="meta-text" numberOfLines={1}>{user?.phone ? `Admin · ${user.phone}` : "Admin"}</Text>
              </View>
            </View>
          </View>

          <Text className="setup__section">Tools</Text>
          <View className="admin-list">
            <Pressable onPress={() => router.push("/admin/ai-usage")} className="admin-row" accessibilityRole="button" accessibilityLabel="AI Usage. What the AI features cost">
              <View className="admin-row__icon"><SymbolView name={{ ios: "chart.bar.xaxis", android: "monitoring", web: "monitoring" }} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="card__title">AI Usage</Text>
                <Text className="meta-text">Requests, tokens, cost and the monthly budget</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
            <Pressable onPress={() => router.push("/admin/app-usage")} className="admin-row admin-row--divided" accessibilityRole="button" accessibilityLabel="App Usage. Which features members use">
              <View className="admin-row__icon"><SymbolView name={{ ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" }} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="card__title">App Usage</Text>
                <Text className="meta-text">Which features members use, and how many of them</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
          </View>

          <AppearanceCard />

          <View className="admin-list">
            <Pressable onPress={() => useAuthStore.getState().signOut()} className="admin-row" accessibilityRole="button" accessibilityLabel="Sign out">
              <View className="admin-row__icon"><SymbolView name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} size={18} tintColor={colors.danger} /></View>
              <Text className="card__title flex-1" style={{ color: colors.danger }}>Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
