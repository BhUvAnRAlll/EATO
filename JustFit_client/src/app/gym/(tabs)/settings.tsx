import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { SymbolView } from "@/components/SymbolView";
import { gymApi } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// Gym admin › Settings: who is signed in, their gym (the justFit team edits it), and Sign out
export default function GymSettings() {
  const colors = useThemeColors();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "Gym admin";
  const { result } = useGymData(gymApi.dashboard);
  const gym = result.state === "ready" ? result.data.gym : null;

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <Text className="gym-header__name flex-1" accessibilityRole="header">Settings</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View className="gym-card gym-tx">
            <View className="gym-avatar">
              <Text className="gym-avatar__label">{name.charAt(0).toUpperCase()}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="gym-tx__name" numberOfLines={1}>{name}</Text>
              <Text className="gym-tx__meta" numberOfLines={1}>{user?.phone ? `Gym admin · ${user.phone}` : "Gym admin"}</Text>
            </View>
          </View>
          {gym && (
            <View className="gym-card gym-tx">
              <View className="gym-sms__icon">
                <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={18} tintColor={colors.gymPrimary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="gym-tx__name" numberOfLines={1}>{gym.name}</Text>
                <Text className="gym-tx__meta" numberOfLines={2}>{`${gym.area}, ${gym.city}`}</Text>
              </View>
            </View>
          )}
          <Pressable onPress={() => useAuthStore.getState().signOut()} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel="Sign out">
            <SymbolView name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} size={18} tintColor={colors.danger} />
            <Text className="gym-tx__name flex-1" style={{ color: colors.danger }}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
