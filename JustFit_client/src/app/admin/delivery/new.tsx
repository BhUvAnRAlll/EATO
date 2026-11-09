import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PartnerForm } from "@/components/admin/PartnerForm";
import { SymbolView } from "@/components/SymbolView";
import { deliveryApi } from "@/lib/deliveryApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/delivery"));

// Super Admin › Delivery › Add partner (Meal Operations phase 4)
export default function AdminNewPartner() {
  const colors = useThemeColors();
  const { busy, error, save } = useGymSave(() => back(), "Partner added");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Add delivery partner</Text>
          <View className="screen-bar__spacer" />
        </View>
        <PartnerForm busy={busy} error={error} saveLabel="Save partner" onSave={(input) => save((token) => deliveryApi.add(token, input))} />
      </SafeAreaView>
    </View>
  );
}
