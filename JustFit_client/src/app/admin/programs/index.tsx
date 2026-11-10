import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, PLACE_TEXT } from "@/lib/adminPrograms";
import { SECTION_ORDER, SECTION_TITLE } from "@/lib/fitness/catalog";
import { LEVEL_TEXT, programMeta, type ProgramCardData } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import { useAdminSections } from "@/lib/useAdminSections";
import { useThemeColors } from "@/theme";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; programs: ProgramCardData[] };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/profile"));

// Super Admin › Programs: every program on the members' Fitness tab, by category in the admin's
// order, with whether it's shown. A program opens to edit it, hide it or have the AI rewrite its
// sessions; New program writes one with the AI; Categories adds, edits and orders the categories.
// Every program is free.
export default function AdminProgramsScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const sections = useAdminSections();

  const refresh = useCallback(async () => {
    const result = await adminPrograms.list(await getToken().catch(() => null));
    setLoad(result.ok ? { state: "ready", programs: result.data.programs } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Programs" onBack={back} />

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <Pressable onPress={() => router.push("/admin/programs/new")} className="btn-forest flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="New program, written with AI">
            <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.onPrimary} />
            <Text className="btn-forest__label">New program</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/admin/categories")} className="btn-outline flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="Categories">
            <SymbolView name={{ ios: "square.grid.2x2", android: "category", web: "category" }} size={16} tintColor={colors.forestInk} />
            <Text className="btn-outline__label">Categories</Text>
          </Pressable>

          {load.state === "loading" ? (
            <ScreenSkeleton label="Loading programs" />
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load programs" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : load.programs.length === 0 ? (
            <DashedBlock icon={{ ios: "figure.run", android: "directions_run", web: "directions_run" }} title="No programs yet" text="Tap New program to write the first one for the Fitness tab." onPress={() => router.push("/admin/programs/new")} />
          ) : (
            (sections ?? SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLE[id], published: true }))).map((section) => {
              const items = load.programs.filter((p) => p.section === section.id);
              if (items.length === 0) return null;
              return (
                <View key={section.id} className="gap-2">
                  <Text className="admin-section__title">{section.published ? section.title : `${section.title} · hidden`}</Text>
                  <View className="admin-list">
                    {items.map((p, i) => (
                      <Pressable
                        key={p.id}
                        onPress={() => router.push({ pathname: "/admin/programs/[id]", params: { id: p.id } })}
                        className={i > 0 ? "admin-row admin-row--divided" : "admin-row"}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.title}, ${PLACE_TEXT[p.place]}, ${p.published ? "shown" : "hidden"}. Open`}
                      >
                        <View className="overflow-hidden" style={{ width: 40, height: 40, borderRadius: 12 }}>
                          <ProgramArt palette={p.palette} icon={p.icon} iconSize={16} id={`admin-${p.id}`} coverUrl={p.coverUrl} />
                        </View>
                        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                          <Text className="card__title" numberOfLines={1}>{p.title}</Text>
                          <Text className="meta-text" numberOfLines={1}>{`${PLACE_TEXT[p.place]} · ${LEVEL_TEXT[p.level]} · ${programMeta(p)}`}</Text>
                        </View>
                        {!p.published && <View className="badge badge--pending"><Text className="badge__label badge__label--pending">Hidden</Text></View>}
                        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
