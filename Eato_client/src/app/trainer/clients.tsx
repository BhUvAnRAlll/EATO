import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo } from "@/lib/community";
import { trainers, type ClientRow } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The members this trainer coaches, with what each one has from them so far
export default function TrainerClients() {
  const getToken = useSessionToken();
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await trainers.clients(await getToken());
    if (result.ok) setClients(result.data.clients);
    else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  return (
    <AdminScreen title="My clients">
      <View className="gap-3">
        {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
        {clients === null ? (
          <ActivityIndicator color={colors.forest} />
        ) : clients.length === 0 ? (
          <EmptyState icon={{ ios: "person.2", android: "group", web: "group" }} title="No clients yet" text="Accept a request and the member shows here." actionLabel="Open requests" onAction={() => router.push("/trainer/requests")} />
        ) : (
          clients.map((c) => (
            <Pressable key={c.member.id} onPress={() => router.push({ pathname: "/trainer/client/[id]", params: { id: c.member.id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Open ${c.member.name}`}>
              <Avatar member={c.member} size={44} />
              <View className="flex-1">
                <Text className="post__author" numberOfLines={1}>{c.member.name}</Text>
                <Text className="post__time" numberOfLines={1}>{[`Client ${timeAgo(c.since)}`, c.hasDietPlan ? "diet plan" : null, c.hasWorkout ? "workout" : null, c.hasRecommendation ? "targets" : null].filter(Boolean).join(" · ")}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
            </Pressable>
          ))
        )}
      </View>
    </AdminScreen>
  );
}
