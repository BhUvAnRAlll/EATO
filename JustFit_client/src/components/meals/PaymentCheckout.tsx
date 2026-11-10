import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/lib/mealRules";
import { mealsApi, type CheckoutOptions, type PaymentMethod, type PaymentSuccess } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// What a checkout ends with: Razorpay's success handler (payment id, order id, signature), a failed
// payment, or the member closing it
export type CheckoutResult = { ok: true; paid: PaymentSuccess } | { ok: false; cancelled: boolean; reason: string };

const METHODS: { id: PaymentMethod; label: string; line: string; icon: Parameters<typeof SymbolView>[0]["name"] }[] = [
  { id: "upi", label: "UPI", line: "Google Pay, PhonePe, Paytm or any UPI app", icon: { ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" } },
  { id: "card", label: "Card", line: "Credit, debit or RuPay card", icon: { ios: "creditcard", android: "credit_card", web: "credit_card" } },
  { id: "netbanking", label: "Netbanking", line: "All Indian banks", icon: { ios: "building.columns", android: "account_balance", web: "account_balance" } },
  { id: "wallet", label: "Wallet", line: "Paytm, PhonePe, Amazon Pay", icon: { ios: "wallet.pass", android: "account_balance_wallet", web: "account_balance_wallet" } },
];

/**
 * The payment checkout (2026-11-10), opened with the options Pay returned. With the dummy provider
 * it is justFit's own test checkout: pick a method, Pay (or try a failed payment), and the dummy
 * gateway on the server answers as Razorpay's would, signature included. No money moves.
 * Razorpay: install react-native-razorpay (needs approval and a rebuild) and replace the dummy
 * branch with `RazorpayCheckout.open(options)`, whose answer has the same three fields.
 */
export function PaymentCheckout({ options, onDone }: { options: CheckoutOptions; onDone: (result: CheckoutResult) => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = useRef<CheckoutResult | null>(null);
  const running = useRef(false);

  // Not wired yet: the server only hands out Razorpay options once PAYMENT_PROVIDER=razorpay
  const unsupported = options.provider !== "dummy";
  useEffect(() => {
    if (unsupported) onDone({ ok: false, cancelled: false, reason: "Online payment isn't set up in this app yet." });
  }, [unsupported, onDone]);
  if (unsupported) return null;

  const pay = async (outcome: "success" | "failure", dismiss: () => void) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const answer = await mealsApi.dummyCheckout(await getToken(), options.order_id, method, outcome);
    running.current = false;
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    if (answer.data.status === "failed") return setError(answer.data.error.description);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = answer.data;
    result.current = { ok: true, paid: { razorpay_order_id, razorpay_payment_id, razorpay_signature } };
    dismiss();
  };

  return (
    <BottomSheet locked={busy} onClose={() => onDone(result.current ?? { ok: false, cancelled: true, reason: "Payment cancelled" })}>
      {(dismiss) => (
        <View style={{ gap: 16 }}>
          <View className="flex-row items-start" style={{ gap: 12 }}>
            <View className="meal-icon"><SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={18} tintColor={colors.ink} /></View>
            <View className="min-w-0 flex-1">
              <Text className="type-headline text-forest-ink">{options.name}</Text>
              <Text className="meta-text" numberOfLines={1}>{options.description}</Text>
            </View>
            <Text className="type-title text-forest-ink">{rupees(options.amount / 100)}</Text>
          </View>
          <View className="pay-test">
            <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={14} tintColor={colors.warning} />
            <Text className="pay-test__label flex-1">Test mode: no money is taken. Real payments come with Razorpay.</Text>
          </View>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            <Text className="type-subhead text-forest-ink">Pay with</Text>
            {METHODS.map((m) => {
              const on = method === m.id;
              return (
                <PressableScale key={m.id} haptic="select" disabled={busy} onPress={() => setMethod(m.id)} className={on ? "pay-method pay-method--on" : "pay-method"} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${m.label}, ${m.line}`}>
                  <SymbolView name={m.icon} size={20} tintColor={on ? colors.mealDark : colors.ink} />
                  <View className="min-w-0 flex-1">
                    <Text className="card__title">{m.label}</Text>
                    <Text className="meta-text" numberOfLines={1}>{m.line}</Text>
                  </View>
                  <View className={on ? "pay-radio pay-radio--on" : "pay-radio"} />
                </PressableScale>
              );
            })}
          </View>
          {error ? <FormAlert message={error} /> : null}
          <PressableScale haptic="tap" disabled={busy} onPress={() => pay("success", dismiss)} className="meal-btn" accessibilityRole="button" accessibilityLabel={`Pay ${rupees(options.amount / 100)}`}>
            {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
            <Text className="btn-forest__label">{busy ? "Paying…" : `Pay ${rupees(options.amount / 100)}`}</Text>
          </PressableScale>
          <Pressable disabled={busy} onPress={() => pay("failure", dismiss)} className="self-center" hitSlop={10} accessibilityRole="button">
            <Text className="meta-text" style={{ textDecorationLine: "underline" }}>Try a failed payment (test)</Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}
