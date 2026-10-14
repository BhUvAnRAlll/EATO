import type { ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { useClerk } from "@clerk/expo";

import { PrimaryButton } from "@/components/PrimaryButton";
import { images } from "@/constants/images";
import { visibleSetupSteps, type SetupStep } from "@/data/setup";
import { hasSegmentalData } from "@/lib/nutrition";
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
  // Illustration in the top-right corner, beside the title
  headerArt?: ImageSourcePropType;
};

// Shared frame for every setup step: back arrow, logo, progress bar, title, footer buttons
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
  headerArt,
}: SetupScreenProps) {
  // Progress counts the steps this member actually goes through: the review step appears once
  // a sheet is uploaded, the segmental step once a sheet with a segmental analysis is confirmed
  const { reportDraft, report } = useSetupStore();
  const sheet = report ?? reportDraft;
  const steps = visibleSetupSteps({ hasReport: sheet !== null, hasSegmental: sheet !== null && hasSegmentalData(sheet) });
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
        {/* Header */}
        <View className="h-11 flex-row items-center justify-center px-5">
          <Pressable onPress={handleBack} hitSlop={12} className="absolute left-5">
            <SymbolView
              name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
              size={20}
              tintColor={colors.forestInk}
            />
          </Pressable>
          <Image source={images.eatoWordmark} contentFit="contain" style={{ width: 84, height: 34 }} />
        </View>

        {/* Progress */}
        <View className="mt-2 flex-row items-center gap-3 px-6">
          <View className="setup__progress">
            <View className="setup__progress-fill" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </View>
          <Text className="setup__step">
            {index + 1}/{steps.length}
          </Text>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Drawn first so the step's content sits on top where they meet */}
            {headerArt && (
              <Image
                source={headerArt}
                contentFit="contain"
                style={{ position: "absolute", top: 9, right: 16, width: 108, height: 110 }}
              />
            )}
            {/* Leave room beside the art so the subtitle wraps before it */}
            <View style={headerArt ? { paddingRight: 104 } : undefined}>
              <Text className="setup__title">{title}</Text>
              <Text className="auth__subtitle mt-1.5">{subtitle}</Text>
            </View>
            <View className="mt-5">{children}</View>
          </ScrollView>

          {/* Footer */}
          {/* Next gets a little more width (4 : 5) so longer labels like "Skip, I'll enter manually" fit */}
          <View className="flex-row gap-2 px-6 pb-2 pt-3">
            <Pressable onPress={handleBack} className="btn-outline flex-4">
              <Text className="btn-outline__label">Back</Text>
            </Pressable>
            <View className="flex-5">
              <PrimaryButton label={nextLabel} onPress={onNext} disabled={!canContinue} loading={loading} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
