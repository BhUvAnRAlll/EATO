import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { images } from "@/constants/images";
import { rupees } from "@/lib/mealRules";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi, type MealPlan, type Subscription } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; plan: MealPlan; running: Subscription | null };
const back = () => (router.canGoBack() ? router.back() : router.replace("/meals"));

// Meals › Meal Subscription › a plan's details (Meal Operations phase 5, the user's design, phone 3):
// the plan's mark, name and line beside a bowl; meals a day, kcal a day, protein and water; Plan
// Duration (7 / 28 / 90 days, the longer ones with "Save x%"); What's Included; and "Subscribe for
// ₹x →" (opens the checkout). With a plan already running, subscribing waits until it ends.
export default function PlanDetails() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [days, setDays] = useState<number | null>(null);

  const read = useCallback(async () => {
    const token = await getToken();
    const [plan, mine] = await Promise.all([subscriptionsApi.plan(token, String(slug)), subscriptionsApi.mine(token)]);
    if (!plan.ok) return setLoad({ state: "failed", error: plan.error });
    setLoad({ state: "ready", plan: plan.data.plan, running: mine.ok ? mine.data.current : null });
  }, [getToken, slug]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const plan = load.state === "ready" ? load.plan : null;
  const chosen = plan ? plan.lengths.find((l) => l.days === days) ?? plan.lengths.find((l) => l.days === 28) ?? plan.lengths[plan.lengths.length - 1] : null;
  const running = load.state === "ready" ? load.running : null;

  const stats = plan
    ? ([
        { value: String(plan.mealsPerDay), label: "Meals / Day", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, tint: colors.mealPrimary },
        { value: plan.calories.toLocaleString("en-IN"), label: "kcal / Day", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }, tint: colors.iconPeach },
        { value: `${plan.proteinG} g`, label: "Protein", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }, tint: colors.mealPrimary },
        { value: `${plan.waterL} L`, label: "Water", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" }, tint: colors.iconBlue },
      ] as const)
    : [];

  return (
    <View className="flex-1 bg-surface">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="flex-row items-center px-4" style={{ minHeight: 52 }}>
          <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={{ width: 40 }}>
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={24} tintColor={colors.ink} />
          </Pressable>
          <Text className="flex-1 text-center type-headline text-forest-ink" accessibilityRole="header">Plan Details</Text>
          <View style={{ width: 40 }} />
        </View>
        {load.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the plan" /></View>}
        {load.state === "failed" && <View className="px-4"><LoadError tone="meal" title="This plan couldn't load" message={load.error} onRetry={read} /></View>}
        {plan && chosen && (
          <>
            <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 20 }} showsVerticalScrollIndicator={false}>
              <View>
                <Svg style={{ position: "absolute", top: -60, right: 0 }} width={width * 0.8} height={260}>
                  <Defs>
                    <RadialGradient id="planGlow" cx="75%" cy="35%" r="60%">
                      <Stop offset="0" stopColor={colors.mealLight} stopOpacity={1} />
                      <Stop offset="1" stopColor={colors.surface} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill="url(#planGlow)" />
                </Svg>
                <View className="flex-row items-center px-4" style={{ gap: 8 }}>
                  <View className="min-w-0 flex-1" style={{ gap: 8 }}>
                    <View className="sub-plan__icon" style={{ backgroundColor: colors.mealLight, width: 48, height: 48 }}>
                      <SymbolView name={{ ios: "leaf.fill", android: "eco", web: "eco" }} size={26} tintColor={colors.mealPrimary} />
                    </View>
                    <Text className="shop-title" style={{ fontSize: 26, lineHeight: 32 }}>{plan.name}</Text>
                    <Text className="shop-subtitle">{plan.description}</Text>
                  </View>
                  <Image source={images.authSignupBowl} contentFit="contain" style={{ width: width * 0.4, height: width * 0.36 }} accessibilityIgnoresInvertColors />
                </View>
              </View>

              <View className="flex-row px-4" style={{ gap: 8 }}>
                {stats.map((s) => (
                  <View key={s.label} className="sub-stat" accessibilityLabel={`${s.value} ${s.label}`}>
                    <SymbolView name={s.icon} size={22} tintColor={s.tint} />
                    <Text className="sub-stat__value" numberOfLines={1}>{s.value}</Text>
                    <Text className="sub-stat__label" numberOfLines={1}>{s.label}</Text>
                  </View>
                ))}
              </View>

              <View className="px-4" style={{ gap: 12 }}>
                <Text className="shop-section__title" style={{ fontSize: 20, lineHeight: 26 }} accessibilityRole="header">Plan Duration</Text>
                <View className="flex-row" style={{ gap: 10 }}>
                  {plan.lengths.map((l) => {
                    const on = l.days === chosen.days;
                    return (
                      <PressableScale key={l.days} haptic="select" onPress={() => setDays(l.days)} className={on ? "sub-length sub-length--on" : "sub-length"} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${l.days} days, ${rupees(l.price)}${l.savePercent ? `, save ${l.savePercent}%` : ""}`}>
                        <Text className="sub-length__days">{`${l.days} Days`}</Text>
                        <Text className="sub-length__price">{rupees(l.price)}</Text>
                        {l.savePercent > 0 ? (
                          <View className={on ? "sub-save sub-save--on" : "sub-save"}><Text className={on ? "sub-save__label sub-save__label--on" : "sub-save__label"}>{`Save ${l.savePercent}%`}</Text></View>
                        ) : null}
                        {on ? <View className="sub-check"><SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.white} /></View> : null}
                      </PressableScale>
                    );
                  })}
                </View>
              </View>

              <View className="px-4" style={{ gap: 4 }}>
                <Text className="shop-section__title" style={{ fontSize: 20, lineHeight: 26, marginBottom: 6 }} accessibilityRole="header">{"What's Included"}</Text>
                {plan.included.map((item, i) => (
                  <View key={item} className="flex-row items-center" style={{ gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.creamLine }}>
                    <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={22} tintColor={colors.mealPrimary} />
                    <Text className="type-body text-forest-ink flex-1">{item}</Text>
                  </View>
                ))}
              </View>
              {running ? (
                <View className="px-4"><Text className="meta-text">{`Your ${running.planName} runs until ${new Date(`${running.endsOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}. You can start a new plan after it ends, or cancel it from Manage.`}</Text></View>
              ) : null}
            </ScrollView>
            <View className="px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <PressableScale
                haptic="tap"
                scaleTo={0.98}
                disabled={!!running}
                onPress={() => router.push({ pathname: "/meals/subscribe", params: { plan: plan.slug, days: String(chosen.days) } })}
                className="sub-cta"
                style={running ? { opacity: 0.5 } : undefined}
                accessibilityRole="button"
                accessibilityLabel={`Subscribe for ${rupees(chosen.price)}`}
              >
                <Text className="sub-cta__label">{`Subscribe for ${rupees(chosen.price)}`}</Text>
                <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={18} tintColor={colors.white} />
              </PressableScale>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
