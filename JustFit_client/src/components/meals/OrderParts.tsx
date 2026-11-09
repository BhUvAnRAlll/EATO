import { Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { ORDER_STEPS, STATUS_LABEL, stepIndex, type OrderStatus } from "@/lib/mealRules";
import { useThemeColors } from "@/theme";

// An order's status as a pill: light green while it's on its way, dark green once delivered, grey cancelled
export function StatusPill({ status }: { status: OrderStatus }) {
  const variant = status === "delivered" ? "done" : status === "cancelled" ? "cancelled" : null;
  return (
    <View className={variant ? `order-pill order-pill--${variant}` : "order-pill"}>
      <Text className={variant ? `order-pill__label order-pill__label--${variant}` : "order-pill__label"}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

const STEP_LINE: Record<OrderStatus, string> = {
  awaiting_payment: "Waiting for your payment",
  placed: "We've got your order",
  accepted: "The kitchen has your order",
  preparing: "Your meal is being cooked",
  quality_check: "Checking it before it's packed",
  ready: "Packed, waiting for pickup",
  out_for_delivery: "Your meal is on its way",
  delivered: "Enjoy your meal",
  failed: "We couldn't deliver it. We'll call you.",
  cancelled: "",
};

// The five steps as dots joined by a line, filled up to where the order is
export function OrderTimeline({ status }: { status: OrderStatus }) {
  const colors = useThemeColors();
  const at = stepIndex(status);
  return (
    <View accessibilityLabel={`Order status: ${STATUS_LABEL[status]}`}>
      {ORDER_STEPS.map((step, i) => {
        const done = i <= at;
        return (
          <View key={step}>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className={done ? "order-step__dot order-step__dot--done" : "order-step__dot"}>
                {done && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.onPrimary} />}
              </View>
              <View className="flex-1">
                <Text className="card__title" style={done ? undefined : { color: colors.faint }}>{STATUS_LABEL[step]}</Text>
                {i === at && <Text className="meta-text">{STEP_LINE[status]}</Text>}
              </View>
            </View>
            {i < ORDER_STEPS.length - 1 && <View className={i < at ? "order-step__line order-step__line--done" : "order-step__line"} />}
          </View>
        );
      })}
    </View>
  );
}
