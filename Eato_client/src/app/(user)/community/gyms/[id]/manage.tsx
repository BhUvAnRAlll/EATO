import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { GymAnnouncementsManager } from "@/components/gyms/GymAnnouncementsManager";
import { GymMembersManager } from "@/components/gyms/GymMembersManager";
import { GymProfileForm } from "@/components/gyms/GymProfileForm";
import { GymSettingsForm } from "@/components/gyms/GymSettingsForm";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Section = "members" | "profile" | "announcements" | "settings";
const sections: { key: Section; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "profile", label: "Profile" },
  { key: "announcements", label: "Announcements" },
  { key: "settings", label: "Settings" },
];

// Manage a gym (owner and admins): members and requests, the gym profile, announcements, and
// the community settings with the plan card. Invitations live on the Invite screen, which
// trainers can use too. Every change is checked again by the server.
export default function ManageGym() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [section, setSection] = useState<Section>("members");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.get(await getToken(), id);
    if (result.ok) setGym(result.data.gym);
    else setError(result.error);
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>Manage {gym?.name ?? "gym"}</Text>
        </View>
        {!gym ? (
          <View className="px-5 pt-4">{error ? <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title="Can't manage this gym" text={error} actionLabel="Retry" onAction={load} /> : <PostSkeleton />}</View>
        ) : !gym.can.manage ? (
          <View className="px-5 pt-4"><EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title="Admins only" text="Only the gym's owner and admins can manage it." /></View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
                {sections.map((item) => (
                  <Pressable key={item.key} onPress={() => setSection(item.key)} className={section === item.key ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="tab" accessibilityState={{ selected: section === item.key }}>
                    <Text className={section === item.key ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {section === "members" && <GymMembersManager gym={gym} getToken={getToken} onChanged={load} />}
              {section === "profile" && <GymProfileForm key={gym.id} gym={gym} getToken={getToken} onSaved={setGym} />}
              {section === "announcements" && <GymAnnouncementsManager gymId={gym.id} getToken={getToken} />}
              {section === "settings" && <GymSettingsForm gym={gym} getToken={getToken} onSaved={setGym} />}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}
