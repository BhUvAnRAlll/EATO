import { useCallback } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { KitchenForm } from "@/components/admin/KitchenForm";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { useGymSave } from "@/lib/gymForm";
import { kitchensApi } from "@/lib/kitchensApi";
import { useGymData } from "@/lib/useGymData";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/kitchens"));

// Super Admin › Kitchens › a kitchen › Edit: every detail, its hours, pincodes and capacity
export default function AdminEditKitchen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string | null) => kitchensApi.get(token, Number(id)), [id]);
  const { result, retry } = useGymData(load);
  const { busy, error, save } = useGymSave(() => back(), "Kitchen saved");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Edit kitchen" onBack={back} />
        {result.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the kitchen" /></View>}
        {result.state === "failed" && (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the kitchen" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
          </View>
        )}
        {result.state === "ready" && (
          <KitchenForm kitchen={result.data.kitchen} busy={busy} error={error} saveLabel="Save changes" onSave={(input) => save((token) => kitchensApi.update(token, result.data.kitchen.id, input))} />
        )}
      </SafeAreaView>
    </View>
  );
}
