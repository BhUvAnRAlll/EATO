import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";
import { images } from "@/constants/images";
import { rupees } from "@/lib/mealRules";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi, type MealPlan, type Mine } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "off" } | { state: "failed"; error: string } | { state: "ready"; mine: Mine; plans: MealPlan[] };

// Each goal's mark in the plan list (the design: a leaf, an arm, a scale)
const GOAL_ICON: Record<MealPlan["goal"], { icon: SymbolViewProps["name"]; ground: "mealLight" | "tintYellow" | "tintGreen" | "tintBlue"; tint: "mealPrimary" | "iconYellow" | "iconGreen" | "iconBlue" }> = {
  fat_loss: { icon: { ios: "leaf.fill", android: "eco", web: "eco" }, ground: "mealLight", tint: "mealPrimary" },
  muscle_gain: { icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }, ground: "tintYellow", tint: "iconYellow" },
  maintain: { icon: { ios: "scalemass", android: "monitor_weight", web: "monitor_weight" }, ground: "tintGreen", tint: "iconGreen" },
  custom: { icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" }, ground: "tintBlue", tint: "iconBlue" },
};

/** The plan's price for its 28-day (else longest) length, shown "/month" in the list as the design does */
export function monthPrice(plan: MealPlan): number | null {
  const month = plan.lengths.find((l) => l.days === 28) ?? plan.lengths[plan.lengths.length - 1];
  return month?.price ?? null;
}

