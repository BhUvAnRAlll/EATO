import type { ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { setupSteps, type SetupStep } from "@/data/setup";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";
import { confirmChoice } from "@/lib/nativeSheets";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

type SetupScreenProps = {
  // Left out on the body scan screens, which run after setup (no progress shown)
  step?: SetupStep;
  title: string;
  subtitle: string;
  children: ReactNode;
  onNext: () => void;
  nextLabel?: string;
  canContinue?: boolean;
  loading?: boolean;
  // Replaces the default Back behaviour (previous step / leave setup)
  onBack?: () => void;
  // false hides the step counter (the scan screens opened from Profile, outside setup)
  showProgress?: boolean;
};

// Shared frame for every setup step: back chevron and dashed progress, a centred title and
// subtitle, the step's content, and one full-width primary button at the bottom
export function SetupScreen({
  step,
  title,
  subtitle,
  children,
  onNext,
  nextLabel = "Next",
  canContinue = true,
  loading = false,
  onBack,
  showProgress = true,
}: SetupScreenProps) {
  const colors = useThemeColors();
  const steps = setupSteps;
  const index = step ? Math.max(0, steps.indexOf(step)) : -1;
  const isFirst = index === 0;

  // Previous step. On the first step there is nothing behind it (login was
  // cleared), so offer to leave setup: sign out, clear the answers (so they
  // can't pre-fill another account) and return to Log in.
  const handleBack = () => {
    if (onBack) return onBack();
    if (!isFirst) return router.back();
    const question = "Leave setup?";
    const detail = "You'll be signed out and your answers so far won't be saved.";
    const leave = async () => {
      await useAuthStore.getState().signOut(); // also clears the setup answers
      router.replace("/sign-in");
    };
    confirmChoice({ title: question, message: detail, confirmLabel: "Sign out", cancelLabel: "Stay" }).then((ok) => {
      if (ok) void leave();
    });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header: back chevron, one dash per step (done ones dark), and the step count */}
        <View className="screen-bar">
          <PressableScale onPress={handleBack} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </PressableScale>
          {/* Outside the setup flow (Profile › Height & weight) the bar carries the title, like every
              other pushed screen, and the lead stays under it */}
          {showProgress ? (
            <View className="flex-1 flex-row items-center justify-center gap-1.5">
              {steps.map((name, stepIndex) => (
                <View key={name} className={stepIndex <= index ? "setup__dash setup__dash--done" : "setup__dash"} />
              ))}
            </View>
          ) : (
            <Text className="screen-bar__title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} accessibilityRole="header">{title}</Text>
          )}
          <View className="h-11 w-11 items-end justify-center">{showProgress && <Text className="setup__step">{`${index + 1}/${steps.length}`}</Text>}</View>
        </View>

        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            {showProgress && <Text className="setup__title text-center">{title}</Text>}
            <Text className={showProgress ? "auth__subtitle mt-2 text-center" : "auth__subtitle text-center"}>{subtitle}</Text>
            <View className="mt-7">{children}</View>
          </ScrollView>

          {/* Footer: one full-width primary action (Back is the chevron at the top) */}
          <View className="px-6 pb-2 pt-3">
            <PrimaryButton label={nextLabel} onPress={onNext} disabled={!canContinue} loading={loading} />
          </View>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
