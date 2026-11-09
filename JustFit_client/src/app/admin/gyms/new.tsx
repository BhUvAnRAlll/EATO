import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { SymbolView } from "@/components/SymbolView";
import { AdminField } from "@/components/admin/AdminField";
import { adminGyms } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"));

// Super Admin › Gyms › New gym: its name and its first branch (name, area, city). More branches and
// the gym admins are added on the branch's page.
export default function AdminNewGym() {
  const colors = useThemeColors();
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const { busy, error, save } = useGymSave((data: { gym: { id: number } }) => router.replace({ pathname: "/admin/gyms/[id]", params: { id: String(data.gym.id) } }));
  const ready = [name, branch, area, city].every((v) => v.trim().length >= 2);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">New gym</Text>
          <View className="screen-bar__spacer" />
        </View>
        {/* Keeps the lower fields and Save above the keyboard on Android too */}
        <KeyboardAvoider>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
            <AdminField label="Gym name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Forma" />
            <AdminField label="First branch" value={branch} onChangeText={setBranch} maxLength={80} placeholder="For example: Tumkur" />
            <AdminField label="Area" value={area} onChangeText={setArea} maxLength={80} placeholder="For example: SIT Road" />
            <AdminField label="City" value={city} onChangeText={setCity} maxLength={60} placeholder="For example: Tumakuru" />
            {error ? <FormAlert message={error} /> : null}
            <Pressable onPress={() => save((token) => adminGyms.create(token, { name: name.trim(), branch: branch.trim(), area: area.trim(), city: city.trim() }))} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Create gym">
              {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
              <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>Create gym</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