// The Meals tab's Meal Subscription side (Meal Operations phase 5, the user's design, phone 2): the
// running plan on a green card (meals used of the total, meals left), Pause / Change Plan / Delivery
// / Manage, then every plan to pick from and Subscribe Now (opens the plan's details).
export function SubscriptionTab({ width }: { width: number }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [picked, setPicked] = useState<string | null>(null);

  const read = useCallback(async () => {
    const token = await getToken();
    const [mine, plans] = await Promise.all([subscriptionsApi.mine(token), subscriptionsApi.plans(token)]);
    if (!mine.ok || !plans.ok) {
      const failed = !mine.ok ? mine : plans;
      // Before the server's migration: say what's coming, as before
      if (!failed.ok && failed.status === 503) return setLoad({ state: "off" });
      return setLoad({ state: "failed", error: !failed.ok ? failed.error : "" });
    }
    setLoad({ state: "ready", mine: mine.data, plans: plans.data.plans });
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  if (load.state === "loading") return <View className="items-center py-10"><ActivityIndicator color={colors.mealPrimary} /></View>;
  if (load.state === "failed") return <View className="px-4"><LoadError tone="meal" title="Plans couldn't load" message={load.error} onRetry={read} /></View>;
  if (load.state === "off") {
    return (
      <View className="px-4">
        <EmptyState tone="meal" icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} title="Meal subscriptions are coming" message="Fat loss, muscle gain and maintenance meal plans, delivered every day. Order single meals in the meantime." />
      </View>
    );
  }

  const { mine, plans } = load;
  const current = mine.current;
  const selected = plans.find((p) => p.slug === picked) ?? plans.find((p) => p.id === current?.planId) ?? plans[0] ?? null;
  const usedShare = current && current.mealsTotal > 0 ? Math.min(1, current.mealsUsed / current.mealsTotal) : 0;
  const manage = (section?: string) => current && router.push({ pathname: "/meals/subscription", params: section ? { section } : {} });

  return (
    <View style={{ gap: 18 }}>
      {current && (
        <View className="px-4" style={{ gap: 12 }}>
          <View className="sub-active">
            <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="subActive" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={colors.mealDark} />
                  <Stop offset="1" stopColor={colors.mealPrimary} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#subActive)" />
            </Svg>
            <View className="flex-row items-center" style={{ gap: 12, padding: 14, paddingBottom: 4 }}>
              <Image source={images.authSignupBowl} contentFit="contain" style={{ width: Math.min(130, width * 0.3), height: 84 }} accessibilityIgnoresInvertColors />
              <View className="min-w-0 flex-1" style={{ gap: 4 }}>
                <View className="sub-active__pill">
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: current.pausedNow ? colors.warning : colors.mealPrimary }} />
                  <Text className="sub-active__pill-label">{current.pausedNow ? "Paused" : "Active"}</Text>
                </View>
                <Text className="sub-active__name" numberOfLines={1}>{current.planName}</Text>
                <Text className="sub-active__line" numberOfLines={1}>{`${current.mealsPerDay} Meals / Day  •  ${current.calories.toLocaleString("en-IN")} kcal`}</Text>
              </View>
            </View>
            <View className="sub-active__meter">
              <View className="flex-row justify-between">
                <Text className="sub-active__line" style={{ fontFamily: undefined }}>{`${current.mealsUsed} of ${current.mealsTotal} meals used`}</Text>
                <Text className="sub-active__line">{`${current.mealsLeft} meals left`}</Text>
              </View>
              <View className="sub-active__track">
                <View className="sub-active__fill" style={{ width: `${Math.round(usedShare * 100)}%` }} />
              </View>
            </View>
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            {([
              { label: current.pausedNow || current.pausedFrom ? "Resume" : "Pause", icon: { ios: current.pausedFrom ? "play.circle" : "pause.circle", android: current.pausedFrom ? "play_circle" : "pause_circle", web: current.pausedFrom ? "play_circle" : "pause_circle" }, onPress: () => manage("pause") },
              { label: "Change Plan", icon: { ios: "arrow.left.arrow.right", android: "swap_horiz", web: "swap_horiz" }, onPress: () => manage("plan") },
              { label: "Delivery", icon: { ios: "box.truck", android: "local_shipping", web: "local_shipping" }, onPress: () => manage("delivery") },
              { label: "Manage", icon: { ios: "gearshape.fill", android: "settings", web: "settings" }, onPress: () => manage() },
            ] as const).map((t) => (
              <PressableScale key={t.label} haptic="select" onPress={t.onPress} className="sub-tile" accessibilityRole="button" accessibilityLabel={t.label}>
                <SymbolView name={t.icon} size={22} tintColor={colors.mealPrimary} />
                <Text className="sub-tile__label" numberOfLines={1}>{t.label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      )}

      <View className="px-4" style={{ gap: 10 }}>
        <Text className="shop-section__title" accessibilityRole="header">Explore Meal Subscription Plans</Text>
        {plans.length === 0 ? (
          <Text className="meta-text">No plans yet. Check back soon.</Text>
        ) : (
          plans.map((p) => {
            const on = p.slug === selected?.slug;
            const mark = GOAL_ICON[p.goal];
            const price = monthPrice(p);
            return (
              <PressableScale key={p.slug} haptic="select" scaleTo={0.99} onPress={() => setPicked(p.slug)} className={on ? "sub-plan sub-plan--on" : "sub-plan"} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${p.name}, ${p.tagline}${price ? `, ${rupees(price)} a month` : ""}`}>
                <View className="sub-plan__icon" style={{ backgroundColor: colors[mark.ground] }}>
                  <SymbolView name={mark.icon} size={22} tintColor={colors[mark.tint]} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="sub-plan__name" numberOfLines={1}>{p.name}</Text>
                  <Text className="meta-text" numberOfLines={1}>{p.tagline}</Text>
                </View>
                {price !== null ? (
                  <View>
                    <Text className="sub-plan__price">{rupees(price)}</Text>
                    <Text className="meta-text" style={{ textAlign: "right" }}>/month</Text>
                  </View>
                ) : null}
                <View className={on ? "sub-radio sub-radio--on" : "sub-radio"}>
                  {on ? <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} /> : null}
                </View>
              </PressableScale>
            );
          })
        )}
        {selected ? (
          <PressableScale haptic="tap" scaleTo={0.98} onPress={() => router.push({ pathname: "/meals/plans/[slug]", params: { slug: selected.slug } })} className="sub-cta" style={{ marginTop: 6 }} accessibilityRole="button" accessibilityLabel={`Subscribe now to ${selected.name}`}>
            <Text className="sub-cta__label">Subscribe Now</Text>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={18} tintColor={colors.white} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}
