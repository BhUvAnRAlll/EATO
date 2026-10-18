import { useCallback, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type ManageShellProps = {
  title: string;
  // Who may open the page: gym admins (manage), or staff who can invite
  need?: "manage" | "invite";
  children: (gym: Gym, reload: () => Promise<void>, setGym: (gym: Gym) => void) => ReactNode;
  footer?: (gym: Gym) => ReactNode;
};

// The frame shared by a gym's staff pages: a bar with the title and the gym's name, the gym
// loaded (again each time the page is shown), and a friendly refusal for anyone without the
// role. The server checks every change again whatever this shows.
export function ManageShell({ title, need = "manage", children, footer }: ManageShellProps) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.get(await getToken(), id);
    if (result.ok) {
      setGym(result.data.gym);
      setError(null);
    } else setError(result.error);
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const allowed = gym ? (need === "manage" ? gym.can.manage : gym.can.invite) : false;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1}>{title}</Text>
            {gym && <Text className="gym-card__meta" numberOfLines={1}>{gym.name}</Text>}
          </View>
          <View className="screen-bar__back" />
        </View>
        {!gym ? (
          <View className="px-5 pt-4">{error ? <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title="Can't open this page" text={error} actionLabel="Retry" onAction={load} /> : <PostSkeleton />}</View>
        ) : !allowed ? (
          <View className="px-5 pt-4">
            <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title={need === "manage" ? "Admins only" : "Staff only"} text={need === "manage" ? "Only the gym's owner and admins can manage it." : "Only the gym's staff can invite people."} />
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {children(gym, load, setGym)}
            </ScrollView>
            {footer && <View className="compose__footer">{footer(gym)}</View>}
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}
