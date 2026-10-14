import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useClerk, useUser } from "@clerk/expo";

import { dashboards } from "@/data/dashboards";
import type { Role } from "@/lib/roles";
import { colors } from "@/theme";

type DashboardScreenProps = {
  role: Role;
  // Optional full-width content shown above the greeting
  children?: ReactNode;
};

// The landing screen for each role: greeting, the role's main areas and sign out.
export function DashboardScreen({ role, children }: DashboardScreenProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const dashboard = dashboards[role];

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {children}

          <View className="gap-6 p-6">
            <View>
              <Text className="type-overline text-muted">{dashboard.label}</Text>
              <Text className="setup__title mt-2">{user?.firstName ? `Hi, ${user.firstName}!` : "Welcome!"}</Text>
              <Text className="auth__subtitle mt-2">{dashboard.subtitle}</Text>
              <Text className="type-caption mt-1 text-muted">{user?.primaryEmailAddress?.emailAddress}</Text>
            </View>

            <View className="gap-3">
              {dashboard.tiles.map((tile) => (
                <Pressable
                  key={tile.id}
                  className="card flex-row items-center gap-3"
                  disabled={!tile.href}
                  onPress={() => tile.href && router.push(tile.href)}
                  accessibilityRole={tile.href ? "button" : undefined}
                >
                  <View className="card__icon">
                    <SymbolView name={tile.icon} size={20} tintColor={colors.forest} />
                  </View>
                  <View className="flex-1">
                    <Text className="card__title">{tile.title}</Text>
                    <Text className="card__subtitle">{tile.subtitle}</Text>
                  </View>
                  {tile.href ? (
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
                  ) : (
                    <Text className="type-caption text-faint">Soon</Text>
                  )}
                </Pressable>
              ))}
            </View>

            {/* Signing out removes this screen; the start screen then opens onboarding */}
            <Pressable onPress={() => signOut()} className="btn-outline">
              <Text className="btn-outline__label">Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
