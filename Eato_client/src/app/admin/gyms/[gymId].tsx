import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymStatusPill } from "@/components/admin/GymStatusPill";
import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPortal, gymInitials, type AdminGym, type GymPlan } from "@/lib/adminPortal";
import { plans } from "@/lib/gymRules";
import { longDate } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// Super Admin › a gym: its numbers, owner and plan, a way into its Gym Manager and its public
// page, and suspension (it leaves Explore and its posts are hidden; Reinstate undoes it).
// Plan changes are recorded only: no payment is taken.

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"));

export default function AdminGymDetail() {
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<AdminGym | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const result = await adminPortal.gym(await getToken().catch(() => null), gymId);
    if (result.ok) {
      setGym(result.data.gym);
      setError(null);
    } else setError(result.error);
  }, [getToken, gymId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const changePlan = async (plan: GymPlan) => {
    if (!gym || busy || plan === gym.plan) return;
    setBusy(true);
    setActionError(null);
    const result = await adminPortal.setGymPlan(await getToken().catch(() => null), gym.id, plan);
    setBusy(false);
    if (!result.ok) return setActionError(result.error);
    setGym({ ...gym, plan });
  };

  const setSuspended = async (suspended: boolean) => {
    if (!gym || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await adminPortal.setGymSuspended(await getToken().catch(() => null), gym.id, suspended);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setActionError(result.error);
    setGym({ ...gym, status: result.data.status });
  };

  const visibility = gym ? { public: "public", private: "private", hidden: "hidden" }[gym.visibility] : "";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1}>{gym?.name ?? "Gym"}</Text>
            {gym?.location && <Text className="gym-card__meta" numberOfLines={1}>{gym.location}</Text>}
          </View>
          <View className="screen-bar__back" />
        </View>

        {!gym ? (
          <View className="px-5 pt-6">
            {error ? (
              <DashedBlock icon={{ ios: "building.2", android: "apartment", web: "apartment" }} title="Can't open this gym" text={`${error.replace(/\.$/, "")}. Tap to try again.`} onPress={load} />
            ) : (
              <View className="items-center py-16"><ActivityIndicator color={colors.forest} /></View>
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View className="admin-list flex-row items-center gap-3" style={{ padding: 16 }}>
              <View className="admin-gym-badge" style={{ width: 56, height: 56, borderRadius: 14 }}><Text className="admin-gym-badge__label" style={{ fontSize: 18 }}>{gymInitials(gym.name)}</Text></View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="type-subhead text-forest-ink" numberOfLines={1}>{gym.name}</Text>
                <Text className="post__time">{`Code ${gym.inviteCode} · ${visibility}${gym.memberApproval ? " · approval required" : ""}`}</Text>
                <View className="flex-row flex-wrap items-center gap-2">
                  <GymStatusPill status={gym.status} />
                  {gym.status === "trial" && gym.trialEndsOn && <Text className="post__time">{`Trial ends ${longDate(gym.trialEndsOn)}`}</Text>}
                </View>
              </View>
            </View>

            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {(
                [
                  ["Members", gym.counts.members, { ios: "person.2", android: "group", web: "group" }],
                  ["Staff", gym.counts.staff, { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }],
                  ["Posts", gym.counts.posts, { ios: "photo", android: "image", web: "image" }],
                  ["Upcoming events", gym.counts.upcomingEvents, { ios: "calendar", android: "event", web: "event" }],
                  ["Open reports", gym.counts.openReports, { ios: "flag", android: "flag", web: "flag" }],
                  ["Join requests", gym.counts.joinRequests, { ios: "person.badge.plus", android: "person_add", web: "person_add" }],
                ] as [string, number, Icon][]
              ).map(([label, value, icon]) => (
                <View key={label} className={label === "Open reports" && value > 0 ? "admin-stat admin-stat--danger" : "admin-stat"} accessibilityLabel={`${label}: ${value}`}>
                  <SymbolView name={icon} size={18} tintColor={colors.forestInk} />
                  <Text className="admin-stat__label" numberOfLines={2}>{label}</Text>
                  <Text className="admin-stat__value">{value}</Text>
                </View>
              ))}
            </View>

            {actionError && <FormAlert message={actionError} />}

            <Text className="type-overline text-muted">Owner</Text>
            {gym.owner ? (
              <Pressable
                onPress={() => router.push({ pathname: "/admin/users/[userId]", params: { userId: gym.owner!.id } })}
                className="admin-list admin-row"
                accessibilityRole="button"
                accessibilityLabel={`Owner: ${gym.owner.name}`}
              >
                <Avatar member={{ id: gym.owner.id, name: gym.owner.name, initial: gym.owner.name.charAt(0).toUpperCase() }} size={40} />
                <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{gym.owner.name}</Text>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ) : (
              <Text className="home__note">This gym has no owner.</Text>
            )}

            <Text className="type-overline text-muted">Plan</Text>
            <View className="admin-list" accessibilityRole="radiogroup">
              {plans.map((p, i) => {
                const selected = gym.plan === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => changePlan(p.id)}
                    disabled={busy}
                    className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${p.name} plan, ${p.price}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{`${p.name} · ${p.price}`}</Text>
                      <Text className="post__time">{p.perks}</Text>
                    </View>
                    <View className={selected ? "radio radio--selected" : "radio"}>{selected && <View className="radio__dot" />}</View>
                  </Pressable>
                );
              })}
            </View>
            <Text className="home__note">Plan changes are recorded only. No payment is taken.</Text>

            <Pressable
              onPress={() => {
                useOwnerStore.getState().setGym(gym.id);
                router.push("/owner");
              }}
              className="btn-outline flex-row items-center justify-center gap-2"
              accessibilityRole="button"
              accessibilityLabel={`Open Gym Manager for ${gym.name}`}
            >
              <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={15} tintColor={colors.forestInk} />
              <Text className="btn-outline__label">Gym Manager & attendance</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id: gym.id } })} className="btn-outline flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="Open gym page">
              <SymbolView name={{ ios: "arrow.up.right.square", android: "open_in_new", web: "open_in_new" }} size={15} tintColor={colors.forestInk} />
              <Text className="btn-outline__label">Open gym page</Text>
            </Pressable>

            {gym.status === "suspended" ? (
              <Pressable onPress={() => setSuspended(false)} disabled={busy} className="btn-forest" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Reinstate gym">
                <Text className="btn-forest__label">Reinstate gym</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setConfirming(true)} disabled={busy} className="admin-danger-button" accessibilityRole="button" accessibilityLabel="Suspend gym">
                <SymbolView name={{ ios: "nosign", android: "block", web: "block" }} size={16} tintColor={colors.ink} />
                <Text className="admin-danger-button__label">Suspend gym</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <ConfirmSheet
        visible={confirming}
        title={`Suspend ${gym?.name ?? "this gym"}?`}
        text="It leaves Explore and its posts are hidden from everyone. Members keep their membership, and you can reinstate it at any time."
        confirmLabel="Suspend"
        busy={busy}
        onConfirm={() => setSuspended(true)}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
