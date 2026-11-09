import { useCallback, useState } from "react";
import { FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { initialsOf, shortDate } from "@/data/gymDashboard";
import { gymApi, type PauseRequest, type PauseStatus, type PauseView } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useCenteredChip } from "@/lib/useCenteredChip";
import { listPerf } from "@/lib/listPerf";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const VIEWS: { id: PauseView; label: string }[] = [
  { id: "pending", label: "Waiting" },
  { id: "all", label: "All" },
];
const STATUS_TEXT: Record<PauseStatus, string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled by member" };
const WHO: Record<PauseRequest["by"], string> = { member: "From the app", staff: "By staff" };

// Gym admin › Pause requests (Home › Needs attention, the user's Option A): members' requests to
// pause their plan, from the justFit app, waiting for an answer. Approve adds the pause's days to
// the plan's end and keeps the member's QR check-ins off while it runs; Reject leaves the plan as
// it is. Each tap asks once more on the card itself before it counts.
export default function PauseRequests() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<PauseView>(params.view === "all" ? "all" : "pending");
  // The selected chip stays in view (lib/useCenteredChip.ts)
  const { setRow, onRowLayout, onChipLayout } = useCenteredChip(view);
  // The card whose Approve or Reject is waiting for a second tap
  const [deciding, setDeciding] = useState<{ id: number; approve: boolean } | null>(null);
  const load = useCallback((token: string | null) => gymApi.pauses(token, view), [view]);
  const { result, retry, update, refreshing, refresh } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;
  // The answer is applied to whatever the list shows then (a pull to refresh may have replaced
  // the one the tap saw), so nothing older is written back (QA 2026-11-07)
  const { busy, error, save } = useGymSave(({ pause }: { pause: PauseRequest }) => {
    setDeciding(null);
    update((current) => ({
      ...current,
      pauses: view === "pending" ? current.pauses.filter((p) => p.id !== pause.id) : current.pauses.map((p) => (p.id === pause.id ? pause : p)),
      counts: { pending: Math.max(0, current.counts.pending - 1) },
    }));
  });

  const decide = (pause: PauseRequest, approve: boolean) => {
    if (busy) return;
    if (deciding?.id !== pause.id || deciding.approve !== approve) {
      haptic.select();
      return setDeciding({ id: pause.id, approve });
    }
    save((token) => (approve ? gymApi.approvePause(token, pause.id) : gymApi.rejectPause(token, pause.id)));
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <Text className="gym-tx__meta">{"Approving adds the paused days to the member's plan and keeps QR check-ins off while it runs. The member sees your answer in the app."}</Text>
      <ScrollView ref={setRow} onLayout={onRowLayout} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
        {VIEWS.map((v) => {
          const selected = v.id === view;
          const count = data && v.id === "pending" ? data.counts.pending : undefined;
          return (
            <PressableScale key={v.id} onLayout={onChipLayout(v.id)} onPress={() => { if (!selected) haptic.select(); setDeciding(null); setView(v.id); }} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${v.label}${count !== undefined ? `, ${count}` : ""}`}>
              {selected && <GradientFill radius={999} />}
              <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{count !== undefined ? `${v.label} · ${count}` : v.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      {error ? <FormAlert message={error} /> : null}
    </View>
  );

  const statusColor = (status: PauseStatus) => (status === "approved" ? colors.gymSuccess : status === "rejected" ? colors.gymDanger : status === "pending" ? colors.gymWarning : colors.gymFaint);

  return (
    <GymScreen title="Pause requests" scroll={false}>
      <FlatList
        {...listPerf}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}
        data={data?.pauses ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading pause requests" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : view === "pending" ? (
            <GymEmpty icon="circle-pause" title="No requests waiting" text="When a member asks to pause their plan from the justFit app, it shows here for your answer." />
          ) : (
            <GymEmpty icon="circle-pause" title="No pauses yet" text="Members' requests and the pauses your staff record show here." />
          )
        }
        renderItem={({ item }) => {
          const pending = item.status === "pending";
          const asking = deciding?.id === item.id ? deciding : null;
          return (
            <View className="gym-member-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <PressableScale
                onPress={() => router.push({ pathname: "/gym/members/[id]", params: { id: String(item.member.id) } })}
                className="flex-row items-center"
                style={{ gap: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`${item.member.name}, ${item.member.code}, ${STATUS_TEXT[item.status]}, ${shortDate(item.from)} to ${shortDate(item.until)}, ${item.days} days. ${item.reason}`}
              >
                <View className="gym-avatar gym-avatar--item"><Text className="gym-avatar__label">{initialsOf(item.member.name)}</Text><MemberPhotoImage url={item.member.photoUrl} /></View>
                <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{item.member.name}</Text>
                  <Text className="gym-tx__meta" numberOfLines={1}>{`${item.member.code} · ${WHO[item.by]}`}</Text>
                </View>
                <View className="gym-tag" style={{ backgroundColor: colors.gymBar }}>
                  <Text className="gym-tag__label" style={{ color: statusColor(item.status) }}>{STATUS_TEXT[item.status]}</Text>
                </View>
              </PressableScale>
              <View className="gym-summary" style={{ gap: 4 }}>
                <Text className="gym-tx__name">{`${shortDate(item.from)} to ${shortDate(item.until)} · ${item.days} ${item.days === 1 ? "day" : "days"}`}</Text>
                <Text className="gym-tx__meta">{`Reason: ${item.reason}`}</Text>
                <Text className="gym-tx__meta">
                  {pending && item.wouldEndOn
                    ? `Plan ends on ${shortDate(item.member.expiresOn)} now; ${shortDate(item.wouldEndOn)} once approved.`
                    : item.status === "approved"
                      ? `${item.extendedDays ?? item.days} days added · plan ends on ${shortDate(item.member.expiresOn)}`
                      : `Plan ends on ${shortDate(item.member.expiresOn)}`}
                </Text>
                {item.note ? <Text className="gym-tx__meta">{`Note: ${item.note}`}</Text> : null}
              </View>
              {pending && (
                <View className="flex-row" style={{ gap: 8 }}>
                  <PressableScale onPress={() => decide(item, false)} haptic="tap" className="gym-btn gym-btn--outline flex-1" style={asking && !asking.approve ? { borderColor: colors.gymDanger } : undefined} accessibilityRole="button" accessibilityLabel={asking && !asking.approve ? `Confirm: reject ${item.member.name}'s pause` : `Reject ${item.member.name}'s pause`}>
                    <GymIcon name="x" size={16} color={colors.gymDanger} />
                    <Text className="gym-btn__label gym-btn__label--outline" style={{ color: colors.gymDanger }}>{busy && asking && !asking.approve ? "Rejecting…" : asking && !asking.approve ? "Tap again to reject" : "Reject"}</Text>
                  </PressableScale>
                  <PressableScale onPress={() => decide(item, true)} haptic="tap" className="gym-btn flex-1" accessibilityRole="button" accessibilityLabel={asking?.approve ? `Confirm: approve ${item.member.name}'s pause` : `Approve ${item.member.name}'s pause`}>
                    <GradientFill radius={14} />
                    <GymIcon name="check" size={16} color={colors.white} />
                    <Text className="gym-btn__label">{busy && asking?.approve ? "Approving…" : asking?.approve ? "Tap again to approve" : "Approve"}</Text>
                  </PressableScale>
                </View>
              )}
            </View>
          );
        }}
      />
    </GymScreen>
  );
}
