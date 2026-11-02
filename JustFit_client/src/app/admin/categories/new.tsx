import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { CategoryForm } from "@/components/admin/CategoryForm";
import { SymbolView } from "@/components/SymbolView";
import { adminPrograms, type SectionFields } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/categories"));

const BLANK: SectionFields = { title: "", note: "", layout: "tile", published: true };

// Super Admin › Programs › Categories › New category: a name, the line under it and how its cards
// look. It goes at the end of the list; programs are put in it from their own screen (Category).
export default function NewCategoryScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [form, setForm] = useState<SectionFields>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (form.title.trim().length < 2) return setError("Give the category a name of at least 2 characters.");
    setBusy(true);
    setError(null);
    const result = await adminPrograms.createSection(await getToken().catch(() => null), form);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    back();
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">New category</Text>
          <View className="screen-bar__spacer" />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
          <CategoryForm value={form} onChange={setForm} disabled={busy} />
          {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}
          <Pressable onPress={create} disabled={busy} className="btn-forest flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Create category" accessibilityState={{ disabled: busy }}>
            {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className="btn-forest__label">Create category</Text>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
