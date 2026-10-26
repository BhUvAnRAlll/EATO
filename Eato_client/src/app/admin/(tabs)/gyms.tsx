import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { GymStatusPill } from "@/components/admin/GymStatusPill";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { PLAN_LABEL, adminPortal, gymInitials, type AdminGymRow } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Super Admin › Gyms: every gym (hidden ones too) with members, plan, owner and status, searched
// by name or area. A row opens the gym's admin page; Create gym starts a 14-day trial.

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; gyms: AdminGymRow[] };

export default function AdminGyms() {
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const result = await adminPortal.gyms(await getToken().catch(() => null), query);
    setLoad(result.ok ? { state: "ready", gyms: result.data.gyms } : { state: "failed", error: result.error });
  }, [getToken, query]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View className="pt-2">
            <Text className="type-overline text-muted">JustFit admin</Text>
            <Text className="type-title text-forest-ink">Gyms</Text>
          </View>
          <Pressable onPress={() => router.push("/admin/gyms/new")} className="btn-forest flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="Create gym">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />
            <Text className="btn-forest__label">Create gym</Text>
          </Pressable>
          <View className="search search--pill">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Name or area" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={80} accessibilityLabel="Search gyms" />
          </View>

          {load.state === "loading" ? (
            <View className="items-center py-16"><ActivityIndicator color={colors.forest} /></View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load gyms" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : load.gyms.length === 0 ? (
            <DashedBlock icon={{ ios: "building.2", android: "apartment", web: "apartment" }} title={query ? "Nothing matches" : "No gyms yet"} text={query ? `No gym matches "${query}".` : "Create the first gym and name its owner."} />
          ) : (
            <View className="admin-list">
              {load.gyms.map((g, i) => {
                const detail = [`${g.memberCount} ${g.memberCount === 1 ? "member" : "members"}`, PLAN_LABEL[g.plan], g.owner?.name ?? "No owner"].join(" · ");
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => router.push({ pathname: "/admin/gyms/[gymId]", params: { gymId: g.id } })}
                    className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.name}, ${detail}${g.status === "active" ? "" : `, ${g.status}`}`}
                  >
                    <View className="admin-gym-badge"><Text className="admin-gym-badge__label">{gymInitials(g.name)}</Text></View>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title" numberOfLines={1}>{g.name}</Text>
                      <Text className="post__time" numberOfLines={1}>{detail}</Text>
                    </View>
                    {g.status !== "active" && <GymStatusPill status={g.status} />}
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
