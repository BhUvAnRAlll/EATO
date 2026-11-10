import { Text, View, useWindowDimensions } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/lib/mealRules";
import { subscriptionPrice } from "@/lib/subscriptionRules";
import type { SubscriptionLength } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

type SubscriptionChoiceProps = {
  lengths: SubscriptionLength[];
  unitPrice: number;
  quantity: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onContinue: () => void;
};

// A meal's Subscription Plans (the user's design): "Save up to x%", a card per length (the length,
// how many meals, the price for the quantity picked, "x% off"), then "Daily meal delivery for N days".
// Four cards a row; two a row on a narrow phone so the prices never squeeze.
export function SubscriptionChoice({ lengths, unitPrice, quantity, selectedId, onSelect, onContinue }: SubscriptionChoiceProps) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const perRow = width < 360 ? 2 : Math.min(4, lengths.length);
  const cardWidth = Math.floor((width - 32 - 8 * (perRow - 1)) / perRow);
  const best = Math.max(0, ...lengths.map((l) => l.percentOff));
  const chosen = lengths.find((l) => l.id === selectedId) ?? null;

  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="meal-section__title" accessibilityRole="header">Subscription Plans</Text>
        {best > 0 ? <View className="meal-save"><Text className="meal-save__label">{`Save up to ${best}%`}</Text></View> : null}
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {lengths.map((l) => {
          const on = l.id === selectedId;
          const { total } = subscriptionPrice(unitPrice, quantity, l.days, l.percentOff);
          const meals = l.days * quantity;
          return (
            <PressableScale
              key={l.id}
              haptic="select"
              scaleTo={0.97}
              onPress={() => onSelect(l.id)}
              className={on ? "meal-length meal-length--on" : "meal-length"}
              style={{ width: cardWidth }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${l.label}, ${meals} meals, ${rupees(total)}${l.percentOff ? `, ${l.percentOff}% off` : ""}`}
            >
              <Text className="meal-length__label" numberOfLines={1}>{l.label}</Text>
              <Text className="meal-length__meals">{`${meals} ${meals === 1 ? "meal" : "meals"}`}</Text>
              <Text className="meal-length__price" numberOfLines={1} adjustsFontSizeToFit>{rupees(total)}</Text>
              {l.percentOff > 0 ? <View className="meal-off"><Text className="meal-off__label">{`${l.percentOff}% off`}</Text></View> : null}
            </PressableScale>
          );
        })}
      </View>
      {chosen ? (
        <PressableScale scaleTo={0.99} onPress={onContinue} className="meal-info-row" accessibilityRole="button" accessibilityLabel={`Daily meal delivery for ${chosen.days} days. Continue`}>
          <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={19} tintColor={colors.ink} />
          <Text className="type-body text-forest-ink flex-1">{`Daily meal delivery for ${chosen.days} ${chosen.days === 1 ? "day" : "days"}`}</Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor={colors.ink} />
        </PressableScale>
      ) : null}
    </View>
  );
}
