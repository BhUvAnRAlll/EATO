import { useCallback } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { PartnerForm } from "@/components/admin/PartnerForm";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { deliveryApi } from "@/lib/deliveryApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/delivery"));

// Super Admin › Delivery › a partner: every detail (Meal Operations phase 4)
export default function AdminEditPartner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string | null) => deliveryApi.partner(token, Number(id)), [id]);
  const { result, retry } = useGymData(load);
  const { busy, error, save } = useGymSave(() => back(), "Partner saved");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Delivery partner" onBack={back} />
        {result.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the partner" /></View>}
        {result.state === "failed" && (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the partner" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
          </View>
        )}
        {result.state === "ready" && (
          <PartnerForm partner={result.data.partner} busy={busy} error={error} saveLabel="Save changes" onSave={(input) => save((token) => deliveryApi.edit(token, result.data.partner.id, input))} />
        )}
      </SafeAreaView>
    </View>
  );
}
