import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { rupees } from "@/data/gymDashboard";
import { LIST_FILTERS, STATUS_TONE, adminReviewApi, type GymListFilter } from "@/lib/gymRegistration";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Super Admin › Gyms: every gym's branches on justFit with today's takings, members and check-ins.
// A branch opens its page (money, dues, attendance, staff, other branches); New gym creates one.
// Since gym registration (2026-11-09) each branch shows its approval state, filtered by the chips;
// gyms waiting for review come first.
export default function AdminGyms() {
  const colors = useThemeColors();
  const [filter, setFilter] = useState<GymListFilter>("all");
  const load = useCallback((token: string | null) => adminReviewApi.list(token, filter), [filter]);
  const { result, retry, refreshing, refresh } = useGymData(load);
  const counts = result.state === "ready" ? result.data.counts : null;
  const toneClass = { neutral: "text-muted", good: "text-success", warn: "text-warning", bad: "text-danger" } as const;
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
          {counts ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {LIST_FILTERS.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    haptic.select();
                    setFilter(f.id);
                  }}
                  className={filter === f.id ? "admin-chip admin-chip--on" : "admin-chip"}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f.id }}
                >
                  <Text className="type-caption text-ink">{`${f.label} · ${counts[f.id] ?? 0}`}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View className="px-4" style={{ gap: 12 }}>
            {result.state === "loading" && <ScreenSkeleton label="Loading gyms" />}
            {result.state === "failed" && (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load gyms" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
            )}
            {result.state === "ready" &&
              (result.data.gyms.length === 0 ? (
                filter === "all" ? (
                  <DashedBlock icon={{ ios: "building.2", android: "apartment", web: "apartment" }} title="No gyms yet" text="Create a gym, then link its gym admin's account to it." onPress={() => router.push("/admin/gyms/new")} />
                ) : (
                  <DashedBlock icon={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} title="Nothing here" text="No gym is in this state right now." onPress={() => setFilter("all")} />
                )
              ) : (
                <View className="admin-list">
                  {result.data.gyms.map((g, i) => (
                    <Pressable
                      key={g.id}
                      onPress={() => router.push({ pathname: "/admin/gyms/[id]", params: { id: String(g.id) } })}
                      className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name}${g.status && g.status !== "approved" ? `, ${g.statusLabel}` : ""}, ${g.branch} branch, ${g.area}, ${g.city}. ${rupees(g.revenueToday)} today, ${g.members} members, ${g.attendanceToday} in today`}
                    >
                      <View className="admin-row__icon">
                        <SymbolView name={{ ios: "building.2", android: "apartment", web: "apartment" }} size={18} tintColor={colors.forestInk} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                          <Text className="card__title shrink" numberOfLines={1}>{g.name}</Text>
                          {g.status && g.status !== "approved" ? <Text className={`type-caption ${toneClass[STATUS_TONE[g.status]]}`}>{g.statusLabel}</Text> : null}
                        </View>
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
