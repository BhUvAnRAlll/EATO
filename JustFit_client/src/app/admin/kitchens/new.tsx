import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { KitchenForm } from "@/components/admin/KitchenForm";
import { useGymSave } from "@/lib/gymForm";
import { kitchensApi, type Kitchen } from "@/lib/kitchensApi";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/kitchens"));

// Super Admin › Kitchens › Add kitchen (the form is components/admin/KitchenForm). A new kitchen
// starts Active; the server checks everything again. Opens the kitchen's page once saved.
export default function AdminNewKitchen() {
  const { busy, error, save } = useGymSave<{ kitchen: Kitchen }>(
    (data) => router.replace({ pathname: "/admin/kitchens/[id]", params: { id: String(data.kitchen.id) } }),
    "Kitchen added",
  );
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Add kitchen" onBack={back} />
        <KitchenForm busy={busy} error={error} saveLabel="Save kitchen" onSave={(input) => save((token) => kitchensApi.create(token, input))} />
      </SafeAreaView>
    </View>
  );
}
