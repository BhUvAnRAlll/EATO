import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { AdminStackHeader } from "@/components/admin/AdminStackHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { COMPLAINT_STATUSES, complaintsApi } from "@/lib/complaints";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Super Admin › Complaints (the brief's section 7): reports members sent about gyms, the active ones
// first; a row opens the case.
export default function AdminComplaints() {
  const colors = useThemeColors();
  const [status, setStatus] = useState<string>("active");
  const load = useCallback((token: string | null) => complaintsApi.list(token, status), [status]);
  const { result, retry, refreshing, refresh } = useGymData(load);
  const counts = result.state === "ready" ? result.data.counts : null;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <AdminStackHeader title="Complaints" fallback="/admin/profile" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {COMPLAINT_STATUSES.map((s) => (
              <Pressable key={s.id} onPress={() => { haptic.select(); setStatus(s.id); }} className={status === s.id ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: status === s.id }}>
                <Text className="type-caption text-ink">{counts ? `${s.label} · ${counts[s.id]}` : s.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {result.state === "loading" ? <ScreenSkeleton cards={3} label="Loading complaints" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load complaints" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" && result.data.complaints.length === 0 ? <DashedBlock icon={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} title="Nothing here" text="No complaints in this state." onPress={() => setStatus("all")} /> : null}
          {result.state === "ready" && result.data.complaints.length > 0 ? (
            <View className="admin-list">
              {result.data.complaints.map((c, i) => (
                <Pressable key={c.id} onPress={() => router.push({ pathname: "/admin/complaints/[id]", params: { id: String(c.id) } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button" accessibilityLabel={`${c.categoryLabel} at ${c.gym.name} ${c.gym.branch}, ${c.statusLabel}`}>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="card__title" numberOfLines={1}>{`${c.categoryLabel} · ${c.gym.name} ${c.gym.branch}`}</Text>
                    <Text className="meta-text" numberOfLines={2}>{c.preview}</Text>
                    <Text className="meta-text" numberOfLines={1}>{`${c.statusLabel} · by ${c.reporter}${c.assignee ? ` · ${c.assignee} on it` : ""}`}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
