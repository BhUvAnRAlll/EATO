import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { roleLabels, type MembershipStatus } from "@/lib/gymRules";
import { gyms, type Gym, type GymMember } from "@/lib/gyms";
import { colors } from "@/theme";

const lists: { key: MembershipStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "suspended", label: "Suspended" },
];

// start: which list opens first
type Props = { gym: Gym; getToken: () => Promise<string | null>; onChanged: () => void; start?: MembershipStatus };

// Manage → Members: approve or decline requests, change roles, suspend, reinstate or remove. The owner is never offered an action, and only
// the owner is offered "Make admin"; the server enforces both whatever the screen shows.
export function GymMembersManager({ gym, getToken, onChanged, start = "active" }: Props) {
  const [list, setList] = useState<MembershipStatus>(start);
  const [counts, setCounts] = useState<Record<MembershipStatus, number> | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<GymMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<GymMember | null>(null);
  const [removing, setRemoving] = useState<GymMember | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isOwner = gym.membership?.role === "owner";

  // The open list, and the counts on every chip
  const load = useCallback(async () => {
    setRows(null);
    const token = await getToken();
    const results = await Promise.all(lists.map((item) => gyms.members(token, gym.id, item.key)));
    const next = {} as Record<MembershipStatus, number>;
    lists.forEach((item, index) => {
      const result = results[index];
      next[item.key] = result.ok ? result.data.members.length : 0;
      if (item.key === list) {
        if (result.ok) setRows(result.data.members);
        else setError(result.error);
      }
    });
    setCounts(next);
  }, [gym.id, list, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const apply = async (row: GymMember, change: Parameters<typeof gyms.changeMember>[3] | "remove") => {
    setBusy(row.member.id);
    const token = await getToken();
    const result = change === "remove" ? await gyms.removeMember(token, gym.id, row.member.id) : await gyms.changeMember(token, gym.id, row.member.id, change);
    setBusy(null);
    setRemoving(null);
    if (!result.ok) return setError(result.error);
    setError(null);
    await load();
    onChanged();
  };

  const actionsFor = (row: GymMember): SheetAction[] => {
    if (row.role === "owner" || row.isMe) return [];
    if (!isOwner && row.role === "admin") return [];
    if (row.status === "pending") {
      return [
        { label: "Approve", onPress: () => apply(row, { status: "active" }) },
        { label: "Decline", destructive: true, onPress: () => apply(row, "remove") },
      ];
    }
    const actions: SheetAction[] = [];
    if (row.status === "suspended") actions.push({ label: "Reinstate", onPress: () => apply(row, { status: "active" }) });
    if (row.role !== "member") actions.push({ label: "Make member", onPress: () => apply(row, { role: "member" }) });
    if (isOwner && row.role !== "admin") actions.push({ label: "Make admin", onPress: () => apply(row, { role: "admin" }) });
    if (row.status === "active") actions.push({ label: "Suspend", destructive: true, onPress: () => apply(row, { status: "suspended" }) });
    actions.push({ label: "Remove from gym", destructive: true, onPress: () => setRemoving(row) });
    return actions;
  };

  const term = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((row) => !term || row.member.name.toLowerCase().includes(term));
  const chips = lists.filter((item) => item.key !== "suspended" || (counts?.suspended ?? 0) > 0);

  return (
    <View className="gap-3">
      <View className="search search--pill">
        <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
        <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search by name" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search members" />
      </View>
      {chips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {chips.map((item) => {
            const selected = list === item.key;
            const label = counts ? `${item.label} (${counts[item.key]})` : item.label;
            return (
              <Pressable key={item.key} onPress={() => setList(item.key)} className={selected ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label}>
                <Text className={selected ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {rows === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : shown.length === 0 ? (
        <EmptyState icon={{ ios: "person.2", android: "group", web: "group" }} title={term ? "Nobody matches" : list === "pending" ? "No requests" : list === "suspended" ? "Nobody is suspended" : "No members"} text={term ? "Try another name." : list === "pending" ? "People asking to join show here." : "Members show here."} />
      ) : (
        <View>
          {shown.map((row, index) => {
            const actions = actionsFor(row);
            const edge = [index === 0 ? "friend-row--first" : "", index === shown.length - 1 ? "friend-row--last" : ""].join(" ");
            const requested = new Date(row.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <View key={row.member.id} className={`friend-row ${edge}`}>
                <Avatar member={row.member} size={44} />
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name" numberOfLines={1}>{row.member.name}{row.isMe ? " (you)" : ""}</Text>
                  <Text className="friend-row__note" numberOfLines={1}>{row.status === "pending" ? `Requested ${requested}` : roleLabels[row.role]}</Text>
                </View>
                {busy === row.member.id ? (
                  <ActivityIndicator color={colors.forest} />
                ) : row.status === "pending" && actions.length > 0 ? (
                  <View className="flex-row items-center gap-1">
                    <Pressable onPress={() => apply(row, "remove")} hitSlop={6} className="px-2 py-2" accessibilityRole="button" accessibilityLabel={`Decline ${row.member.name}`}>
                      <Text className="gym-share__shortcut">Decline</Text>
                    </Pressable>
                    <Pressable onPress={() => apply(row, { status: "active" })} className="gym-join gym-join--filled" accessibilityRole="button" accessibilityLabel={`Approve ${row.member.name}`}>
                      <Text className="gym-join__label gym-join__label--filled">Approve</Text>
                    </Pressable>
                  </View>
                ) : actions.length > 0 ? (
                  <Pressable onPress={() => setMenuFor(row)} className="gym-join" accessibilityRole="button" accessibilityLabel={`Manage ${row.member.name}`}>
                    <Text className="gym-join__label">Manage</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      <ActionSheet visible={menuFor !== null} title={menuFor?.member.name} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />
      <ConfirmSheet
        visible={removing !== null}
        title={`Remove ${removing?.member.name.split(" ")[0] ?? "member"}?`}
        text="They leave the gym and would need to join again."
        confirmLabel="Remove"
        busy={busy !== null}
        onConfirm={() => removing && apply(removing, "remove")}
        onCancel={() => setRemoving(null)}
      />
    </View>
  );
}
