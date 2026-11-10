import { Text, View } from "react-native";

import { TodayMealCard } from "@/components/home/TodayMealCard";
import { PressableScale } from "@/components/PressableScale";
import { STATUS_LABEL, SLOT_LABEL } from "@/lib/mealRules";
import type { Order } from "@/lib/mealsApi";

type TodayDeliveryProps = {
  // Today's delivery to show, or null for the "order one" nudge
  order: Order | null;
  actionLabel: string;
  onOpenOrder: (id: string) => void;
  onOrder: () => void;
};

// Home's delivery card: the meal on its way (or the last delivered), else a nudge to order
export function TodayDelivery({ order, actionLabel, onOpenOrder, onOrder }: TodayDeliveryProps) {
  if (!order) {
    return (
      <PressableScale scaleTo={0.98} onPress={onOrder} className="today__card flex-row items-center" style={{ gap: 12 }} accessibilityRole="button">
        <View className="flex-1">
          <Text className="today__name">No meal delivery today</Text>
          <Text className="meta-text">Order breakfast, lunch or dinner from Meals.</Text>
        </View>
        <Text className="home__link">Order</Text>
      </PressableScale>
    );
  }

  const [first] = order.items;
  return (
    <TodayMealCard
      order={{
        slot: SLOT_LABEL[order.slot].toUpperCase(),
        meal: {
          id: order.id,
          name: order.items.length > 1 ? `${first.name} + ${order.items.length - 1} more` : first?.name ?? "Your meal",
          imageUrl: first?.imageUrl ?? null,
          calories: order.totals.calories,
          proteinG: order.totals.proteinG,
          carbsG: order.totals.carbsG,
          fatG: order.totals.fatG,
        },
        status: STATUS_LABEL[order.status],
      }}
      isSample={false}
      actionLabel={actionLabel}
      onViewAll={() => onOpenOrder(order.id)}
    />
  );
}
