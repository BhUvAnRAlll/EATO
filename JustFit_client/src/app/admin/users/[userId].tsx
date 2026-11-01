import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { Avatar } from "@/components/Avatar";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, adminPortal, type AdminUser } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

// Super Admin › a user's page: when they joined, and how many meals they logged, workouts they
// finished and orders they placed. Read only.

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/users"));

export default function AdminUserDetail() {
  const colors = useThemeColors();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const getToken = useSessionToken();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await adminPortal.user(await getToken().catch(() => null), userId);
    if (result.ok) {
      setUser(result.data.user);
      setError(null);
    } else setError(result.error);
  }, [getToken, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const { refreshControl } = usePullToRefresh(load);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1}>{user?.name ?? "Account"}</Text>
            {user && <Text className="screen-bar__subtitle">{KIND_LABEL[user.kind]}</Text>}
          </View>
          <View className="screen-bar__spacer" />
        </View>

        {!user ? (
          <View className="px-5 pt-6">
            {error ? (
              <DashedBlock icon={{ ios: "person.slash", android: "person_off", web: "person_off" }} title="Can't open this account" text={`${error.replace(/\.$/, "")}. Tap to try again.`} onPress={load} />
            ) : (
              <View className="items-center py-16"><ActivityIndicator color={colors.leaf} /></View>
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
            <View className="admin-list flex-row items-center gap-3" style={{ padding: 16 }}>
              <Avatar member={{ id: user.id, name: user.name, initial: user.name.charAt(0).toUpperCase() }} size={64} />
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="type-subhead text-forest-ink" numberOfLines={1}>{user.name}</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  <Pill label={KIND_LABEL[user.kind]} />
                </View>
                {user.joinedAt && <Text className="meta-text">{`Joined ${new Date(user.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}</Text>}
              </View>
            </View>

            <View className="flex-row" style={{ gap: 10 }}>
              {(
                [
                  ["Meals logged", user.counts.meals, { ios: "fork.knife", android: "restaurant", web: "restaurant" }],
                  ["Workouts", user.counts.workouts, { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }],
                  ["Orders", user.counts.orders, { ios: "shippingbox", android: "inventory_2", web: "inventory_2" }],
                ] as [string, number, Icon][]
              ).map(([label, value, icon]) => (
                <View key={label} className="admin-stat" accessibilityLabel={`${label}: ${value}`}>
                  <SymbolView name={icon} size={18} tintColor={colors.forestInk} />
                  <Text className="admin-stat__label">{label}</Text>
                  <Text className="admin-stat__value">{value}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Pill({ label }: { label: string }) {
  const colors = useThemeColors();
  return (
    <View className="workout__pill" style={{ backgroundColor: colors.inkFill }}>
      <Text className="workout__pill-label" style={{ color: colors.white }}>{label}</Text>
    </View>
  );
}
