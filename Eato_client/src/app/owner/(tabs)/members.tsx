import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { EmptyState } from "@/components/community/CommunityStates";
import { GymMembersManager } from "@/components/gyms/GymMembersManager";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

// Members: the same member manager as Manage gym › Members (search, active and pending,
// approve or decline, roles, suspend, remove), with links to Renewals and Invitations.
// ?list=pending opens the requests; ?list=staff opens the trainers.
export default function OwnerMembers() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const summary = useOwnerStore((state) => state.summary);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [gym, setGym] = useState<Gym | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platform = summary?.gym.as === "platform";

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await gyms.get(await getToken(), gymId);
    if (result.ok) {
      setGym(result.data.gym);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  useEffect(() => {
    // A deferred first load (the screen mounts before any state change is allowed)
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // A change here (approve, role, remove) also changes Home's counts and the tab badge
  const changed = async () => {
    await load();
    await loadSummary(await getToken());
  };

  const links = (
    <View className="mx-5 mt-4 flex-row flex-wrap gap-2">
      <Pressable onPress={() => router.push("/owner/renewals")} className="owner-quick" accessibilityRole="button" accessibilityLabel="Renewals">
        <SymbolView name={{ ios: "calendar.badge.clock", android: "event_repeat", web: "event_repeat" }} size={16} tintColor={colors.ink} />
        <Text className="owner-quick__label">Renewals</Text>
      </Pressable>
      {gym && !platform && (
        <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/invite", params: { id: gym.id } })} className="owner-quick" accessibilityRole="button" accessibilityLabel="Invitations">
          <SymbolView name={{ ios: "envelope", android: "mail", web: "mail" }} size={16} tintColor={colors.ink} />
          <Text className="owner-quick__label">Invitations</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <OwnerHeader title={list === "staff" ? "Trainers" : "Members"} subtitle="Approve requests, change roles, and keep packages up to date." />
      {links}
      <View className="mt-3 flex-1">
        {platform ? (
          <View className="px-5">
            <View className="owner-card">
              <Text className="friend-row__name">Managed by the gym</Text>
              <Text className="friend-row__note">Approving, roles and removals are done by this gym&apos;s owner and admins. You can view and renew packages from Renewals.</Text>
            </View>
          </View>
        ) : gym ? (
          // Remount when the list changes (requests ↔ trainers), so the manager starts there
          <GymMembersManager key={list ?? "all"} gym={gym} getToken={getToken} onChanged={changed} staffOnly={list === "staff"} start={list === "pending" ? "pending" : "active"} />
        ) : error ? (
          <View className="px-5">
            <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
          </View>
        ) : (
          <ActivityIndicator color={colors.forest} className="mt-6" />
        )}
      </View>
    </SafeAreaView>
  );
}
