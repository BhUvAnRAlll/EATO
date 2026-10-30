import type { ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { colors } from "@/theme";

// The shell every "Rebuild my plan" step sits in: a bar (back, a three-node stepper, close), a
// heading block, the step's fields in a keyboard-aware scroll view, and a footer.

const STEPS = ["Basic", "Goals", "Fitness"];
// Whole class names (Tailwind only builds classes it can read in full in the source)
const NODE_CLASS = { done: "recreate__node recreate__node--done", active: "recreate__node recreate__node--active", todo: "recreate__node recreate__node--todo" } as const;

// Every choice tap and number nudge gives a light selection tick
export const tap = () => {
  Haptics.selectionAsync().catch(() => {});
};

// Leaving the flow returns to Preferences (where it starts), whatever step it was on
export const leaveRecreate = () => router.dismissTo("/workout/preferences");

type FrameProps = {
  step: 1 | 2 | 3 | "review";
  title: string;
  subtitle: string;
  aside?: { title: string; text: string };
  notice?: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
  secondary?: { label: string; onPress: () => void };
  footnote?: string;
};

export function RecreateFrame({ step, title, subtitle, aside, notice, children, primaryLabel, onPrimary, primaryDisabled = false, busy = false, secondary, footnote }: FrameProps) {
  // A full-screen modal may report no top inset, so it is applied by hand
  const insets = useSafeAreaInsets();
  // On narrow phones the stepper keeps its numbered nodes and drops the short names
  const showNames = useWindowDimensions().width >= 380;
  const at = step === "review" ? 4 : step;
  const back = () => (router.canGoBack() ? router.back() : leaveRecreate());
  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top + 8 }}>
      <StatusBar style="dark" />
      <View className="flex-row items-center gap-3 px-5">
        <RoundButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
        <View className="flex-1 flex-row items-center justify-center gap-1.5" accessibilityLabel={step === "review" ? "Review" : `Step ${step} of 3`}>
          {STEPS.map((name, i) => {
            const n = i + 1;
            const state: keyof typeof NODE_CLASS = n < at ? "done" : n === at ? "active" : "todo";
            return (
              <View key={name} className="flex-row items-center gap-1.5">
                {i > 0 && <View className="recreate__line" style={{ backgroundColor: n <= at ? colors.ink : colors.creamLine }} />}
                <View className={NODE_CLASS[state]}>
                  {state === "done" ? (
                    <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={11} tintColor={colors.white} />
                  ) : (
                    <Text className={state === "active" ? "recreate__node-label recreate__node-label--active" : "recreate__node-label"}>{n}</Text>
                  )}
                </View>
                {showNames && <Text className="recreate__node-name">{name}</Text>}
              </View>
            );
          })}
        </View>
        <RoundButton icon={{ ios: "xmark", android: "close", web: "close" }} label="Close" onPress={leaveRecreate} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View className="gap-1.5">
            <Text className="type-overline text-muted">{step === "review" ? "Review & create" : `Step ${step} of 3`}</Text>
            <Text className="type-title text-forest-ink">{title}</Text>
            <Text className="home__note">{subtitle}</Text>
          </View>
          {aside && (
            <View className="home__card gap-0.5">
              <Text className="card__title">{aside.title}</Text>
              <Text className="post__time">{aside.text}</Text>
            </View>
          )}
          {notice && (
            <View className="info-banner">
              <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.inkSoft} />
              <Text className="info-banner__text">{notice}</Text>
            </View>
          )}
          {children}
          {footnote && <Text className="home__note text-center">{footnote}</Text>}
        </ScrollView>

        <View className="flex-row gap-3 border-t border-cream-line px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
          {secondary && (
            <Pressable onPress={secondary.onPress} className="btn-outline" style={{ width: 120 }} accessibilityRole="button" accessibilityLabel={secondary.label}>
              <Text className="btn-outline__label">{secondary.label}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onPrimary}
            disabled={primaryDisabled || busy}
            className="btn-forest flex-1"
            style={{ opacity: primaryDisabled || busy ? 0.45 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ disabled: primaryDisabled || busy }}
            accessibilityLabel={primaryLabel}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{primaryLabel}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// One question: its label, the answer control, and an error once a Continue has failed. The
// groups fade in one after another (about 60 ms apart), unless the phone asks for less motion.
export function RecreateField({ index, label, hint, error, children }: { index: number; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(250).reduceMotion(ReduceMotion.System)} className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="setup__section">{label}</Text>
        {hint && <Text className="post__time">{hint}</Text>}
      </View>
      {children}
      {error && (
        <Text className="home__note" style={{ color: colors.forestInk }} accessibilityRole="alert">
          {`⚠︎ ${error}`}
        </Text>
      )}
    </Animated.View>
  );
}

export function RoundButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof SymbolView>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full bg-surface" accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={16} tintColor={colors.forestInk} />
    </Pressable>
  );
}
