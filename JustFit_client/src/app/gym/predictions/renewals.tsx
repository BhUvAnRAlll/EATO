import { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { SendReminderSheet } from "@/components/gym/SendReminderSheet";
import { gymApi, type RiskListLevel, type RiskMember } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { listPerf } from "@/lib/listPerf";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const LEVELS: { id: RiskListLevel; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
const isLevel = (value: unknown): value is RiskListLevel => LEVELS.some((l) => l.id === value);
const updatedAt = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

// Gym admin › Likely to leave (Predictions, the first one): every member with a plan running (or
// ended in the last week), highest risk first. The server scores each member from the branch's
// own records (plan ending, no recent visit, fewer visits, a payment due, PT) every time this
// opens: no AI, nothing stored, nothing sent by itself. High, Medium and Low are all listed since
// 2026-11-07 (the user's request; Low was left off before), so staff see every member's standing;
// Home's Needs attention still counts High only. Each card shows the level, the score and the
// reasons (or "Nothing against them" for a clean Low); the bell opens Send
// Reminder on the renewal template (WhatsApp, SMS; notifications coming soon, the same as every
// other bell since 2026-11-07), and ⋯ opens the member's usual options.
export default function RenewalRisks() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ level?: string }>();
  const narrow = useWindowDimensions().width < 360;
  const [level, setLevel] = useState<RiskListLevel>(isLevel(params.level) ? params.level : "all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [actions, setActions] = useState<RiskMember | null>(null);
  const [reminding, setReminding] = useState<RiskMember | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback((token: string | null) => gymApi.renewalRisks(token, level, search), [level, search]);
  const { result, retry, reload } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;

  const tone = (risk: RiskMember["risk"]) =>
    risk.level === "high"
      ? { ink: colors.gymDanger, bg: colors.gymDangerSoft, label: "High" }
      : risk.level === "medium"
        ? { ink: colors.gymWarning, bg: colors.gymWarningSoft, label: "Medium" }
        : { ink: colors.gymSuccess, bg: colors.gymSuccessSoft, label: "Low" };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <Text className="gym-tx__meta">{"Worked out just now from each member's plan, visits and dues. Nothing is sent unless you tap it."}</Text>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {LEVELS.map((l) => {
            const selected = l.id === level;
            const count = data ? (l.id === "all" ? data.counts.high + data.counts.medium + data.counts.low : data.counts[l.id]) : undefined;
            return (
              <PressableScale
                key={l.id}
                onPress={() => { if (!selected) haptic.select(); setLevel(l.id); }}
                className={selected ? "gym-kind gym-kind--selected" : "gym-kind"}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${l.label}${count !== undefined ? `, ${count}` : ""}`}
              >
                {selected && <GradientFill radius={999} />}
                <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{count !== undefined ? `${l.label} · ${count}` : l.label}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        <PressableScale onPress={() => { setSearchOpen((o) => !o); if (searchOpen) setTyped(""); }} hitSlop={8} className="gym-plain-btn" accessibilityRole="button" accessibilityLabel={searchOpen ? "Close search" : "Search members at risk"}>
          <GymIcon name={searchOpen ? "x" : "search"} size={22} color={colors.gymInkSoft} />
        </PressableScale>
      </View>
      {searchOpen && (
        <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
          <GymIcon name="search" size={16} color={colors.gymFaint} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search by name, phone or ID"
            placeholderTextColor={colors.gymFaint}
            autoFocus
            autoCorrect={false}
            maxLength={60}
            style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
            accessibilityLabel="Search members at risk"
          />
        </View>
      )}
      {data && <Text className="gym-tx__meta">{`Updated ${updatedAt(data.calculatedAt)} · High 60+, Medium 35 to 59, Low under 35`}</Text>}
    </View>
  );

  return (
    <GymScreen title="Likely to leave" scroll={false}>
      <FlatList
        {...listPerf}
        data={data?.members ?? []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Working out who may not renew" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : search || level !== "all" ? (
            <GymEmpty icon="user-x" title="No one matches" text="Try another search or level." />
          ) : (
            <GymEmpty icon="badge-check" title="No one to score yet" text="Every member with a plan running, or ended in the last week, is scored here from their plan, visits and dues." />
          )
        }
        renderItem={({ item }) => {
          const t = tone(item.risk);
          const reasons = item.risk.reasons.map((r) => r.text).join(" · ") || "Nothing against them";
          return (
            // The info opens the member; the buttons sit beside it (no button inside a button)
            <View className="gym-member-card">
              <PressableScale
                onPress={() => router.push({ pathname: "/gym/members/[id]", params: { id: String(item.id) } })}
                className="min-w-0 flex-1 flex-row items-center"
                style={{ gap: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.code}, ${t.label} risk, score ${item.risk.score}. ${reasons}`}
              >
                {!narrow && (
                  <View className="gym-member-card__avatar">
                    <GymIcon name="user" size={34} color={colors.white} />
                    <MemberPhotoImage url={item.photoUrl} />
                  </View>
                )}
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <Text className="gym-member-card__name" numberOfLines={1}>{item.name}</Text>
                  {/* The level and score first, then the ID (and PT), so the name keeps its whole line */}
                  <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                    <View className="gym-chip" style={{ borderColor: t.bg, backgroundColor: t.bg }}>
                      <Text className="gym-chip__label" style={{ color: t.ink }}>{`${t.label} · ${item.risk.score}`}</Text>
                    </View>
                    <GymIcon name="id-card" size={15} color={colors.gymInkSoft} />
                    <Text className="gym-member-card__line" numberOfLines={1}>{item.code}</Text>
                    {item.pt?.active && (
                      <View className="gym-chip" style={{ borderColor: colors.gymSuccessLine, backgroundColor: colors.gymSuccessSoft }}>
                        <Text className="gym-chip__label" style={{ color: colors.gymSuccess }}>PT</Text>
                      </View>
                    )}
                  </View>
                  <Text className="gym-member-card__line" numberOfLines={3} style={{ color: colors.gymInk }}>{reasons}</Text>
                </View>
              </PressableScale>
              <View className="flex-row items-center" style={{ gap: 2 }}>
                <PressableScale onPress={() => { haptic.select(); setReminding(item); }} hitSlop={6} className="gym-member-card__action" style={narrow ? { width: 28 } : undefined} accessibilityRole="button" accessibilityLabel={`Send ${item.name} a renewal reminder`}>
                  <GymIcon name="bell" size={20} color={colors.gymPrimary} />
                </PressableScale>
                <PressableScale onPress={() => setActions(item)} hitSlop={6} className="gym-member-card__action" style={narrow ? { width: 28 } : undefined} accessibilityRole="button" accessibilityLabel={`${item.name}: options`}>
                  <GymIcon name="ellipsis" size={20} color={colors.gymInkSoft} />
                </PressableScale>
              </View>
            </View>
          );
        }}
      />
      {reminding && data && <SendReminderSheet kind="expired" member={reminding} gym={data.gym} onClose={() => setReminding(null)} onSent={reload} />}
      {actions && data && <MemberActionsSheet member={actions} gym={data.gym} onClose={() => setActions(null)} onChanged={() => { setActions(null); reload(); }} />}
    </GymScreen>
  );
}
