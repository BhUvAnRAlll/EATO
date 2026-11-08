import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, LAYOUT_TEXT, type AdminSection } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; sections: AdminSection[] };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/programs"));

// Super Admin › Programs › Categories: the Fitness tab's categories in the order members see them.
// The arrows move one up or down; a category opens to rename it, change its cards, hide it, or
// delete it (only one the admin made, once it has no programs); New category adds one at the end.
export default function AdminCategoriesScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await adminPrograms.sections(await getToken().catch(() => null));
    setLoad(result.ok ? { state: "ready", sections: result.data.sections } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  const move = async (section: AdminSection, direction: "up" | "down") => {
    setMoving(section.id);
    setError(null);
    const result = await adminPrograms.moveSection(await getToken().catch(() => null), section.id, direction);
    setMoving(null);
    if (result.ok) setLoad({ state: "ready", sections: result.data.sections });
    else setError(result.error);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Categories</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <Pressable onPress={() => router.push("/admin/categories/new")} className="btn-forest flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="New category">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.onPrimary} />
            <Text className="btn-forest__label">New category</Text>
          </Pressable>
          {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}

          {load.state === "loading" ? (
            <ScreenSkeleton label="Loading categories" />
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load categories" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : (
            <View className="admin-list">
              {load.sections.map((s, i) => (
                <View key={s.id} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"}>
                  <Pressable
                    onPress={() => router.push({ pathname: "/admin/categories/[id]", params: { id: s.id } })}
                    className="min-w-0 flex-1 flex-row items-center"
                    style={{ gap: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.title}, ${s.programCount} ${s.programCount === 1 ? "program" : "programs"}, ${s.published ? "shown" : "hidden"}. Open`}
                  >
                    <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                      <Text className="card__title" numberOfLines={1}>{s.title}</Text>
                      <Text className="meta-text" numberOfLines={1}>{`${s.programCount} ${s.programCount === 1 ? "program" : "programs"} · ${LAYOUT_TEXT[s.layout]}${s.builtIn ? " · Built in" : ""}`}</Text>
                    </View>
                    {!s.published && <View className="badge badge--pending"><Text className="badge__label badge__label--pending">Hidden</Text></View>}
                  </Pressable>
                  {moving === s.id ? <ActivityIndicator color={colors.leaf} /> : (
                    <View className="flex-row" style={{ gap: 4 }}>
                      <Pressable onPress={() => move(s, "up")} disabled={i === 0 || moving !== null} hitSlop={6} style={{ opacity: i === 0 ? 0.3 : 1, padding: 6 }} accessibilityRole="button" accessibilityLabel={`Move ${s.title} up`} accessibilityState={{ disabled: i === 0 }}>
                        <SymbolView name={{ ios: "chevron.up", android: "keyboard_arrow_up", web: "keyboard_arrow_up" }} size={16} tintColor={colors.forestInk} />
                      </Pressable>
                      <Pressable onPress={() => move(s, "down")} disabled={i === load.sections.length - 1 || moving !== null} hitSlop={6} style={{ opacity: i === load.sections.length - 1 ? 0.3 : 1, padding: 6 }} accessibilityRole="button" accessibilityLabel={`Move ${s.title} down`} accessibilityState={{ disabled: i === load.sections.length - 1 }}>
                        <SymbolView name={{ ios: "chevron.down", android: "keyboard_arrow_down", web: "keyboard_arrow_down" }} size={16} tintColor={colors.forestInk} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
          <Text className="admin__hint">{"Members see the categories in this order. A category with no programs for their place isn't shown."}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
