import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { LoadError } from "@/components/macro/LoadError";
import { PaymentCheckout, type CheckoutResult } from "@/components/meals/PaymentCheckout";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KIND_LABEL, addressLines } from "@/lib/addressRules";
import { newId } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { SLOT_LABEL, addDays, dayLabel, rupees } from "@/lib/mealRules";
import type { CheckoutOptions } from "@/lib/mealsApi";
import { todayIso } from "@/lib/macro";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi, type MealPlan } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

const START_DAYS = 7; // starts offered: tomorrow and the six days after (the server allows two weeks)

// Meals › a plan › Subscribe (Meal Operations phase 5): when it starts, where it's delivered, what
// it is (meals a day, how many meals in all, the meal times) and Pay, which opens the same test
// checkout as an order; the server checks the payment's signature before the plan starts.
export default function Subscribe() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const params = useLocalSearchParams<{ plan: string; days: string }>();
  const { load: addressLoad } = useAddressBook();
  const [plan, setPlan] = useState<{ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; plan: MealPlan }>({ state: "loading" });
  const today = todayIso();
  const [startsOn, setStartsOn] = useState(addDays(today, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<{ subId: string; options: CheckoutOptions } | null>(null);
  // One request id per subscription: Pay tapped again reopens the same checkout
  const clientId = useRef(newId());
  const running = useRef(false);

  const read = useCallback(async () => {
    const answer = await subscriptionsApi.plan(await getToken(), String(params.plan));
    setPlan(answer.ok ? { state: "ready", plan: answer.data.plan } : { state: "failed", error: answer.error });
  }, [getToken, params.plan]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const p = plan.state === "ready" ? plan.plan : null;
  const length = p?.lengths.find((l) => String(l.days) === params.days) ?? null;
  const address = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault) ?? null : null;
  const ready = !!p && !!length && !!address?.deliverable;

  const started = () => {
    clientId.current = newId();
    hud.success("Plan started");
    router.replace("/meals/subscription");
  };

  const pay = async () => {
    if (!ready || running.current || !p || !length || !address) return;
    running.current = true;
    setBusy(true);
    setError("");
    haptic.tap();
    const answer = await subscriptionsApi.subscribe(await getToken(), { clientId: clientId.current, planId: p.id, days: length.days, startsOn, addressId: address.id });
    running.current = false;
    setBusy(false);
    if (!answer.ok) {
      setError(answer.error);
      if (answer.status === 409) clientId.current = newId();
      return;
    }
    if (!answer.data.checkout) return started();
    setCheckout({ subId: answer.data.subscription.id, options: answer.data.checkout });
  };

  const checkoutDone = useCallback(async (result: CheckoutResult) => {
    const open = checkout;
    setCheckout(null);
    if (!open) return;
    if (!result.ok) {
      if (result.cancelled) subscriptionsApi.paymentFailed(await getToken(), open.subId, open.options.order_id, "Checkout closed");
      setError(result.cancelled ? "Payment cancelled. Tap Pay to try again." : result.reason);
      return;
    }
    running.current = true;
    setBusy(true);
    const verified = await subscriptionsApi.verifyPayment(await getToken(), open.subId, result.paid);
    running.current = false;
    setBusy(false);
    if (!verified.ok) {
      setError(verified.error);
      if (verified.status === 409) clientId.current = newId();
      return;
    }
    started();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, getToken]);

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Subscribe" subtitle={p?.name} fallback="/meals" />
        {plan.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the plan" /></View>}
        {plan.state === "failed" && <View className="px-4"><LoadError tone="meal" title="This plan couldn't load" message={plan.error} onRetry={read} /></View>}
        {p && !length && <View className="px-4"><LoadError tone="meal" title="That length isn't offered" message="Go back and pick 7, 28 or 90 days." onRetry={() => router.back()} /></View>}
        {p && length && (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} showsVerticalScrollIndicator={false}>
              <View className="card" style={{ gap: 6 }}>
                <Text className="card__title">{`${p.name} · ${length.days} days`}</Text>
                <Text className="meta-text">{`${p.mealsPerDay} meals a day (${p.slots.map((s) => SLOT_LABEL[s].toLowerCase()).join(", ")}) · ${length.days * p.mealsPerDay} meals in all · ${p.calories.toLocaleString("en-IN")} kcal a day`}</Text>
                <Text className="meta-text">{"A meal counts as used only when it's delivered. Pausing or skipping a day moves your end date on."}</Text>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink">Starts on</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {Array.from({ length: START_DAYS }, (_, i) => addDays(today, i + 1)).map((d) => {
                    const on = d === startsOn;
                    return (
                      <PressableScale key={d} haptic="select" onPress={() => setStartsOn(d)} className={on ? "meal-choice meal-choice--on" : "meal-choice"} style={{ minWidth: 84 }} accessibilityRole="button" accessibilityState={{ selected: on }}>
                        <Text className="meal-choice__label">{dayLabel(d, today).split(",")[0]}</Text>
                        <Text className="meal-choice__meta">{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
                <Text className="meta-text">{`Ends ${new Date(`${addDays(startsOn, length.days - 1)}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} (later if you pause or skip)`}</Text>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink">Delivered to</Text>
                <PressableScale onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel="Change the delivery address">
                  <View className="meal-icon"><SymbolView name={{ ios: "mappin.circle.fill", android: "location_on", web: "location_on" }} size={18} tintColor={colors.mealDark} /></View>
                  <View className="min-w-0 flex-1">
                    {address ? (
                      <>
                        <Text className="card__title">{KIND_LABEL[address.kind]}</Text>
                        <Text className="meta-text" numberOfLines={2}>{`${addressLines(address).first}, ${addressLines(address).second}`}</Text>
                        {!address.deliverable ? <Text className="meta-text" style={{ color: colors.danger }}>{"We don't deliver here yet. Pick another address."}</Text> : null}
                      </>
                    ) : (
                      <Text className="card__title">Add a delivery address</Text>
                    )}
                  </View>
                  <Text className="meal-link">Change</Text>
                </PressableScale>
              </View>

              <View className="card" style={{ gap: 8 }}>
                <View className="flex-row justify-between"><Text className="type-body text-muted">{`${length.days} days`}</Text><Text className="type-body text-forest-ink">{rupees(length.price)}</Text></View>
                {length.savePercent > 0 ? <View className="flex-row justify-between"><Text className="type-body text-muted">You save</Text><Text className="type-body" style={{ color: colors.mealDark }}>{`${length.savePercent}%`}</Text></View> : null}
                <View className="flex-row justify-between pt-2" style={{ borderTopWidth: 1, borderColor: colors.mealLine }}>
                  <Text className="card__title">To pay</Text>
                  <Text className="card__title">{rupees(length.price)}</Text>
                </View>
                <Text className="meta-text">Payments are in test mode: Pay opens a test checkout and no money is taken.</Text>
              </View>
              {error ? <FormAlert message={error} /> : null}
            </ScrollView>
            <View className="px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <PressableScale haptic="tap" scaleTo={0.98} onPress={pay} disabled={!ready || busy} className="sub-cta" style={!ready ? { opacity: 0.5 } : undefined} accessibilityRole="button" accessibilityLabel={`Pay ${rupees(length.price)}`}>
                {busy ? <ActivityIndicator color={colors.white} /> : null}
                <Text className="sub-cta__label">{busy ? "Processing…" : `Pay ${rupees(length.price)}`}</Text>
              </PressableScale>
            </View>
          </>
        )}
      </SafeAreaView>
      {checkout && <PaymentCheckout options={checkout.options} onDone={checkoutDone} />}
    </View>
  );
}
