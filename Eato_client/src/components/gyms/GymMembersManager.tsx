import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { roleLabels, type MembershipStatus } from "@/lib/gymRules";
import { gyms, type Gym, type GymMember } from "@/lib/gyms";
import { colors } from "@/theme";

const lists: { key: MembershipStatus; label: string }[] = [
  { key: "pending", label: "Requests" },
  { key: "active", label: "Members" },
  { key: "suspended", label: "Suspended" },
];

type Props = { gym: Gym; getToken: () => Promise<string | null>; onChanged: () => void };

// Manage → Members: approve or decline requests, change roles (trainers are members with the
// trainer role), suspend, reinstate or remove. The owner is never offered an action, and only
// the owner is offered "Make admin"; the server enforces both whatever the screen shows.
export function GymMembersManager({ gym, getToken, onChanged }: Props) {
  const [list, setList] = useState<MembershipStatus>("pending");
  const [rows, setRows] = useState<GymMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<GymMember | null>(null);
  const [removing, setRemoving] = useState<GymMember | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isOwner = gym.membership?.role === "owner";

  const load = useCallback(async () => {
    setRows(null);
    const result = await gyms.members(await getToken(), gym.id, list);
    if (result.ok) setRows(result.data.members);
    else setError(result.error);
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
    if (row.role !== "trainer") actions.push({ label: "Make trainer", onPress: () => apply(row, { role: "trainer" }) });
    if (row.role !== "member") actions.push({ label: "Make member", onPress: () => apply(row, { role: "member" }) });
    if (isOwner && row.role !== "admin") actions.push({ label: "Make admin", onPress: () => apply(row, { role: "admin" }) });
    if (row.status === "active") actions.push({ label: "Suspend", destructive: true, onPress: () => apply(row, { status: "suspended" }) });
    actions.push({ label: "Remove from gym", destructive: true, onPress: () => setRemoving(row) });
    return actions;
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-2" accessibilityRole="tablist">
        {lists.map((item) => (
          <Pressable key={item.key} onPress={() => setList(item.key)} className={list === item.key ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="tab" accessibilityState={{ selected: list === item.key }}>
            <Text className={list === item.key ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {rows === null ? (
        <ActivityIndicator color={colors.forest} />
      ) : rows.length === 0 ? (
        <EmptyState icon={{ ios: "person.2", android: "group", web: "group" }} title={list === "pending" ? "No requests" : list === "suspended" ? "Nobody is suspended" : "No members"} text={list === "pending" ? "People asking to join show here." : "Members show here."} />
      ) : (
        rows.map((row) => {
          const actions = actionsFor(row);
          return (
            <View key={row.member.id} className="flex-row items-center gap-3 py-1">
              <Avatar member={row.member} size={44} />
              <View className="flex-1">
                <Text className="post__author" numberOfLines={1}>{row.member.name}{row.isMe ? " (you)" : ""}</Text>
                <Text className="post__time">{roleLabels[row.role]}</Text>
              </View>
              {busy === row.member.id ? (
                <ActivityIndicator color={colors.forest} />
              ) : row.status === "pending" && actions.length > 0 ? (
                <View className="flex-row gap-2">
                  <Pressable onPress={() => apply(row, "remove")} className="group__join group__join--joined" accessibilityRole="button" accessibilityLabel={`Decline ${row.member.name}`}>
                    <Text className="group__join-label group__join-label--joined">Decline</Text>
                  </Pressable>
                  <Pressable onPress={() => apply(row, { status: "active" })} className="group__join" accessibilityRole="button" accessibilityLabel={`Approve ${row.member.name}`}>
                    <Text className="group__join-label">Approve</Text>
                  </Pressable>
                </View>
              ) : actions.length > 0 ? (
                <Pressable onPress={() => setMenuFor(row)} className="admin__action" accessibilityRole="button" accessibilityLabel={`Manage ${row.member.name}`}>
                  <Text className="admin__action-label">Manage</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
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
