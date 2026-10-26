import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { intakeSteps, type IntakeStep } from "@/data/coach";
import { colors } from "@/theme";

type IntakeFrameProps = {
  step: IntakeStep;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onNext: () => void;
  nextLabel?: string;
  canContinue?: boolean;
  loading?: boolean;
};

// Shared frame for every AI Coach intake step, on the soft grey page: a round white back
// button, the centred "AI Coach" title and the step count, a thin progress bar, the step's
// title and content, and one dark pill button at the bottom.
export function IntakeFrame({ step, title, subtitle, children, onNext, nextLabel = "Continue", canContinue = true, loading = false }: IntakeFrameProps) {
  const index = Math.max(0, intakeSteps.indexOf(step));
  const back = () => (router.canGoBack() ? router.back() : router.replace("/coach"));

  return (
    <View className="flex-1 bg-surface-alt">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-14 flex-row items-center justify-between px-5">
          <Pressable onPress={back} hitSlop={8} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={18} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead text-forest-ink">AI Coach</Text>
          <View className="coach__step" accessibilityLabel={`Step ${index + 1} of ${intakeSteps.length}`}>
            <Text className="coach__step-label">{`${index + 1}/${intakeSteps.length}`}</Text>
          </View>
        </View>
        <View className="coach__track mx-5">
          <View className="h-full rounded-pill bg-forest" style={{ width: `${((index + 1) / intakeSteps.length) * 100}%` }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View className="gap-1.5">
              <Text className="setup__title">{title}</Text>
              {subtitle && <Text className="home__lead">{subtitle}</Text>}
            </View>
            {children}
          </ScrollView>

          <View className="px-5 pb-2 pt-3">
            <PrimaryButton label={nextLabel} onPress={onNext} disabled={!canContinue} loading={loading} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
