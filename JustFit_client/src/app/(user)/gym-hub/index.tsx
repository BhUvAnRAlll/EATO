import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { planProgress } from "@/lib/gymHubText";
import { membershipApi, type Membership, type Memberships } from "@/lib/membershipApi";
import { membershipBadge, planText, prettyDate } from "@/lib/membershipText";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: Memberships };

// Profile › Gym Hub (2026-11-09; it replaced the separate Gym membership and Gym attendance rows):
// check in at the gym, then every membership on this account's number, from any gym. A card opens
// the membership's page (dates, payments, attendance, pauses). /membership and /attendance still
// open as before, so older links and the gym's printed QR code keep working.
export default function GymHub() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });

  const load = useCallback(async () => {
    const answer = await membershipApi.mine(await getToken().catch(() => null));
    setResult((current) => (answer.ok ? { state: "ready", data: answer.data } : current.state === "ready" ? current : { state: "failed", error: answer.error }));
  }, [getToken]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshControl } = usePullToRefresh(load);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Gym Hub" onBack={back} />

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          {/* Check in and out with the gym's QR code (the scanner every gym member uses) */}
          <PressableScale onPress={() => router.push("/attendance")} haptic="tap" className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel="Check in or out at your gym" accessibilityHint="Opens the scanner for the QR code at the gym's entrance">
            <View className="card__icon" style={{ backgroundColor: colors.accentSoft }}>
              <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={22} tintColor={colors.leaf} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="card__title">Check in or out</Text>
              <Text className="card__subtitle">{"Scan the QR code at your gym's entrance"}</Text>
            </View>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
          </PressableScale>

          <Text className="type-headline text-ink" accessibilityRole="header">My Memberships</Text>

          {result.state === "loading" ? (
            <ScreenSkeleton cards={2} label="Loading your memberships" />
          ) : result.state === "failed" ? (
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />
            </View>
          ) : result.data.memberships.length === 0 ? (
            <EmptyState
              icon={{ ios: "person.text.rectangle", android: "badge", web: "badge" }}
              title="No gym membership on this number"
              message="When a gym adds your sign-in number to a membership, it shows here with its dates, visits and payments."
            />
          ) : (
            result.data.memberships.map((m) => <MembershipCard key={m.id} membership={m} today={result.data.today} />)
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// One membership: the gym, its state, the plan's dates with how much is gone, and any money owed
function MembershipCard({ membership: m, today }: { membership: Membership; today: string }) {
  const colors = useThemeColors();
  const badge = membershipBadge(m);
  const gone = planProgress(m.joinedOn, m.expiresOn, today);
  const pending = m.pause?.status === "pending";
  return (
    <PressableScale
      onPress={() => router.push({ pathname: "/gym-hub/[id]", params: { id: String(m.id) } })}
      className="card"
      style={{ gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`${m.gym.name} ${m.gym.branch}. ${planText(m.planLength)} plan, ${badge.label}. Ends ${prettyDate(m.expiresOn)}.${pending ? " Pause requested." : ""}`}
      accessibilityHint="Opens the membership's dates, visits, payments and pauses"
    >
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="card__icon">
          <SymbolView name={{ ios: "building.2", android: "location_city", web: "location_city" }} size={20} tintColor={colors.leaf} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="card__title" numberOfLines={1}>{m.gym.name}</Text>
          <Text className="card__subtitle" numberOfLines={1}>{`${m.gym.branch} · ${m.gym.area}, ${m.gym.city}`}</Text>
        </View>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
      </View>

      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
        <View className={`badge badge--${badge.tone}`}>
          <Text className={`badge__label badge__label--${badge.tone}`}>{badge.label}</Text>
        </View>
        {pending && (
          <View className="badge badge--pending">
            <Text className="badge__label badge__label--pending">Pause requested</Text>
          </View>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <View className="flex-row justify-between" style={{ gap: 8 }}>
          <Text className="type-body text-ink">{`${planText(m.planLength)} plan`}</Text>
          <Text className="type-caption text-muted">{`ID ${m.code}`}</Text>
        </View>
        <View className="progress-stat__track" style={{ flex: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View className="progress-stat__fill" style={{ width: `${Math.round(gone * 100)}%`, backgroundColor: m.status === "expired" ? colors.faint : colors.leaf }} />
        </View>
        <View className="flex-row justify-between" style={{ gap: 8 }}>
          <Text className="type-caption text-muted">{`From ${prettyDate(m.joinedOn)}`}</Text>
          <Text className="type-caption text-muted">{`${m.status === "expired" ? "Ended" : "Ends"} ${prettyDate(m.expiresOn)}`}</Text>
        </View>
      </View>

      {m.due > 0 && <Text className="type-caption" style={{ color: colors.danger }}>{`₹${m.due.toLocaleString("en-IN")} due${m.dueBy ? ` · pay by ${prettyDate(m.dueBy)}` : ""}`}</Text>}
    </PressableScale>
  );
}
