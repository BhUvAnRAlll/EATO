import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { colors } from "@/theme";

type SectionHeaderProps = {
  title: string;
  // Small element beside the title (e.g. the LIVE badge)
  badge?: ReactNode;
  // Text on the right ("View all" link when onAction is given, plain text otherwise)
  actionLabel?: string;
  onAction?: () => void;
  // Link colour; the brand red text colour unless a section uses another accent
  actionColor?: string;
};

// Section title with an optional badge and a right-aligned "Label →" link
export function SectionHeader({ title, badge, actionLabel, onAction, actionColor = colors.primaryText }: SectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 flex-row items-center gap-2">
        <Text className="type-headline text-ink" numberOfLines={1}>
          {title}
        </Text>
        {badge}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} className="flex-row items-center gap-1.5" accessibilityRole="button">
          <Text className="home__link" style={{ color: actionColor }}>{actionLabel}</Text>
          <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={14} tintColor={actionColor} />
        </Pressable>
      ) : actionLabel ? (
        <Text className="type-callout text-muted">{actionLabel}</Text>
      ) : null}
    </View>
  );
}
