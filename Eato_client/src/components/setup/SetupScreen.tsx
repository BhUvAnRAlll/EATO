import type { ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";
import { useClerk } from "@clerk/expo";

import { PrimaryButton } from "@/components/PrimaryButton";
import { setupSteps, type SetupStep } from "@/data/setup";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";

type SetupScreenProps = {
  step: SetupStep;
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
  const steps = setupSteps;
  const index = Math.max(0, steps.indexOf(step));
  const isFirst = index === 0;
  const { signOut } = useClerk();

  // Previous step. On the first step there is nothing behind it (login was
  // cleared), so offer to leave setup: sign out, clear the answers (so they
  // can't pre-fill another account) and return to Log in.
  const handleBack = () => {
    if (onBack) return onBack();
    if (!isFirst) return router.back();
    Alert.alert("Leave setup?", "You'll be signed out and your answers so far won't be saved.", [
      { text: "Stay", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          useSetupStore.getState().reset();
          router.replace("/sign-in");
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header: back chevron, one dash per step (done ones dark), and the step count */}
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={handleBack} hitSlop={12} className="h-10 w-10 justify-center" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <View className="flex-1 flex-row items-center justify-center gap-1.5">
            {showProgress &&
              steps.map((name, stepIndex) => (
                <View key={name} className={stepIndex <= index ? "setup__dash setup__dash--done" : "setup__dash"} />
              ))}
          </View>
          <View className="h-10 w-10 items-end justify-center">{showProgress && <Text className="setup__step">{`${index + 1}/${steps.length}`}</Text>}</View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text className="setup__title text-center">{title}</Text>
            <Text className="auth__subtitle mt-2 text-center">{subtitle}</Text>
            <View className="mt-7">{children}</View>
          </ScrollView>

          {/* Footer: one full-width primary action (Back is the chevron at the top) */}
          <View className="px-6 pb-2 pt-3">
            <PrimaryButton label={nextLabel} onPress={onNext} disabled={!canContinue} loading={loading} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
