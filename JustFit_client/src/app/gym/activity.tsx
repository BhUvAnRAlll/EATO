import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { GymChips } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import type { GymIconName } from "@/constants/gymIcons";
import { shortDate } from "@/data/gymDashboard";
import { clockTime, indiaDay } from "@/lib/attendanceText";
import { gymApi, type ActivityAction, type ActivityEntry, type ActivityType } from "@/lib/gymApi";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

type ActionFilter = ActivityAction | "all";
const ACTIONS: { value: ActionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "create", label: "Added" },
  { value: "edit", label: "Edited" },
  { value: "delete", label: "Deleted" },
];
const VERB: Record<ActivityAction, string> = { create: "added", edit: "edited", delete: "deleted" };
// What the record is, before its name: "edited member Arjun M (FOR-TUM-0003)"
const NOUN: Record<ActivityType, string> = {
  member: "member", payment: "payment", enquiry: "enquiry", catalog: "", expense: "expense", pause: "pause for",
  attendance: "attendance for", sms: "", template: "template", settings: "", team: "team member",
};
const ICON: Record<ActivityType, GymIconName> = {
  member: "users", payment: "indian-rupee", enquiry: "messages-square", catalog: "clipboard-list", expense: "receipt", pause: "clock",
  attendance: "qr-code", sms: "message-square-more", template: "message-square-text", settings: "settings", team: "user-cog",
};

// Gym admin › ☰ › Activity (2026-11-09, the user's request): who added, edited or deleted what at
// this branch, Staff and the gym admin alike, one India day at a time (a year back at most), newest
// first, 50 at a time. Filters: Added / Edited / Deleted, and one person. Only the gym admin reaches
// it (the server answers Staff with a 403). A deleted record keeps the name it had.
export default function GymActivity() {
  const colors = useThemeColors();
  const today = indiaDay();
  const [day, setDay] = useState(today);
  const [action, setAction] = useState<ActionFilter>("all");
  const [person, setPerson] = useState("all");
  const [more, setMore] = useState<{ items: ActivityEntry[]; next: number | null; loading: boolean; error: string }>({ items: [], next: null, loading: false, error: "" });
  const getToken = useSessionToken();
  // Which list Show more belongs to: an answer for an earlier filter is dropped, never appended
  const listKey = useRef(0);

  const load = useCallback(
    async (token: string | null) => {
      const key = ++listKey.current;
      const answer = await gymApi.activity(token, { day, action, person });
      if (answer.ok && key === listKey.current) setMore({ items: [], next: answer.data.nextPage, loading: false, error: "" });
      return answer;
    },
    [day, action, person],
  );
  const { result, retry, refreshing, refresh } = useGymData(load);

  const loadMore = async () => {
    if (more.loading || !more.next) return;
    const key = listKey.current;
    setMore((m) => ({ ...m, loading: true, error: "" }));
    const answer = await gymApi.activity(await getToken().catch(() => null), { day, action, person, page: more.next });
    if (key !== listKey.current) return;
    setMore((m) => (answer.ok ? { items: [...m.items, ...answer.data.entries], next: answer.data.nextPage, loading: false, error: "" } : { ...m, loading: false, error: answer.error }));
  };

  const row = (e: ActivityEntry) => {
    const tone = e.action === "delete" ? { bg: colors.gymDangerSoft, ink: colors.gymDanger } : e.action === "create" ? { bg: colors.gymSuccessSoft, ink: colors.gymSuccess } : { bg: colors.gymPrimarySoft, ink: colors.gymPrimaryText };
    const what = [NOUN[e.type], e.label].filter(Boolean).join(" ");
    const who = `${e.by.name} · ${e.by.kind === "owner" ? "Gym admin" : "Staff"}`;
    return (
      <View key={e.id} className="gym-card gym-tx" accessible accessibilityLabel={`${who} ${VERB[e.action]} ${what}${e.detail ? `. ${e.detail}` : ""}. ${clockTime(e.at)}`}>
        <View className="gym-avatar" style={{ backgroundColor: tone.bg, borderColor: tone.bg }}>
          <GymIcon name={ICON[e.type]} size={18} color={tone.ink} />
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 4 }}>
          <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
            <Text className="gym-tx__name" numberOfLines={1} style={{ flexShrink: 1 }}>{e.by.name}</Text>
            <View className="gym-tag" style={{ backgroundColor: e.by.kind === "owner" ? colors.gymPrimarySoft : colors.gymWarningSoft }}>
              <Text className="gym-tag__label" style={{ color: e.by.kind === "owner" ? colors.gymPrimaryText : colors.gymWarningInk }}>{e.by.kind === "owner" ? "Gym admin" : "Staff"}</Text>
            </View>
          </View>
          <Text className="gym-tx__meta" style={{ color: colors.gymInk }}>
            <Text style={{ color: tone.ink }}>{VERB[e.action]}</Text>
            {` ${what}`}
          </Text>
          {e.detail ? <Text className="gym-tx__meta">{e.detail}</Text> : null}
        </View>
        <Text className="gym-tx__date">{clockTime(e.at)}</Text>
      </View>
    );
  };

  const data = result.state === "ready" ? result.data : null;
  const rows = data ? [...data.entries, ...more.items] : [];
  const emptyText = action === "all" && person === "all" ? (day === today ? "No one has added, edited or deleted anything today." : `Nothing was added, edited or deleted on ${shortDate(day)}.`) : "Nothing matches these filters on this day.";

  return (
    <GymScreen title="Activity" refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
      <Text className="gym-tx__meta">Every add, edit and delete at this branch, by your Staff and by you. Kept for a year.</Text>
      <DateSelect label="Date" value={day} onChange={setDay} min={indiaDay(-365)} max={today} />
      <GymChips options={ACTIONS} value={action} onChange={setAction} />
      {data && (data.people.length > 1 || person !== "all") ? (
        <GymChips
          options={[{ value: "all", label: "Everyone" }, ...data.people.filter((p) => p.id).map((p) => ({ value: p.id as string, label: p.name }))]}
          value={person}
          onChange={setPerson}
        />
      ) : null}
      {data && data.counts.all > 0 ? (
        <Text className="gym-tx__meta">{`${data.counts.create} added · ${data.counts.edit} edited · ${data.counts.delete} deleted${person !== "all" ? " by them" : ""}`}</Text>
      ) : null}
      {result.state === "loading" && <GymLoading label="Loading activity" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" &&
        (rows.length === 0 ? (
          <GymEmpty icon="history" title="No activity" text={emptyText} />
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map(row)}
            {more.error ? <Text className="gym-tx__meta">{more.error}</Text> : null}
            {more.next ? (
              <PressableScale onPress={loadMore} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Show more activity">
                {more.loading && <ActivityIndicator size="small" color={colors.gymPrimary} />}
                <Text className="gym-btn__label gym-btn__label--outline">Show more</Text>
              </PressableScale>
            ) : null}
          </View>
        ))}
    </GymScreen>
  );
}
