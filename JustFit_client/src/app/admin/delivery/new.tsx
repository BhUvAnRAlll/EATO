import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PartnerForm } from "@/components/admin/PartnerForm";
import { deliveryApi } from "@/lib/deliveryApi";
import { useGymSave } from "@/lib/gymForm";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/delivery"));

// Super Admin › Delivery › Add partner (Meal Operations phase 4)
export default function AdminNewPartner() {
  const { busy, error, save } = useGymSave(() => back(), "Partner added");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Add delivery partner" onBack={back} />
        <PartnerForm busy={busy} error={error} saveLabel="Save partner" onSave={(input) => save((token) => deliveryApi.add(token, input))} />
      </SafeAreaView>
    </View>
  );
}
