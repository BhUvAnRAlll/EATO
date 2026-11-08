import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect, router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { initialsOf } from "@/data/gymDashboard";
import { useSessionToken } from "@/lib/session";
import { ClientTag } from "@/components/trainer/ClientTag";
import { ptLeftText, trainerApi, type TrainerClient, type TrainerClients } from "@/lib/trainerApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// A gym trainer's My Clients tab (role "trainer" only; anyone else is sent Home): the gym members
// whose personal training is with them, as the gym admin assigned it. Active PT first (the soonest
// to end first), then PT that ended in the last 30 days. Search by name or member ID. No money.
export default function MyClientsTab() {
  const trainer = useAuthStore((state) => state.user?.role === "trainer");
  return trainer ? <MyClients /> : <Redirect href="/home" />;
}

function MyClients() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [state, setState] = useState<{ status: "loading" } | { status: "failed"; error: string } | { status: "ready"; data: TrainerClients }>({ status: "loading" });
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const answer = await trainerApi.clients(await getToken().catch(() => null));
    setState((current) => (answer.ok ? { status: "ready", data: answer.data } : current.status === "ready" ? current : { status: "failed", error: answer.error }));
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const query = search.trim().toLowerCase();
  const shown = state.status === "ready" ? state.data.clients.filter((c) => !query || c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)) : [];
  const active = shown.filter((c) => c.pt.active);
  const ended = shown.filter((c) => !c.pt.active);

  const row = (c: TrainerClient) => (
    <Pressable
      key={c.id}
      onPress={() => router.push({ pathname: "/clients/[id]", params: { id: String(c.id) } })}
      className="list-card flex-row items-center"
      style={{ gap: 12, opacity: c.pt.active ? 1 : 0.75 }}
      accessibilityRole="button"
      accessibilityLabel={`${c.name}, ${c.code}. ${c.pt.label}, ${ptLeftText(c.pt.daysLeft)}${c.inToday ? ". Checked in today" : ""}`}
    >
      <View className="home__avatar overflow-hidden">
        <Text className="home__avatar-label">{initialsOf(c.name)}</Text>
        <MemberPhotoImage url={c.photoUrl} />
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 4 }}>
        <Text className="type-subhead text-ink" numberOfLines={1}>{c.name}</Text>
        <Text className="meta-text" numberOfLines={1}>{`${c.code} · ${c.pt.label}`}</Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <ClientTag client={c} />
          {c.inToday && <Text className="client-tag__label" style={{ color: colors.success }}>✓ In today</Text>}
        </View>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
    </Pressable>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 2, paddingTop: 8 }}>
            <Text className="type-title text-forest-ink" accessibilityRole="header">My Clients</Text>
            {state.status === "ready" && state.data.gym ? <Text className="meta-text">{`${state.data.gym} · ${state.data.branches.join(", ")}`}</Text> : null}
          </View>

          {state.status === "loading" && <ScreenSkeleton label="Loading your clients" />}
          {state.status === "failed" && (
            <View style={{ gap: 12 }}>
              <FormAlert message={state.error} />
              <PrimaryButton label="Try again" onPress={() => { setState({ status: "loading" }); load(); }} />
            </View>
          )}

          {state.status === "ready" && state.data.clients.length === 0 && (
            <View className="card items-center" style={{ gap: 10 }}>
              <View className="card__icon">
                <SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={24} tintColor={colors.leaf} />
              </View>
              <Text className="card__title text-center">No PT clients yet</Text>
              <Text className="card__subtitle text-center">{"When your gym sells personal training with you as the trainer, the member shows here."}</Text>
            </View>
          )}

          {state.status === "ready" && state.data.clients.length > 0 && (
            <>
              <View className="search search--on-page">
                <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={16} tintColor={colors.faint} />
                <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search by name or member ID" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" maxLength={60} accessibilityLabel="Search clients" />
              </View>
              {shown.length === 0 && <Text className="meta-text text-center">No client matches that search.</Text>}
              {active.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text className="type-overline text-muted" accessibilityRole="header">{`Active PT (${active.length})`}</Text>
                  {active.map(row)}
                </View>
              )}
              {ended.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text className="type-overline text-muted" accessibilityRole="header">{`PT ended, last 30 days (${ended.length})`}</Text>
                  {ended.map(row)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
