import { Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// Grey blocks shaped like a post, shown while the first page loads
export function PostSkeleton() {
  return (
    <View className="post__card">
      <View className="flex-row items-center gap-3">
        <View className="skeleton h-11 w-11 rounded-pill" />
        <View className="flex-1 gap-2">
          <View className="skeleton h-3.5 w-32" />
          <View className="skeleton h-3 w-16" />
        </View>
      </View>
      <View className="skeleton mt-4 h-3.5 w-full" />
      <View className="skeleton mt-2 h-3.5 w-4/5" />
    </View>
  );
}

type EmptyStateProps = { icon: Icon; title: string; text: string; actionLabel?: string; onAction?: () => void };

// Friendly empty or error state with an optional action (e.g. Retry)
export function EmptyState({ icon, title, text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="home__empty mx-0">
      <SymbolView name={icon} size={24} tintColor={colors.leaf} />
      <Text className="card__title text-center">{title}</Text>
      <Text className="placeholder__text">{text}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} className="admin__action admin__action--primary mt-1" accessibilityRole="button">
          <Text className="admin__action-label admin__action-label--primary">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
