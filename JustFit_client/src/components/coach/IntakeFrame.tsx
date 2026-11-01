import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { CoachButton } from "@/components/coach/CoachButton";
import { intakeSteps, type IntakeStep } from "@/data/coach";
import { useThemeColors } from "@/theme";

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

// Shared frame for every AI Coach intake step, on the coach's pink-washed page: a round white
// back button and the step count, one progress segment per step, the red "AI Coach" label over
// the step's title and lead, the content, and the red arrow button at the bottom.
export function IntakeFrame({ step, title, subtitle, children, onNext, nextLabel = "Continue", canContinue = true, loading = false }: IntakeFrameProps) {
  const colors = useThemeColors();
  const index = Math.max(0, intakeSteps.indexOf(step));
  const back = () => (router.canGoBack() ? router.back() : router.replace("/coach"));

  return (
    <View className="coach__page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-14 flex-row items-center justify-between px-6">
          <Pressable onPress={back} hitSlop={8} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="coach__count" accessibilityLabel={`Step ${index + 1} of ${intakeSteps.length}`}>{`${index + 1}/${intakeSteps.length}`}</Text>
        </View>
        <View className="mb-2 mt-3 flex-row gap-1.5 px-6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {intakeSteps.map((name, i) => (
            <View key={name} className={i <= index ? "coach__segment coach__segment--done" : "coach__segment"} />
          ))}
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, gap: 20 }} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false}>
            <View>
              <Text className="coach__eyebrow">AI Coach</Text>
              <Text className="coach__title mt-1.5" accessibilityRole="header">{title}</Text>
              {subtitle && <Text className="coach__lead mt-2">{subtitle}</Text>}
            </View>
            {children}
          </ScrollView>

          <View className="px-6 pb-2 pt-3">
            <CoachButton label={nextLabel} onPress={onNext} disabled={!canContinue} loading={loading} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
