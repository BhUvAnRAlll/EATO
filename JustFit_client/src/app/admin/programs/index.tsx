import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, PLACE_TEXT } from "@/lib/adminPrograms";
import { SECTION_ORDER, SECTION_TITLE } from "@/lib/fitness/catalog";
import { LEVEL_TEXT, programMeta, type ProgramCardData } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; programs: ProgramCardData[] };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/profile"));

// Super Admin › Programs: every program on the members' Fitness tab, by section, with whether it's
// shown. A program opens to edit it, hide it or have the AI rewrite its sessions; New program
// writes one with the AI. Every program is free.
export default function AdminProgramsScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });

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
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Programs</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <Pressable onPress={() => router.push("/admin/programs/new")} className="btn-forest flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="New program, written with AI">
            <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.onPrimary} />
            <Text className="btn-forest__label">New program</Text>
          </Pressable>

          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.leaf} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load programs" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : (
            SECTION_ORDER.map((section) => {
              const items = load.programs.filter((p) => p.section === section);
              if (items.length === 0) return null;
              return (
                <View key={section} className="gap-2">
                  <Text className="setup__section">{SECTION_TITLE[section]}</Text>
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
                          <ProgramArt palette={p.palette} icon={p.icon} iconSize={16} id={`admin-${p.id}`} />
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
