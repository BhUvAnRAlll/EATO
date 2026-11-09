import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { IconButton } from "@/components/IconButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { membershipApi, type Membership, type Memberships } from "@/lib/membershipApi";
import { historyLine, membershipBadge, pauseLine, planText, prettyDate } from "@/lib/membershipText";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import { confirmChoice } from "@/lib/nativeSheets";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: Memberships };

// Profile › Gym membership: every membership on this account's number (the plan, its dates, dues,
// PT) and Pause Membership (the user's Option A): the member asks for a pause with dates and a
// reason, the gym's staff approve or reject it in their portal, and the answer shows here. An
// approved pause adds its days to the plan and keeps QR check-ins off until it ends.
export default function GymMembership() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  const [cancelError, setCancelError] = useState<{ id: number; error: string } | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const load = useCallback(async () => {
    const answer = await membershipApi.mine(await getToken().catch(() => null));
    setResult(answer.ok ? { state: "ready", data: answer.data } : { state: "failed", error: answer.error });
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshControl } = usePullToRefresh(load);

  // Takes back a request the gym hasn't answered yet
  const cancel = async (m: Membership) => {
    if (!m.pause || cancelling) return;
    setCancelling(m.id);
    setCancelError(null);
    const answer = await membershipApi.cancelPause(await getToken().catch(() => null), m.id, m.pause.id);
    setCancelling(null);
    if (!answer.ok) return setCancelError({ id: m.id, error: answer.error });
    hud.success("Request cancelled");
    setResult((current) => (current.state === "ready" ? { state: "ready", data: { ...current.data, memberships: current.data.memberships.map((x) => (x.id === m.id ? answer.data : x)) } } : current));
  };
  const confirmCancel = (m: Membership) => {
    const question = "Cancel your pause request?";
    confirmChoice({ title: question, message: "You can send a new one any time.", confirmLabel: "Cancel request", cancelLabel: "Keep it" }).then((ok) => {
      if (ok) cancel(m);
    });
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="flex-row items-center px-4 py-2" style={{ gap: 12 }}>
          <IconButton icon={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} label="Back" onPress={back} />
          <Text className="type-title flex-1" accessibilityRole="header">Gym membership</Text>
        </View>

        {result.state === "loading" ? (
          <ScreenSkeleton cards={2} label="Loading your membership" />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
            {result.state === "failed" && (
              <View className="card" style={{ gap: 12 }}>
                <FormAlert message={result.error} />
                <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />
              </View>
            )}

            {result.state === "ready" && result.data.memberships.length === 0 && (
              <View className="card items-center" style={{ gap: 12 }}>
                <View className="card__icon">
                  <SymbolView name={{ ios: "person.text.rectangle", android: "badge", web: "badge" }} size={24} tintColor={colors.leaf} />
                </View>
                <Text className="card__title text-center">No gym membership on this number</Text>
                <Text className="card__subtitle text-center">{"When your gym adds your sign-in number to your membership, it shows here with its dates, and you can ask to pause it."}</Text>
              </View>
            )}

            {result.state === "ready" &&
              result.data.memberships.map((m) => {
                const badge = membershipBadge(m);
                return (
                  <View key={m.id} className="card" style={{ gap: 14 }} accessibilityLabel={`${m.gym.name} ${m.gym.branch}, ${badge.label}`}>
                    <View className="flex-row items-center" style={{ gap: 12 }}>
                      <View className="card__icon">
                        <SymbolView name={{ ios: "building.2", android: "location_city", web: "location_city" }} size={20} tintColor={colors.leaf} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{m.gym.name}</Text>
                        <Text className="card__subtitle" numberOfLines={1}>{`${m.gym.branch} · ${m.gym.area}, ${m.gym.city}`}</Text>
                      </View>
                    </View>
                    <View className={`badge badge--${badge.tone}`}>
                      <Text className={`badge__label badge__label--${badge.tone}`}>{badge.label}</Text>
                    </View>

                    {/* The plan */}
                    <View style={{ gap: 4 }}>
                      <Text className="type-caption text-muted">{`Member ID ${m.code}`}</Text>
                      <Text className="type-body text-ink">{`${planText(m.planLength)} plan · ${prettyDate(m.joinedOn)} to ${prettyDate(m.expiresOn)}`}</Text>
                      {m.due > 0 && <Text className="type-caption" style={{ color: colors.danger }}>{`₹${m.due.toLocaleString("en-IN")} due${m.dueBy ? ` · pay by ${prettyDate(m.dueBy)}` : ""}`}</Text>}
                      {m.pt && <Text className="type-caption text-muted">{`PT · ${m.pt.label} · ${prettyDate(m.pt.from)} to ${prettyDate(m.pt.until)}${m.pt.active ? "" : " (ended)"}`}</Text>}
                    </View>

                    {/* Pause Membership: the open pause, or the button */}
                    {m.pause ? (
                      <View className="rounded-md bg-cream-deep p-3" style={{ gap: 8 }}>
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                          <SymbolView name={{ ios: "pause.circle", android: "pause_circle", web: "pause_circle" }} size={18} tintColor={colors.leaf} />
                          <Text className="type-body text-ink flex-1">{pauseLine(m.pause, m.gym.name, result.data.today)}</Text>
                        </View>
                        <Text className="type-caption text-muted">{`Reason: ${m.pause.reason}`}</Text>
                        {m.pause.status === "pending" && (
                          <Pressable onPress={() => confirmCancel(m)} disabled={cancelling === m.id} accessibilityRole="button" hitSlop={8} className="self-start">
                            <Text className="auth__note-link">{cancelling === m.id ? "Cancelling…" : "Cancel request"}</Text>
                          </Pressable>
                        )}
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
                        <PrimaryButton label="Pause Membership" onPress={() => router.push({ pathname: "/membership/pause", params: { id: String(m.id) } })} disabled={!m.canPause} />
                        <Text className="type-caption text-muted text-center">
                          {m.pauseProblem ?? `Going away? Pause for up to ${m.limits.maxDays} days. The gym approves it, and the days are added to your plan.`}
                        </Text>
                      </View>
                    )}
                    {cancelError?.id === m.id && cancelling === null && m.pause?.status === "pending" && <FormAlert message={cancelError.error} />}

                    {/* Earlier pauses and answers */}
                    {m.history.filter((p) => p.id !== m.pause?.id).length > 0 && (
                      <View style={{ gap: 6 }}>
                        <Text className="type-caption text-muted">Earlier</Text>
                        {m.history.filter((p) => p.id !== m.pause?.id).map((p) => (
                          <Text key={p.id} className="type-caption text-ink">{historyLine(p)}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
