import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type EmptyStateProps = {
  icon: Icon;
  title: string;
  message?: string;
  // A button or link under the message (e.g. "Pick your spot")
  children?: ReactNode;
  // "meal": the icon on light green (the Meals module); default: soft red
  tone?: "meal";
};

// The member app's one empty-state look: a white card with the icon in a soft red circle, a
// title, a line under it and an optional action
export function EmptyState({ icon, title, message, children, tone }: EmptyStateProps) {
  const colors = useThemeColors();
  return (
    <View className="empty-state" accessibilityRole="summary">
      <View className={tone === "meal" ? "meal-icon meal-icon--lg" : "placeholder__icon"}>
        <SymbolView name={icon} size={30} tintColor={tone === "meal" ? colors.mealPrimary : colors.leaf} />
      </View>
      <Text className="card__title text-center">{title}</Text>
      {message ? <Text className="placeholder__text">{message}</Text> : null}
      {children ? <View className="mt-1 self-stretch">{children}</View> : null}
    </View>
  );
}
