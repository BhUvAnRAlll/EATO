import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Platform, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { CollectDueSheet } from "@/components/gym/CollectDueSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { SendReminderSheet, type ReminderKind } from "@/components/gym/SendReminderSheet";
import { MEMBER_FILTERS, rupees } from "@/data/gymDashboard";
import { gymApi, type GymInfo, type GymMember, type MemberFilter } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { memberStatus } from "@/lib/gymMember";
import { listPerf } from "@/lib/listPerf";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

export const isMemberFilter = (value: unknown): value is MemberFilter => typeof value === "string" && MEMBER_FILTERS.some((f) => f.id === value);

export type MemberPick = "renewal" | "due" | "pt" | null;

type Sort = "name" | "days" | "due";
const SORTS: { id: Sort; label: string }[] = [
  { id: "name", label: "Name (A to Z)" },
  { id: "days", label: "Days left (fewest first)" },
  { id: "due", label: "Payment due (highest first)" },
];
const filterTitle = (id: MemberFilter) => (id === "all" ? "All Members" : MEMBER_FILTERS.find((f) => f.id === id)?.label ?? "All Members");

// "4 days left", "0 days left", or "Expired" (red) + "6 days ago"
function daysText(days: number) {
  if (days < 0) return { expired: true, text: `${-days} ${days === -1 ? "day" : "days"} ago` };
  return { expired: false, text: `${days} ${days === 1 ? "day" : "days"} left` };
}

