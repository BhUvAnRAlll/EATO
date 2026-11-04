import { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymChips } from "@/components/gym/GymField";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { MEMBER_FILTERS, STATUS_LABEL, initialsOf, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMember, type MemberFilter } from "@/lib/gymApi";
import { listPerf } from "@/lib/listPerf";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const isFilter = (value: unknown): value is MemberFilter => typeof value === "string" && MEMBER_FILTERS.some((f) => f.id === value);

// Gym admin › Members: search by name or phone, filter (due, expiring today, expired, in today).
// From + › Renewal or Due payment it opens in pick mode: tapping a member opens that form.
export default function GymMembers() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ filter?: string; pick?: string; focus?: string }>();
  const pick = params.pick === "renewal" || params.pick === "due" ? params.pick : null;
  const [filter, setFilter] = useState<MemberFilter>(isFilter(params.filter) ? params.filter : "all");
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
    else router.push({ pathname: "/gym/members/[id]", params: { id } });
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      {pick && <Text className="gym-tx__meta">{pick === "renewal" ? "Pick the member who is renewing." : "Pick the member who is paying what they owe."}</Text>}
      <View className="gym-field__input flex-row items-center" style={{ gap: 8 }}>
        <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={16} tintColor={colors.gymFaint} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="Search by name or phone"
          placeholderTextColor={colors.gymFaint}
          autoFocus={params.focus === "search"}
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
    <GymScreen
      title={pick === "renewal" ? "Renewal: pick a member" : pick === "due" ? "Due payment: pick a member" : "Members"}
      scroll={false}
      right={
        !pick ? (
          <PressableScale onPress={() => router.push("/gym/admission")} hitSlop={8} accessibilityRole="button" accessibilityLabel="New admission">
            <Text className="gym-link">Add</Text>
          </PressableScale>
        ) : undefined
      }
    >
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
            <GymEmpty icon={{ ios: "person.2", android: "group", web: "group" }} title={search || filter !== "all" ? "No members match" : "No members yet"} text={search || filter !== "all" ? "Try another search or filter." : "Tap Add to record your first admission."} />
          )
        }
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => open(item)}
            className="gym-card gym-tx"
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${STATUS_LABEL[item.status]}, until ${shortDate(item.expiresOn)}${item.due > 0 ? `, owes ${rupees(item.due)}` : ""}${item.inToday ? ", in today" : ""}`}
          >
            <View className="gym-avatar">
              <Text className="gym-avatar__label">{initialsOf(item.name)}</Text>
            </View>
            <View className="min-w-0 flex-1" style={{ gap: 3 }}>
              <Text className="gym-tx__name" numberOfLines={1}>{item.name}</Text>
              <Text className="gym-tx__meta" numberOfLines={1}>{`${STATUS_LABEL[item.status]} · until ${shortDate(item.expiresOn)}`}</Text>
            </View>
            <View className="items-end" style={{ gap: 4 }}>
              {item.due > 0 && (
                <View className="gym-tag" style={{ backgroundColor: colors.gymDangerSoft }}>
                  <Text className="gym-tag__label" style={{ color: colors.gymDanger }}>{`Owes ${rupees(item.due)}`}</Text>
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
    </GymScreen>
  );
}
