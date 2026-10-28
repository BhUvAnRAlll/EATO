import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { formatLongDate, greetingFor } from "@/lib/date";
import { colors } from "@/theme";

type HomeHeaderProps = {
  // The member's first name ("" when the account has none yet)
  name: string;
  // Delivery pincode shown in the location pill
  pincode: string;
  hasUnread: boolean;
  onLocationPress: () => void;
  onNotificationsPress: () => void;
  onProfilePress: () => void;
};

// Greeting, name and date on the left; notifications and the profile avatar on the right; the
// delivery location pill underneath
export function HomeHeader({ name, pincode, hasUnread, onLocationPress, onNotificationsPress, onProfilePress }: HomeHeaderProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View className="px-4 pt-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="type-callout text-muted">{greetingFor()}</Text>
          <Text className="type-title text-ink" numberOfLines={1}>
            {name || "Welcome"}
          </Text>
          <Text className="type-caption mt-0.5 text-muted">{formatLongDate()}</Text>
        </View>

        <View className="flex-row items-center gap-2.5 pt-1">
          <Pressable
            onPress={onNotificationsPress}
            className="home__icon-button"
            accessibilityRole="button"
            accessibilityLabel={hasUnread ? "Notifications, new" : "Notifications"}
          >
            <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={20} tintColor={colors.forestInk} />
            {hasUnread && <View className="home__unread" />}
          </Pressable>
          <Pressable onPress={onProfilePress} className="home__avatar" accessibilityRole="button" accessibilityLabel="Profile">
            <Text className="home__avatar-label">{initial}</Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={onLocationPress} className="home__pill mt-3 self-start" accessibilityRole="button" accessibilityLabel={`Deliver to ${pincode}. Change delivery address`}>
        <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={15} tintColor={colors.forestInk} />
        <Text className="home__pill-label">{`Deliver to · ${pincode}`}</Text>
        <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={12} tintColor={colors.muted} />
      </Pressable>
    </View>
  );
}