// Manage › Member (the user's design, 2026-11-07): the search bar with the sort button, the
// filters as chips (each with its count from the server), then a card per member: the photo spot,
// the name, the ID (PT when on personal training) and the status (Active, Due, Expiring or
// Expired) with ⋯ for their options; a days-left pill (red once expired) and a payment-due pill;
// then "Tap bell to send reminder" with Collect (when they owe, opens Collect Payment Due) and the
// bell, which sends the reminder that fits: expired, else due, else expiry (red once expired).
// Reminders go by SMS from justFit (1 credit each, after a confirm); while sending is off the
// phone's own SMS app opens with the text written.
// In pick mode (from + › Renewal, Due payment or PT) tapping a member opens that form.
export function MemberList({ pick = null, initialFilter = "all", focusSearch = false }: { pick?: MemberPick; initialFilter?: MemberFilter; focusSearch?: boolean }) {
  const colors = useThemeColors();
  // Narrow phones (under 360): the status pill moves under the name, beside the days-left pill
  const narrow = useWindowDimensions().width < 360;
  const [filter, setFilter] = useState<MemberFilter>(initialFilter);
  const [sort, setSort] = useState<Sort>("name");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<"sort" | "add" | null>(null);
  const [actions, setActions] = useState<GymMember | null>(null);
  const [collecting, setCollecting] = useState<GymMember | null>(null);
  const [reminding, setReminding] = useState<{ member: GymMember; kind: ReminderKind } | null>(null);

  // Search after a short pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback((token: string | null) => gymApi.members(token, filter, search), [filter, search]);
  const { result, retry, reload } = useGymData(load);
  const gym: GymInfo | null = result.state === "ready" ? result.data.gym : null;

  const members = useMemo(() => {
    const list = result.state === "ready" ? [...result.data.members] : [];
    if (sort === "days") list.sort((a, b) => a.daysLeft - b.daysLeft);
    if (sort === "due") list.sort((a, b) => b.due - a.due);
    return list;
  }, [result, sort]);

  const open = (member: GymMember) => {
    const id = String(member.id);
    if (pick === "renewal") router.push({ pathname: "/gym/members/[id]/renew", params: { id } });
    else if (pick === "due") router.push({ pathname: "/gym/members/[id]/due", params: { id } });
    else if (pick === "pt") router.push({ pathname: "/gym/members/[id]/pt", params: { id } });
    else router.push({ pathname: "/gym/members/[id]", params: { id } });
  };

  const counts = result.state === "ready" ? result.data.counts : null;

  const header = (
    <View style={{ gap: 14, paddingBottom: 4 }}>
      {pick && <Text className="gym-tx__meta">{pick === "renewal" ? "Pick the member who is renewing." : pick === "pt" ? "Pick the member who is paying for personal training." : "Pick the member who is paying their due."}</Text>}
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="gym-mlist__search flex-1">
          <GymIcon name="search" size={20} color={colors.gymFaint} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Search member by name or ID..."
            placeholderTextColor={colors.gymFaint}
            autoFocus={focusSearch}
            autoCorrect={false}
            maxLength={60}
            style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
            accessibilityLabel="Search members"
          />
        </View>
        <PressableScale onPress={() => setSheet("sort")} className="gym-mlist__square" accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS.find((s) => s.id === sort)?.label}`}>
          <GymIcon name="sliders-horizontal" size={22} color={colors.gymPrimary} />
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }} accessibilityRole="tablist">
        {MEMBER_FILTERS.map((f) => {
          const selected = f.id === filter;
          const count = counts ? counts[f.id] : null;
          return (
            <PressableScale
              key={f.id}
              onPress={() => { if (!selected) haptic.select(); setFilter(f.id); }}
              className={selected ? "gym-mlist__chip gym-mlist__chip--selected" : "gym-mlist__chip"}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={filterTitle(f.id)}
              accessibilityValue={count === null ? undefined : { text: String(count) }}
            >
              <Text className={selected ? "gym-mlist__chip-label gym-mlist__chip-label--selected" : "gym-mlist__chip-label"}>{filterTitle(f.id)}</Text>
              {count !== null && (
                <View className={selected ? "gym-mlist__count gym-mlist__count--selected" : "gym-mlist__count"}>
                  <Text className={selected ? "gym-mlist__count-label gym-mlist__count-label--selected" : "gym-mlist__count-label"}>{count}</Text>
                </View>
              )}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );

  const choiceSheet = <T extends string>(title: string, options: { id: T; label: string }[], value: T, onPick: (id: T) => void) => (
    <GymSheet title={title} onClose={() => setSheet(null)}>
      <View>
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <Pressable key={o.id} onPress={() => { haptic.select(); onPick(o.id); setSheet(null); }} className="gym-addrow" accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={o.label}>
              <Text className="gym-menu__label flex-1" numberOfLines={1} style={selected ? { color: colors.gymPrimaryText } : undefined}>{o.label}</Text>
              {selected && <GymIcon name="check" size={16} color={colors.gymPrimary} />}
            </Pressable>
          );
        })}
      </View>
    </GymSheet>
  );

  return (
    <>
      <FlatList
        {...listPerf}
        data={members}
        keyExtractor={(m) => String(m.id)}
        style={{ backgroundColor: colors.gymCanvas }}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading members" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : (
            <GymEmpty icon="users" title={search || filter !== "all" ? "No members match" : "No members yet"} text={filter === "birthday" && !search ? "Add members' dates of birth to see their birthdays here." : search || filter !== "all" ? "Try another search or filter." : "Tap Add to record your first admission."} />
          )
        }
        renderItem={({ item }) => {
          const days = daysText(item.daysLeft);
          // The bell opens Send Reminder on the template that fits: expired first, then due, else expiry
          const kind: ReminderKind = item.status === "expired" ? "expired" : item.due > 0 ? "due" : "expired";
          const state = memberStatus(item);
          const status = state.id === "expired"
            ? { label: state.label, color: colors.gymDanger, ground: colors.gymDangerSoft }
            : state.id === "active"
              ? { label: state.label, color: colors.gymSuccess, ground: colors.gymSuccessSoft }
              : { label: state.label, color: colors.gymWarning, ground: colors.gymWarningSoft };
          const statusPill = (
            <View className="gym-mcard__status" style={{ backgroundColor: status.ground }} accessibilityLabel={`Status: ${status.label}`}>
              <View className="gym-mcard__dot" style={{ backgroundColor: status.color }} />
              <Text className="gym-mcard__status-label" style={{ color: status.color }}>{status.label}</Text>
            </View>
          );
          return (
            <View className="gym-mcard">
              {/* The member's row opens them; the status, ⋯ and the footer's buttons sit outside it (no button inside a button) */}
              <View className="flex-row items-center" style={{ gap: 10 }}>
                <PressableScale
                  onPress={() => open(item)}
                  className="min-w-0 flex-1 flex-row items-center"
                  style={{ gap: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.code}${item.pt?.active ? ", on PT" : ""}, ${days.expired ? `expired ${days.text}` : days.text}${item.due > 0 ? `, ${rupees(item.due)} payment due` : ""}`}
                >
                  <View className="gym-mcard__avatar">
                    <GymIcon name="user" size={22} color={colors.gymMuted} />
                    <MemberPhotoImage url={item.photoUrl} />
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="gym-mcard__name" numberOfLines={1}>{item.name}</Text>
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <GymIcon name="id-card" size={14} color={colors.gymFaint} />
                      <Text className="gym-mcard__code" numberOfLines={1} style={{ flexShrink: 1 }}>{item.code}</Text>
                      {item.pt?.active && (
                        <View className="gym-chip" style={{ borderColor: colors.gymSuccessLine, backgroundColor: colors.gymSuccessSoft }}>
                          <Text className="gym-chip__label" style={{ color: colors.gymSuccess }}>PT</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </PressableScale>
                {!pick && (
                  <View className="flex-row items-center" style={{ gap: 2 }}>
                    {!narrow && statusPill}
                    <PressableScale onPress={() => setActions(item)} hitSlop={6} className="gym-plain-btn" style={{ width: 32 }} accessibilityRole="button" accessibilityLabel={`${item.name}: options`}>
                      <GymIcon name="ellipsis" size={20} color={colors.gymFaint} />
                    </PressableScale>
                  </View>
                )}
              </View>
              {/* One line: the days and due pills, then Collect and the bell at the end */}
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <View className="min-w-0 flex-1 flex-row flex-wrap items-center" style={{ gap: 6 }}>
                  {!pick && narrow && statusPill}
                  <View className="gym-mcard__pill" style={days.expired ? { backgroundColor: colors.gymDangerSoft } : undefined}>
                    <GymIcon name="calendar" size={14} color={days.expired ? colors.gymDanger : colors.gymPrimary} />
                    <Text className="gym-mcard__pill-label" numberOfLines={1} style={days.expired ? { color: colors.gymDanger } : undefined}>{days.expired ? `Expired ${days.text}` : days.text}</Text>
                  </View>
                  {item.due > 0 && (
                    <View className="gym-mcard__pill" style={{ backgroundColor: colors.gymDangerSoft }}>
                      <GymIcon name="credit-card" size={14} color={colors.gymDanger} />
                      <Text className="gym-mcard__pill-label" numberOfLines={1} style={{ flexShrink: 1, color: colors.gymDanger }}>{`${rupees(item.due)} due${item.overdue ? " · overdue" : ""}`}</Text>
                    </View>
                  )}
                </View>
                {!pick && (
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    {item.due > 0 && (
                      <PressableScale onPress={() => setCollecting(item)} haptic="tap" className="gym-mcard__collect" accessibilityRole="button" accessibilityLabel={`Collect ${rupees(item.due)} from ${item.name}`}>
                        <GymIcon name="indian-rupee" size={14} color={colors.gymSuccess} />
                        <Text className="gym-mcard__collect-label">Collect</Text>
                      </PressableScale>
                    )}
                    <PressableScale
                      onPress={() => { haptic.select(); setReminding({ member: item, kind }); }}
                      className="gym-mcard__bell"
                      hitSlop={6}
                      style={item.status === "expired" ? { backgroundColor: colors.gymDangerSoft } : undefined}
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${item.name} ${item.status === "expired" ? "an expired" : kind === "due" ? "a due" : "an expiry"} reminder`}
                    >
                      <GymIcon name="bell" size={18} color={item.status === "expired" ? colors.gymDanger : colors.gymPrimary} />
                    </PressableScale>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
      {!pick && (
        <View className="absolute" style={{ right: 16, bottom: 16 }}>
          <PressableScale onPress={() => setSheet("add")} haptic="tap" className="gym-fab" accessibilityRole="button" accessibilityLabel="Add a member">
            <GradientFill radius={18} />
            <GymIcon name="plus" size={22} color={colors.white} />
          </PressableScale>
        </View>
      )}
      {sheet === "add" && (
        <AddMemberSheet
          onClose={() => setSheet(null)}
          onSaved={(detail) => {
            setSheet(null);
            reload();
            router.push({ pathname: "/gym/members/[id]", params: { id: String(detail.member.id) } });
          }}
        />
      )}
      {sheet === "sort" && choiceSheet("Sort members", SORTS, sort, setSort)}
      {reminding && gym && <SendReminderSheet kind={reminding.kind} member={reminding.member} gym={gym} onClose={() => setReminding(null)} onSent={reload} />}
      {collecting && gym && <CollectDueSheet member={collecting} gym={gym} onClose={() => setCollecting(null)} onSaved={() => { setCollecting(null); reload(); }} />}
      {actions && gym && <MemberActionsSheet member={actions} gym={gym} onClose={() => setActions(null)} onChanged={(detail) => { setActions(detail.member); reload(); }} />}
    </>
  );
}
