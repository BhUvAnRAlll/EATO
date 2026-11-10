import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { myScans } from "@/lib/bodyScansApi";
import { scanWhen } from "@/lib/bodyScanText";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Profile › My body scans (2026-11-10): every body scan justFit keeps for this member (both photos
// and the report), newest first. A scan opens its photos and report, where it can be deleted.
export default function MyBodyScans() {
  const colors = useThemeColors();
  const load = useCallback((token: string | null) => myScans.list(token), []);
  const { result, retry, refreshing, refresh } = useGymData(load);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="My body scans" subtitle="Your photos and reports. Only you and the justFit team can see them." fallback="/profile" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />} showsVerticalScrollIndicator={false}>
          {result.state === "loading" ? <ScreenSkeleton cards={2} label="Loading your scans" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load your scans" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" && result.data.scans.length === 0 ? (
            <EmptyState icon={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} title="No body scans yet" message="Scan your body from Profile › Body Composition Scan or the AI Coach." />
          ) : null}
          {result.state === "ready" && result.data.scans.length > 0 ? (
            <View className="card py-1">
              {result.data.scans.map((scan, index, list) => (
                <Pressable
                  key={scan.id}
                  onPress={() => router.push({ pathname: "/body-scans/[id]", params: { id: scan.id } })}
                  className="list-row"
                  style={index === list.length - 1 ? { borderBottomWidth: 0 } : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={`${scan.bodyFatPercent}% body fat, ${scanWhen(scan.at)}`}
                >
                  <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={18} tintColor={colors.forestInk} />
                  <View className="flex-1">
                    <Text className="list-row__label">{`${scan.bodyFatPercent}% body fat`}</Text>
                    <Text className="type-caption text-muted">{`${scanWhen(scan.at)} · ${scan.weightKg} kg`}</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
