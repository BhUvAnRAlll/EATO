import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo, type Member } from "@/lib/community";
import { trainers } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Members asking this trainer to coach them. Accepting makes them a client (their diet plan,
// workout, targets and messaging unlock); declining leaves them free to ask someone else.
export default function TrainerRequests() {
  const getToken = useSessionToken();
  const [requests, setRequests] = useState<{ member: Member; requestedAt: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await trainers.requests(await getToken());
    if (result.ok) setRequests(result.data.requests);
    else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const answer = async (member: Member, accept: boolean) => {
    setBusy(member.id);
    const result = await trainers.answer(await getToken(), member.id, accept);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await load();
  };

  return (
    <AdminScreen title="Requests" subtitle="Members who asked you to coach them">
      <View className="gap-3">
        {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
        {requests === null ? (
          <ActivityIndicator color={colors.forest} />
        ) : requests.length === 0 ? (
          <EmptyState icon={{ ios: "tray", android: "inbox", web: "inbox" }} title="No requests" text="When a member asks you to coach them, it shows here." />
        ) : (
          requests.map((r) => (
            <View key={r.member.id} className="post__card flex-row items-center gap-3">
              <Avatar member={r.member} size={44} />
              <View className="flex-1">
                <Text className="post__author" numberOfLines={1}>{r.member.name}</Text>
                <Text className="post__time">{`Asked ${timeAgo(r.requestedAt)}`}</Text>
              </View>
              {busy === r.member.id ? (
                <ActivityIndicator color={colors.forest} />
              ) : (
                <View className="flex-row gap-2">
                  <Pressable onPress={() => answer(r.member, false)} className="group__join group__join--joined" accessibilityRole="button" accessibilityLabel={`Decline ${r.member.name}`}>
                    <Text className="group__join-label group__join-label--joined">Decline</Text>
                  </Pressable>
                  <Pressable onPress={() => answer(r.member, true)} className="group__join" accessibilityRole="button" accessibilityLabel={`Accept ${r.member.name}`}>
                    <Text className="group__join-label">Accept</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </View>
    </AdminScreen>
  );
}
