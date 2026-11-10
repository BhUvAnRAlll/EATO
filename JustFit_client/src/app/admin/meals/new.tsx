import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { MealForm } from "@/components/admin/MealForm";
import { useGymSave } from "@/lib/gymForm";
import { kitchenApi } from "@/lib/mealsApi";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));

// Super Admin › Meals › Add Meal (the form is components/admin/MealForm). Members see it on the
// Meals tab once it's saved, unless "Show on the menu" is off. The server checks everything again.
export default function AdminNewMeal() {
  const { busy, error, save } = useGymSave(() => back(), "Meal added");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Add Meal" onBack={back} />
        <MealForm busy={busy} error={error} saveLabel="Save meal" onSave={(input) => save((token) => kitchenApi.addMeal(token, input))} />
      </SafeAreaView>
    </View>
  );
}
