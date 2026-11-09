import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { FieldInput } from "@/components/FieldInput";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { LoadError } from "@/components/macro/LoadError";
import { PaymentCheckout, type CheckoutResult } from "@/components/meals/PaymentCheckout";
import { QuantityStepper } from "@/components/meals/QuantityStepper";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KIND_ICON } from "@/data/addresses";
import { KIND_LABEL, addressLines } from "@/lib/addressRules";
import { newId } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { MEAL_SLOTS, SLOT_LABEL, cartTotals, closesAtText, dayLabel, rupees, timeRange, type MealSlot } from "@/lib/mealRules";
import { mealImage, mealsApi, type CheckoutOptions, type MenuMeal, type Order, type OrderOptions, type Quote } from "@/lib/mealsApi";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL, useCartStore } from "@/store/cart";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; menu: MenuMeal[]; options: OrderOptions };

// The cart and checkout: the meals (− n +), the delivery day and meal time (only open ones; orders
// close 2 hours before the meal time), the address, the bill and the payment. Pay is Razorpay's
// flow (2026-11-10): the server saves the order as awaiting payment and answers with the checkout's
// options, the checkout pays (the dummy's for now, no money taken), and the server checks the
// payment's signature before the order is placed. A retry sends the same request id, so it reopens
// the same order's checkout instead of making a second order.
export default function Cart() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const items = useCartStore((state) => state.items);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const clear = useCartStore((state) => state.clear);
  const couponCode = useCartStore((state) => state.couponCode);
  const setCoupon = useCartStore((state) => state.setCoupon);
  const [couponInput, setCouponInput] = useState("");
  // The server's price for this cart and coupon (null until it answers); the bill shows it
  const [quote, setQuote] = useState<Quote | null>(null);
  const { load: addressLoad, retry: retryAddresses } = useAddressBook();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // The member's picks; while a pick is closed (or before any), the first open day and meal time
  const [pickedDate, setDate] = useState<string | null>(null);
  const [pickedSlot, setSlot] = useState<MealSlot | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  // One request id per order: a Pay tapped again after a lost answer places nothing new
  const clientId = useRef(newId());
  const running = useRef(false);
  // The checkout open for an order waiting for payment
  const [checkout, setCheckout] = useState<{ orderId: string; options: CheckoutOptions } | null>(null);

  const read = useCallback(async () => {
    const t = await getToken();
    const [menu, options] = await Promise.all([mealsApi.menu(t), mealsApi.options(t)]);
    if (!menu.ok) return setLoad({ state: "failed", error: menu.error });
    if (!options.ok) return setLoad({ state: "failed", error: options.error });
    setLoad({ state: "ready", menu: menu.data.meals, options: options.data });
  }, [getToken]);
  // Read again whenever the cart shows: times close while it sits open
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const options = load.state === "ready" ? load.options : null;
  const openDay = options?.days.find((d) => d.date === pickedDate && d.slots.some((s) => s.open)) ?? options?.days.find((d) => d.slots.some((s) => s.open));
  const date = openDay?.date ?? null;
  const slot = openDay?.slots.find((s) => s.slot === pickedSlot && s.open)?.slot ?? openDay?.slots.find((s) => s.open)?.slot ?? null;

  const lines = useMemo(() => {
    if (load.state !== "ready") return [];
    const byId = new Map(load.menu.map((m) => [m.id, m]));
    return Object.entries(items).map(([id, quantity]) => ({ id, quantity, meal: byId.get(id) ?? null }));
  }, [items, load]);
  const available = lines.filter((l): l is { id: string; quantity: number; meal: MenuMeal } => l.meal !== null);
  const totals = cartTotals(available.map((l) => ({ mealId: l.id, quantity: l.quantity, price: l.meal.price, calories: l.meal.calories, proteinG: l.meal.proteinG })));
  const gone = lines.filter((l) => l.meal === null);

  const book = addressLoad.state === "ready" ? addressLoad.book : null;
  const address = book?.addresses.find((a) => a.isDefault) ?? null;
  const today = options?.days[0]?.date ?? "";
  // Ask the server for the price whenever the cart or the coupon changes (a moment after the last tap)
  const lineKey = available.map((l) => `${l.id}:${l.quantity}`).join(",");
  useEffect(() => {
    if (!lineKey) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const answer = await mealsApi.quote(await getToken(), lineKey.split(",").map((x) => ({ mealId: x.split(":")[0], quantity: Number(x.split(":")[1]) })), couponCode ?? undefined);
      if (!stale) setQuote(answer.ok ? answer.data : null);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [lineKey, couponCode, getToken]);
  const priced = quote && quote.subtotal === totals.total ? quote : null; // only a quote for what's on screen
  const couponOk = !!couponCode && !!priced?.coupon?.ok;
  const couponProblem = couponCode && priced?.coupon && !priced.coupon.ok ? priced.coupon.problem : null;
  const toPay = couponOk && priced ? priced.total : totals.total;
  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,16}$/.test(code)) return setError("Type a coupon code (letters and digits).");
    setError("");
    setCoupon(code);
    setCouponInput("");
    haptic.select();
  };

  const ready = available.length > 0 && gone.length === 0 && !!date && !!slot && !!address?.deliverable && !couponProblem && (!couponCode || couponOk);

  // Paid and placed: a new request id for the next order, an empty cart, and the order's page
  const placed = (order: Order) => {
    clientId.current = newId();
    clear();
    hud.success("Paid · order placed");
    router.replace({ pathname: "/orders/[id]", params: { id: order.id } });
  };

  const pay = async () => {
    if (!ready || running.current || !address || !date || !slot) return;
    running.current = true;
    setPaying(true);
    setError("");
    haptic.tap();
    const answer = await mealsApi.place(await getToken(), {
      clientId: clientId.current,
      addressId: address.id,
      date,
      slot,
      items: available.map((l) => ({ mealId: l.id, quantity: l.quantity })),
      ...(couponOk && couponCode ? { couponCode } : {}),
    });
    running.current = false;
    setPaying(false);
    if (!answer.ok) {
      setError(answer.error);
      if (answer.status === 409) {
        read(); // a meal time closed or a meal left the menu
        clientId.current = newId(); // or this checkout expired: the next Pay is a new order
      }
      return;
    }
    // No checkout: placed already (before the payments migration, or paid on an earlier try)
    if (!answer.data.checkout) {
      if (answer.data.order.status === "cancelled") {
        clientId.current = newId();
        return setError("That order was cancelled. Tap Pay to place it again.");
      }
      return placed(answer.data.order);
    }
    setCheckout({ orderId: answer.data.order.id, options: answer.data.checkout });
  };

  // The checkout's answer: a payment is only trusted once the server has checked its signature
  const checkoutDone = useCallback(async (result: CheckoutResult) => {
    const open = checkout;
    setCheckout(null);
    if (!open) return;
    if (!result.ok) {
      // Razorpay reports a closed or failed checkout to the app only: tell the server, keep the order waiting
      if (result.cancelled) mealsApi.paymentFailed(await getToken(), open.orderId, open.options.order_id, "Checkout closed");
      setError(result.cancelled ? "Payment cancelled. Tap Pay to try again." : result.reason);
      return;
    }
    running.current = true;
    setPaying(true);
    const verified = await mealsApi.verifyPayment(await getToken(), open.orderId, result.paid);
    running.current = false;
    setPaying(false);
    if (!verified.ok) {
      setError(verified.error);
      if (verified.status === 409) clientId.current = newId(); // that order is closed: Pay makes a new one
      return;
    }
    placed(verified.data.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, getToken]);

  const empty = Object.keys(items).length === 0;

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Your cart" fallback="/meals" />
        {empty ? (
          <View className="px-4">
            <EmptyState tone="meal" icon={{ ios: "bag", android: "shopping_bag", web: "shopping_bag" }} title="Your cart is empty" message="Add meals from the menu, then come back here to order.">
              <PrimaryButton tone="meal" label="Browse meals" onPress={() => router.navigate("/meals")} />
            </EmptyState>
          </View>
        ) : load.state === "loading" ? (
          <View className="px-4"><ScreenSkeleton label="Loading your cart" /></View>
        ) : load.state === "failed" ? (
          <View className="px-4"><LoadError tone="meal" title="Your cart couldn't load" message={load.error} onRetry={() => { setLoad({ state: "loading" }); read(); }} /></View>
        ) : (
          <KeyboardAvoider>
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 20 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            >
              {/* The meals */}
              <View className="admin-list">
                {lines.map((l, i) => (
                  <View key={l.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}>
                    <View className="overflow-hidden rounded-md" style={{ width: 52, height: 52, backgroundColor: colors.creamDeep }}>
                      {l.meal && <Image source={mealImage(l.meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title" numberOfLines={2}>{l.meal?.name ?? "A meal"}</Text>
                      <Text className={l.meal ? "meta-text" : "meta-text text-danger"}>{l.meal ? `${rupees(l.meal.price)} · ${l.meal.calories} kcal` : "No longer on the menu"}</Text>
                    </View>
                    {l.meal ? (
                      <QuantityStepper quantity={l.quantity} max={MAX_PER_MEAL} name={l.meal.name} onChange={(q) => setQuantity(l.id, q)} size="sm" />
                    ) : (
                      <PressableScale onPress={() => setQuantity(l.id, 0)} className="admin-chip" accessibilityRole="button" accessibilityLabel="Remove this meal">
                        <Text className="admin-segment__label">Remove</Text>
                      </PressableScale>
                    )}
                  </View>
                ))}
              </View>
              <PressableScale onPress={() => router.navigate("/meals")} className="flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button">
                <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.mealDark} />
                <Text className="meal-link">Add more meals</Text>
              </PressableScale>

              {/* The day */}
              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink">Delivery day</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {options!.days.map((d) => {
                    const any = d.slots.some((s) => s.open);
                    const on = d.date === date;
                    return (
                      <PressableScale
                        key={d.date}
                        haptic="select"
                        disabled={!any}
                        onPress={() => setDate(d.date)}
                        className={on ? "meal-choice meal-choice--on" : any ? "meal-choice" : "meal-choice meal-choice--off"}
                        style={{ minWidth: 84 }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: !any }}
                      >
                        <Text className="meal-choice__label" style={any ? undefined : { color: colors.faint }}>{dayLabel(d.date, today).split(",")[0]}</Text>
                        <Text className="meal-choice__meta" numberOfLines={1}>{any ? new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : d.holiday ? "Holiday" : "Closed"}</Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </View>

              {/* The meal time */}
              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink">Meal time</Text>
                <View className="flex-row" style={{ gap: 8 }}>
                  {MEAL_SLOTS.map((s) => {
                    const times = options!.slots[s];
                    const choice = options!.days.find((d) => d.date === date)?.slots.find((x) => x.slot === s);
                    const open = !!choice?.open;
                    const on = s === slot && open;
                    return (
                      <PressableScale
                        key={s}
                        haptic="select"
                        disabled={!open}
                        onPress={() => setSlot(s)}
                        className={on ? "meal-choice meal-choice--on flex-1" : open ? "meal-choice flex-1" : "meal-choice meal-choice--off flex-1"}
                        style={{ minHeight: 76 }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: !open }}
                      >
                        <Text className="meal-choice__label" style={open ? undefined : { color: colors.faint }}>{SLOT_LABEL[s]}</Text>
                        <Text className="meal-choice__meta" style={{ textAlign: "center" }}>{times.active ? timeRange(times.startsAt, times.endsAt) : "Not today"}</Text>
                        <Text className="meal-choice__meta" style={{ textAlign: "center", color: open ? colors.muted : colors.faint }}>
                          {!times.active ? "Off" : open ? `Order by ${closesAtText(times.startsAt, options!.cutoffMinutes)}` : choice?.full ? "Fully booked" : "Closed"}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
                {!date && <Text className="meta-text">No meal time is open in the next 7 days. Please check back later.</Text>}
                {(options!.holidays ?? []).map((h) => (
                  <Text key={h.day} className="meta-text">{`No deliveries ${dayLabel(h.day, today).toLowerCase() === "today" || dayLabel(h.day, today).toLowerCase() === "tomorrow" ? dayLabel(h.day, today).toLowerCase() : `on ${dayLabel(h.day, today)}`}: ${h.note}`}</Text>
                ))}
              </View>

              {/* The address */}
              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink">Deliver to</Text>
                {addressLoad.state === "loading" ? (
                  <ScreenSkeleton cards={1} label="Loading your address" />
                ) : addressLoad.state === "failed" ? (
                  <LoadError tone="meal" title="Addresses couldn't load" message={addressLoad.error} onRetry={retryAddresses} />
                ) : address ? (
                  <PressableScale scaleTo={0.99} onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`Deliver to ${KIND_LABEL[address.kind]}. Change`}>
                    <View className="meal-icon"><SymbolView name={KIND_ICON[address.kind]} size={18} tintColor={colors.mealDark} /></View>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{`${KIND_LABEL[address.kind]} · ${address.receiverName}`}</Text>
                      <Text className="meta-text" numberOfLines={2}>{`${addressLines(address).first}, ${addressLines(address).second}`}</Text>
                      {!address.deliverable && <Text className="meta-text text-danger">{`We don't deliver to ${address.pincode} yet. Pick another address.`}</Text>}
                    </View>
                    <Text className="meal-link">Change</Text>
                  </PressableScale>
                ) : (
                  <PressableScale onPress={() => router.push("/addresses/location")} className="card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button">
                    <View className="meal-icon"><SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={18} tintColor={colors.mealDark} /></View>
                    <Text className="card__title flex-1">Add a delivery address</Text>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                  </PressableScale>
                )}
              </View>

              {/* A coupon */}
              <View className="card" style={{ gap: 10 }}>
                <Text className="card__title">Coupon</Text>
                {couponCode ? (
                  <View className="flex-row items-center" style={{ gap: 10 }}>
                    <View className="meal-icon"><SymbolView name={{ ios: "tag.fill", android: "sell", web: "sell" }} size={17} tintColor={couponProblem ? colors.danger : colors.mealDark} /></View>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title">{couponCode}</Text>
                      {couponOk && priced ? <Text className="shop-macros">{`You save ${rupees(priced.discount)}`}</Text> : null}
                      {couponProblem ? <Text className="meta-text" style={{ color: colors.danger }}>{couponProblem}</Text> : null}
                      {!priced ? <Text className="meta-text">Checking…</Text> : null}
                    </View>
                    <PressableScale onPress={() => setCoupon(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove coupon ${couponCode}`}>
                      <Text className="meal-link" style={{ color: colors.danger }}>Remove</Text>
                    </PressableScale>
                  </View>
                ) : (
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <View className="setup__field flex-1" style={{ minHeight: 46 }}>
                      <FieldInput
                        className="field-input flex-1"
                        value={couponInput}
                        onChangeText={(t) => setCouponInput(t.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                        placeholder="Enter a coupon code"
                        placeholderTextColor={colors.faint}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={16}
                        returnKeyType="done"
                        onSubmitEditing={applyCoupon}
                        accessibilityLabel="Coupon code"
                      />
                    </View>
                    <PressableScale haptic="select" onPress={applyCoupon} disabled={couponInput.length < 3} className="shop-coupon__apply" style={{ minHeight: 46, opacity: couponInput.length < 3 ? 0.5 : 1 }} accessibilityRole="button">
                      <Text className="shop-coupon__apply-label">Apply</Text>
                    </PressableScale>
                  </View>
                )}
              </View>

              {/* The bill and the test payment */}
              <View className="card" style={{ gap: 8 }}>
                <View className="flex-row justify-between"><Text className="type-body text-muted">{`Meals (${totals.count})`}</Text><Text className="type-body text-forest-ink">{rupees(totals.total)}</Text></View>
                {couponOk && priced ? (
                  <View className="flex-row justify-between"><Text className="type-body text-muted">{`Coupon ${couponCode}`}</Text><Text className="type-body" style={{ color: colors.mealDark }}>{`− ${rupees(priced.discount)}`}</Text></View>
                ) : null}
                <View className="flex-row justify-between"><Text className="type-body text-muted">Delivery</Text><Text className="type-body" style={{ color: colors.mealDark }}>Free</Text></View>
                <View className="flex-row justify-between pt-2" style={{ borderTopWidth: 1, borderColor: colors.mealLine }}>
                  <Text className="card__title">To pay</Text>
                  <Text className="card__title">{rupees(toPay)}</Text>
                </View>
                <Text className="meta-text">{`${totals.calories} kcal · ${Math.round(totals.proteinG)}g protein in this order`}</Text>
              </View>
              <View className="card flex-row" style={{ gap: 12 }}>
                <View className="meal-icon"><SymbolView name={{ ios: "creditcard", android: "credit_card", web: "credit_card" }} size={18} tintColor={colors.mealDark} /></View>
                <View className="flex-1">
                  <Text className="card__title">UPI, card, netbanking or wallet</Text>
                  <Text className="meta-text">Payments are in test mode: Pay opens a test checkout and no money is taken.</Text>
                </View>
              </View>
              {error ? <FormAlert message={error} /> : null}
            </ScrollView>
            <View className="px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12), backgroundColor: colors.mealSurface }}>
              {paying ? (
                <View className="meal-btn" accessibilityLiveRegion="polite">
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                  <Text className="btn-forest__label">Processing…</Text>
                </View>
              ) : (
                <PrimaryButton tone="meal" label={`Pay ${rupees(toPay)}`} onPress={pay} disabled={!ready} />
              )}
            </View>
          </KeyboardAvoider>
        )}
      </SafeAreaView>
      {checkout && <PaymentCheckout options={checkout.options} onDone={checkoutDone} />}
    </View>
  );
}
