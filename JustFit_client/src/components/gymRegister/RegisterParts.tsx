import { useEffect, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import type { Application } from "@/lib/gymRegistration";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useGymRegistration } from "@/store/gymRegistration";

// The frame every Register your gym screen shares: the header, a scroll that keeps the keyboard
// out of the way, and an optional action pinned at the bottom
export function RegisterFrame({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={title} subtitle={subtitle} fallback="/gym-register" />
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {action ? <View className="bg-cream px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>{action}</View> : null}
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}

/**
 * The open application for a section screen: loads it when the overview hasn't, and shows the
 * loading, failed and "nothing to edit" states itself. render gets the application to edit.
 */
export function WithApplication({ title, render }: { title: string; render: (app: Application) => ReactNode }) {
  const getToken = useSessionToken();
  const load = useGymRegistration((state) => state.load);
  const read = useGymRegistration((state) => state.read);
  useEffect(() => {
    if (load.state === "loading") getToken().then(read).catch(() => {});
  }, [load.state, getToken, read]);

  if (load.state === "loading") return <RegisterFrame title={title}><ScreenSkeleton cards={3} label="Loading your application" /></RegisterFrame>;
  if (load.state === "failed") {
    return (
      <RegisterFrame title={title}>
        <View className="card" style={{ gap: 12 }}>
          <FormAlert message={load.error} />
          <PrimaryButton label="Try again" onPress={async () => read(await getToken().catch(() => null))} />
        </View>
      </RegisterFrame>
    );
  }
  const app = load.data.current;
  if (!app || !app.canEdit) {
    return (
      <RegisterFrame title={title}>
        <View className="card" style={{ gap: 12 }}>
          <Text className="type-body text-muted">{app ? "Your application is with justFit for review, so it can't be changed now." : "Start an application first."}</Text>
          <PrimaryButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/gym-register"))} />
        </View>
      </RegisterFrame>
    );
  }
  return <>{render(app)}</>;
}

/** One pickable option; several in a row wrap */
export function OptionChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      className={on ? "setup__chip setup__chip--selected" : "setup__chip"}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{label}</Text>
    </Pressable>
  );
}
