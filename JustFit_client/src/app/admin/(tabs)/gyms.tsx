import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { rupees } from "@/data/gymDashboard";
import { adminGyms } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Super Admin › Gyms: every gym's branches on justFit with today's takings, members and check-ins.
// A branch opens its page (money, dues, attendance, staff, other branches); New gym creates one.
export default function AdminGyms() {
  const colors = useThemeColors();
  const { result, retry, refreshing, refresh } = useGymData(adminGyms.list);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 110, gap: 14 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} progressBackgroundColor={colors.surface} />}
        >
          <View className="flex-row items-end px-4 pt-2">
            <View className="flex-1">
              <Text className="type-overline text-muted">justFit admin</Text>
              <Text className="type-title text-forest-ink">Gyms</Text>
            </View>
            <Pressable onPress={() => router.push("/admin/gyms/new")} className="btn-forest" style={{ minHeight: 40, paddingHorizontal: 16 }} accessibilityRole="button" accessibilityLabel="New gym">
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.onPrimary} />
              <Text className="btn-forest__label">New gym</Text>
            </Pressable>
          </View>
          <View className="px-4" style={{ gap: 12 }}>
            {result.state === "loading" && <ScreenSkeleton label="Loading gyms" />}
            {result.state === "failed" && (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load gyms" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
            )}
            {result.state === "ready" &&
              (result.data.gyms.length === 0 ? (
                <DashedBlock icon={{ ios: "building.2", android: "apartment", web: "apartment" }} title="No gyms yet" text="Create a gym, then link its gym admin's account to it." onPress={() => router.push("/admin/gyms/new")} />
              ) : (
                <View className="admin-list">
                  {result.data.gyms.map((g, i) => (
                    <Pressable
                      key={g.id}
                      onPress={() => router.push({ pathname: "/admin/gyms/[id]", params: { id: String(g.id) } })}
                      className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name}, ${g.branch} branch, ${g.area}, ${g.city}. ${rupees(g.revenueToday)} today, ${g.members} members, ${g.attendanceToday} in today`}
                    >
                      <View className="admin-row__icon">
                        <SymbolView name={{ ios: "building.2", android: "apartment", web: "apartment" }} size={18} tintColor={colors.forestInk} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{g.name}</Text>
                        <Text className="meta-text" numberOfLines={1}>{`${g.branch} branch · ${g.area}, ${g.city}`}</Text>
                        <Text className="meta-text" numberOfLines={1}>{`${rupees(g.revenueToday)} today · ${g.active}/${g.members} active · ${g.attendanceToday} in today${g.staff === 0 ? " · no staff yet" : ""}`}</Text>
                      </View>
                      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                    </Pressable>
                  ))}
                </View>
              ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
