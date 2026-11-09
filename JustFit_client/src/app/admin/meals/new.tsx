import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { MealForm } from "@/components/admin/MealForm";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { kitchenApi } from "@/lib/mealsApi";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));

// Super Admin › Meals › Add Meal (the form is components/admin/MealForm). Members see it on the
// Meals tab once it's saved, unless "Show on the menu" is off. The server checks everything again.
export default function AdminNewMeal() {
  const colors = useThemeColors();
  const { busy, error, save } = useGymSave(() => back(), "Meal added");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Add Meal</Text>
          <View className="screen-bar__spacer" />
        </View>
        <MealForm busy={busy} error={error} saveLabel="Save meal" onSave={(input) => save((token) => kitchenApi.addMeal(token, input))} />
      </SafeAreaView>
    </View>
  );
}
