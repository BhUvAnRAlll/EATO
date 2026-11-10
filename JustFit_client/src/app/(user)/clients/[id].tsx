import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { ClientTag } from "@/components/trainer/ClientTag";
import { initialsOf, shortDate } from "@/data/gymDashboard";
import { STATUS_TEXT, clockTime, dayOf, durationText } from "@/lib/attendanceText";
import { callPhone, whatsappPhone } from "@/lib/gymContact";
import { useSessionToken } from "@/lib/session";
import { trainerApi, type TrainerClientDetail } from "@/lib/trainerApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

// My Clients › a client (gym trainers only): their PT package and dates, their last 10 gym visits,
// and Call or WhatsApp in the phone's own apps. The server answers only for the trainer's own
// clients; nothing about money is shown or sent.
export default function TrainerClientScreen() {
  const trainer = useAuthStore((state) => state.user?.role === "trainer");
  return trainer ? <ClientPage /> : <Redirect href="/home" />;
}

function ClientPage() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<{ status: "loading" } | { status: "failed"; error: string } | { status: "ready"; data: TrainerClientDetail }>({ status: "loading" });

  const load = useCallback(async () => {
    const answer = await trainerApi.client(await getToken().catch(() => null), Number(id));
    setState((current) => (answer.ok ? { status: "ready", data: answer.data } : current.status === "ready" ? current : { status: "failed", error: answer.error }));
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const back = () => (router.canGoBack() ? router.back() : router.replace("/clients"));
  const contact = (label: string, icon: Icon, onPress: () => void) => (
    <Pressable onPress={onPress} className="btn-outline flex-1 flex-row" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={18} tintColor={colors.leaf} />
      <Text className="btn-outline__label">{label}</Text>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={state.status === "ready" ? state.data.client.name : "Client"} onBack={back} />

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false}>
          {state.status === "loading" && <ScreenSkeleton label="Loading your client" />}
          {state.status === "failed" && (
            <View style={{ gap: 12 }}>
              <FormAlert message={state.error} />
              <PrimaryButton label="Try again" onPress={() => { setState({ status: "loading" }); load(); }} />
            </View>
          )}
          {state.status === "ready" && (() => {
            const { client, visits } = state.data;
            return (
              <>
                <View className="card items-center" style={{ gap: 8 }}>
                  <View className="home__avatar overflow-hidden" style={{ width: 72, height: 72 }}>
                    <Text className="home__avatar-label" style={{ fontSize: 22, lineHeight: 28 }}>{initialsOf(client.name)}</Text>
                    <MemberPhotoImage url={client.photoUrl} />
                  </View>
                  <Text className="card__title text-center">{client.name}</Text>
                  <Text className="meta-text text-center">{`${client.code} · ${client.branch} branch`}</Text>
                  {client.inToday && <Text className="client-tag__label" style={{ color: colors.success }}>✓ Checked in today</Text>}
                </View>

                <View className="card" style={{ gap: 10 }}>
                  <Text className="type-overline text-muted">Personal training</Text>
                  <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
                    <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                      <Text className="type-subhead text-ink">{client.pt.label}</Text>
                      <Text className="meta-text">{`${shortDate(client.pt.from)} – ${shortDate(client.pt.until)}`}</Text>
                    </View>
                    <ClientTag client={client} />
                  </View>
                </View>

                <View className="flex-row" style={{ gap: 12 }}>
                  {contact("Call", { ios: "phone", android: "call", web: "call" }, () => callPhone(client.phone))}
                  {contact("WhatsApp", { ios: "message", android: "chat", web: "chat" }, () => whatsappPhone(client.phone, `Hi ${client.name.split(" ")[0]}, `))}
                </View>

                {/* Their day of meals, with justFit meals to order (2026-11-10) */}
                <Pressable onPress={() => router.push({ pathname: "/clients/diet/[id]", params: { id: String(client.id) } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`Diet plan for ${client.name}`}>
                  <View className="macro__thumb" style={{ backgroundColor: colors.accentSoft }}>
                    <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={20} tintColor={colors.leaf} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="card__title">Diet plan</Text>
                    <Text className="meta-text">Their meals for the day, with justFit meals they can order</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.faint} />
                </Pressable>

                <View className="card" style={{ gap: 12 }}>
                  <Text className="type-overline text-muted">Recent visits</Text>
                  {visits.length === 0 ? (
                    <Text className="meta-text">No gym visits yet.</Text>
                  ) : (
                    visits.map((v) => (
                      <View key={v.inAt} className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${dayOf(v.inAt)}, in ${clockTime(v.inAt)}${v.outAt ? `, out ${clockTime(v.outAt)}` : ""}, ${STATUS_TEXT[v.status]}`}>
                        <View className="min-w-0 flex-1">
                          <Text className="type-body text-ink">{dayOf(v.inAt)}</Text>
                          <Text className="meta-text">{`${clockTime(v.inAt)}${v.outAt ? ` – ${clockTime(v.outAt)}` : ""}`}</Text>
                        </View>
                        <Text className="meta-text">{v.status === "completed" ? durationText(v.durationMin) : STATUS_TEXT[v.status]}</Text>
                      </View>
                    ))
                  )}
                </View>
              </>
            );
          })()}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
