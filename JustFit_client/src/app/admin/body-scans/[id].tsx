import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScanDetailView } from "@/components/bodyScan/ScanDetailView";
import { adminScans } from "@/lib/bodyScansApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Super Admin › Body scans › one scan: the member, both photos and the report. Opening the photos
// is written to the admin log (once an hour per admin and scan).
export default function AdminBodyScan() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string | null) => adminScans.one(token, id), [id]);
  const { result, retry, refreshing, refresh } = useGymData(load);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={result.state === "ready" ? result.data.scan.member.name : "Body scan"} fallback="/admin/body-scans" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />} showsVerticalScrollIndicator={false}>
          {result.state === "loading" ? <ScreenSkeleton cards={2} label="Loading the scan" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not open this scan" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" ? (
            <>
              <ScanDetailView scan={result.data.scan} />
              <Pressable onPress={() => router.push({ pathname: "/admin/users/[userId]", params: { userId: result.data.scan.member.id } })} className="btn-outline" accessibilityRole="button">
                <Text className="btn-outline__label">Open the member</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
