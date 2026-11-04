import { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymChips } from "@/components/gym/GymField";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { MEMBER_FILTERS, STATUS_LABEL, initialsOf, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMember, type MemberFilter } from "@/lib/gymApi";
import { listPerf } from "@/lib/listPerf";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

export const isMemberFilter = (value: unknown): value is MemberFilter => typeof value === "string" && MEMBER_FILTERS.some((f) => f.id === value);

export type MemberPick = "renewal" | "due" | "pt" | null;

// The gym's members: search by name or phone, filter (due, expiring, expired, in today,
// birthdays). In pick mode (from + › Renewal, Due payment or PT) tapping a member opens that form;
// otherwise the member's page. Used by Members and by Manage › Member.
export function MemberList({ pick = null, initialFilter = "all", focusSearch = false }: { pick?: MemberPick; initialFilter?: MemberFilter; focusSearch?: boolean }) {
  const colors = useThemeColors();
  const [filter, setFilter] = useState<MemberFilter>(initialFilter);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");

  // Search after a short pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback((token: string | null) => gymApi.members(token, filter, search), [filter, search]);
  const { result, retry } = useGymData(load);

  const open = (member: GymMember) => {
    const id = String(member.id);
    if (pick === "renewal") router.push({ pathname: "/gym/members/[id]/renew", params: { id } });
    else if (pick === "due") router.push({ pathname: "/gym/members/[id]/due", params: { id } });
    else if (pick === "pt") router.push({ pathname: "/gym/members/[id]/pt", params: { id } });
    else router.push({ pathname: "/gym/members/[id]", params: { id } });
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      {pick && <Text className="gym-tx__meta">{pick === "renewal" ? "Pick the member who is renewing." : pick === "pt" ? "Pick the member who is paying for personal training." : "Pick the member who is paying what they owe."}</Text>}
      <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
        <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={16} tintColor={colors.gymFaint} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="Search by name, phone or ID"
          placeholderTextColor={colors.gymFaint}
          autoFocus={focusSearch}
          autoCorrect={false}
          maxLength={60}
          style={{ flex: 1, fontFamily: "Poppins-Regular", fontSize: 15, color: colors.gymInk, paddingVertical: 0 }}
          accessibilityLabel="Search members"
        />
      </View>
      <GymChips options={MEMBER_FILTERS.map((f) => ({ value: f.id, label: f.label }))} value={filter} onChange={setFilter} />
    </View>
  );

  return (
      <FlatList
        {...listPerf}
        data={result.state === "ready" ? result.data.members : []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={header}
        ListEmptyComponent={
          result.state === "loading" ? (
            <GymLoading label="Loading members" />
          ) : result.state === "failed" ? (
            <GymError error={result.error} onRetry={retry} />
          ) : (
            <GymEmpty icon={{ ios: "person.2", android: "group", web: "group" }} title={search || filter !== "all" ? "No members match" : "No members yet"} text={filter === "birthday" && !search ? "Add members' dates of birth to see their birthdays here." : search || filter !== "all" ? "Try another search or filter." : "Tap Add to record your first admission."} />
          )
        }
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => open(item)}
            className="gym-card gym-tx"
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.code}, ${STATUS_LABEL[item.status]}, until ${shortDate(item.expiresOn)}${item.due > 0 ? `, owes ${rupees(item.due)}${item.overdue ? ", overdue" : item.dueBy ? `, due ${shortDate(item.dueBy)}` : ""}` : ""}${item.inToday ? ", in today" : ""}${item.birthdayToday ? ", birthday today" : ""}`}
          >
            <View className="gym-avatar">
              <Text className="gym-avatar__label">{initialsOf(item.name)}</Text>
            </View>
            <View className="min-w-0 flex-1" style={{ gap: 3 }}>
              <Text className="gym-tx__name" numberOfLines={1}>{item.name}</Text>
              <Text className="gym-tx__meta" numberOfLines={1}>{`${item.code} · ${STATUS_LABEL[item.status]} · until ${shortDate(item.expiresOn)}`}</Text>
            </View>
            <View className="items-end" style={{ gap: 4 }}>
              {item.due > 0 && (
                <View className="gym-tag" style={{ backgroundColor: colors.gymDangerSoft }}>
                  <Text className="gym-tag__label" style={{ color: colors.gymDanger }}>{item.overdue ? `Overdue ${rupees(item.due)}` : `Owes ${rupees(item.due)}`}</Text>
                </View>
              )}
              {item.birthdayToday && (
                <View className="gym-tag" style={{ backgroundColor: colors.gymPrimarySoft }}>
                  <Text className="gym-tag__label" style={{ color: colors.gymPrimaryText }}>Birthday</Text>
                </View>
              )}
              {item.inToday && (
                <View className="gym-tag" style={{ backgroundColor: colors.gymSuccessSoft }}>
                  <Text className="gym-tag__label" style={{ color: colors.gymSuccess }}>In today</Text>
                </View>
              )}
            </View>
          </PressableScale>
        )}
      />
  );
}
