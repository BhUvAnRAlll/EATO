import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { LoadError } from "@/components/macro/LoadError";
import { DietMark } from "@/components/meals/DietMark";
import { PaymentCheckout, type CheckoutResult } from "@/components/meals/PaymentCheckout";
import { PressableScale } from "@/components/PressableScale";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KIND_LABEL, addressLines } from "@/lib/addressRules";
import { newId } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { DIET_LABEL, MEAL_SLOTS, SLOT_LABEL, addDays, dayLabel, rupees, timeRange, type MealSlot } from "@/lib/mealRules";
import { mealImage, mealsApi, type CheckoutOptions, type MenuMeal, type Slots } from "@/lib/mealsApi";
import { todayIso } from "@/lib/macro";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { subscriptionPrice } from "@/lib/subscriptionRules";
import { subscriptionsApi, type SubscriptionLength } from "@/lib/subscriptionsApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const START_DAYS = 7; // chips for tomorrow and the six days after; the calendar reaches the server's two weeks
const LATEST_START_DAYS = 14;
const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; meal: MenuMeal; length: SubscriptionLength | null; slots: Slots };

// A meal › Add Subscription (2026-11-10, in the meal page's look: the photo, the name and price, the
// plan picked on a green-edged card): then when it starts, the meal time, where it's delivered, the
// bill and Pay (pinned like the meal page's bar), which opens the same
// test checkout as an order; the server prices it again and checks the payment's signature before
// it starts. Then Profile › My subscriptions.
export default function Subscribe() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const params = useLocalSearchParams<{ meal: string; length: string; quantity: string }>();
  const quantity = Math.max(1, Math.min(3, Number(params.quantity) || 1));
  const { load: addressLoad } = useAddressBook();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const today = todayIso();
  const [startsOn, setStartsOn] = useState(addDays(today, 1));
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<{ subId: string; options: CheckoutOptions } | null>(null);
  // One request id per subscription: Pay tapped again reopens the same checkout
  const clientId = useRef(newId());
  const running = useRef(false);

  const read = useCallback(async () => {
    const t = await getToken();
    const [meal, lengths, options] = await Promise.all([mealsApi.meal(t, String(params.meal)), subscriptionsApi.lengths(t), mealsApi.options(t)]);
    if (!meal.ok) return setLoad({ state: "failed", error: meal.error });
    if (!lengths.ok) return setLoad({ state: "failed", error: lengths.error });
    if (!options.ok) return setLoad({ state: "failed", error: options.error });
    const slots = options.data.slots;
    setLoad({ state: "ready", meal: meal.data.meal, length: lengths.data.lengths.find((l) => String(l.id) === params.length) ?? null, slots });
    // Lunch first when it's delivered, else the first meal time that is
    setSlot((current) => current ?? (slots.lunch.active ? "lunch" : MEAL_SLOTS.find((s) => slots[s].active) ?? null));
  }, [getToken, params.meal, params.length]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const ready = load.state === "ready" ? load : null;
  const meal = ready?.meal ?? null;
  const length = ready?.length ?? null;
  const address = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault) ?? null : null;
  const price = meal && length ? subscriptionPrice(meal.price, quantity, length.days, length.percentOff) : null;
  const canPay = !!meal && !!length && !!slot && !!address?.deliverable;

  const started = () => {
    clientId.current = newId();
    hud.success("Subscription started");
    router.replace("/meals/subscriptions");
  };

  const pay = async () => {
    if (!canPay || running.current || !meal || !length || !slot || !address) return;
    running.current = true;
    setBusy(true);
    setError("");
    haptic.tap();
    const answer = await subscriptionsApi.subscribe(await getToken(), { clientId: clientId.current, mealId: meal.id, lengthId: length.id, quantity, slot, startsOn, addressId: address.id });
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
  }, [checkout, getToken]);

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Meal Subscription" fallback="/meals" />
        {load.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the subscription" /></View>}
        {load.state === "failed" && <View className="px-4"><LoadError tone="meal" title="This subscription couldn't load" message={load.error} onRetry={read} /></View>}
        {meal && !length && <View className="px-4"><LoadError tone="meal" title="That length isn't offered now" message="Go back and pick another length." onRetry={() => router.back()} /></View>}
        {meal && length && price && ready && (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }} showsVerticalScrollIndicator={false}>
              <View className="meal__card" style={{ aspectRatio: 5 / 3 }}>
                <Image source={mealImage(meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} transition={150} accessibilityLabel={meal.name} />
              </View>
              <View style={{ gap: 4 }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <DietMark diet={meal.diet} />
                  <Text className="meta-text">{DIET_LABEL[meal.diet]}</Text>
                </View>
                <Text className="shop-title" style={{ fontSize: 24, lineHeight: 32 }} accessibilityRole="header">{meal.name}</Text>
                <View className="flex-row items-baseline" style={{ gap: 6 }}>
                  <Text className="shop-title" style={{ fontSize: 22, lineHeight: 30 }}>{rupees(meal.price)}</Text>
                  <Text className="type-body text-forest-ink">per meal</Text>
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="meal-section__title">Your plan</Text>
                <View className="meal-plan-card">
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="meal-length__label" style={{ textAlign: "left" }}>{length.label}</Text>
                    <Text className="meal-length__meals">{`${length.days * quantity} meals · ${quantity} a day`}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="meal-length__price" style={{ marginTop: 0 }}>{rupees(price.total)}</Text>
                    {length.percentOff > 0 ? <View className="meal-off"><Text className="meal-off__label">{`${length.percentOff}% off`}</Text></View> : null}
                  </View>
                </View>
                <View className="meal-info-row">
                  <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={19} tintColor={colors.ink} />
                  <Text className="type-body text-forest-ink flex-1">{`Daily meal delivery for ${length.days} ${length.days === 1 ? "day" : "days"}`}</Text>
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="meal-section__title">Starts on</Text>
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
                  {/* A later day from the calendar (shown as the chip once picked) */}
                  {(() => {
                    const later = startsOn > addDays(today, START_DAYS);
                    return (
                      <PressableScale haptic="select" onPress={() => setPicking(true)} className={later ? "meal-choice meal-choice--on" : "meal-choice"} style={{ minWidth: 84 }} accessibilityRole="button" accessibilityLabel={later ? `Starts ${date(startsOn)}. Pick another date` : "Pick a later date"} accessibilityState={{ selected: later }}>
                        <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={18} tintColor={colors.ink} />
                        <Text className="meal-choice__meta">{later ? new Date(`${startsOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "Pick date"}</Text>
                      </PressableScale>
                    );
                  })()}
                </ScrollView>
                <Text className="meta-text">{`Last delivery ${date(addDays(startsOn, length.days - 1))} (later if you pause or skip a day)`}</Text>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="meal-section__title">Meal time</Text>
                <View className="flex-row" style={{ gap: 8 }}>
                  {MEAL_SLOTS.map((s) => {
                    const times = ready.slots[s];
                    const on = s === slot;
                    return (
                      <PressableScale key={s} haptic="select" disabled={!times.active} onPress={() => setSlot(s)} className={!times.active ? "meal-choice meal-choice--off flex-1" : on ? "meal-choice meal-choice--on flex-1" : "meal-choice flex-1"} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !times.active }}>
                        <Text className="meal-choice__label">{SLOT_LABEL[s]}</Text>
                        <Text className="meal-choice__meta" style={{ textAlign: "center" }}>{times.active ? timeRange(times.startsAt, times.endsAt) : "Off"}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="meal-section__title">Delivered to</Text>
                <PressableScale onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel="Change the delivery address">
                  <View className="meal-icon"><SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={18} tintColor={colors.ink} /></View>
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

              <Text className="meal-section__title">Bill details</Text>
              <View className="card" style={{ gap: 8, marginTop: -8 }}>
                <View className="flex-row justify-between"><Text className="type-body text-muted">{`${rupees(meal.price)} × ${quantity} × ${length.days} days`}</Text><Text className="type-body text-forest-ink">{rupees(price.full)}</Text></View>
                {length.percentOff > 0 ? (
                  <View className="flex-row justify-between"><Text className="type-body text-muted">{`${length.label} · ${length.percentOff}% off`}</Text><Text className="type-body" style={{ color: colors.success }}>{`− ${rupees(price.full - price.total)}`}</Text></View>
                ) : null}
                <View className="flex-row justify-between"><Text className="type-body text-muted">Delivery</Text><Text className="type-body" style={{ color: colors.success }}>Free</Text></View>
                <View className="flex-row justify-between pt-2" style={{ borderTopWidth: 1, borderColor: colors.creamLine }}>
                  <Text className="card__title">To pay</Text>
                  <Text className="card__title">{rupees(price.total)}</Text>
                </View>
                <Text className="meta-text">Payments are in test mode: Pay opens a test checkout and no money is taken.</Text>
              </View>
              {error ? <FormAlert message={error} /> : null}
            </ScrollView>
            <View className="meal-buybar" style={{ paddingBottom: Math.max(insets.bottom, 14) }}>
              <PressableScale haptic="tap" scaleTo={0.98} onPress={pay} disabled={!canPay || busy} className="sub-cta flex-1" style={!canPay ? { opacity: 0.5 } : undefined} accessibilityRole="button" accessibilityLabel={`Pay ${rupees(price.total)}`}>
                {busy ? <ActivityIndicator color={colors.white} /> : null}
                <Text className="sub-cta__label">{busy ? "Processing…" : `Pay ${rupees(price.total)}`}</Text>
              </PressableScale>
            </View>
          </>
        )}
      </SafeAreaView>
      <DatePickerSheet
        visible={picking}
        title="Starts on"
        value={toDate(startsOn)}
        minimumDate={toDate(addDays(today, 1))}
        maximumDate={toDate(addDays(today, LATEST_START_DAYS))}
        onSelect={(picked) => setStartsOn(toIso(picked))}
        onClose={() => setPicking(false)}
      />
      {checkout && <PaymentCheckout options={checkout.options} onDone={checkoutDone} />}
    </View>
  );
}
