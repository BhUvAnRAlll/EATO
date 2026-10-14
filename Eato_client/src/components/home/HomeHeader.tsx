import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";

import { WORDMARK_RATIO } from "@/components/BrandWordmark";
import { images } from "@/constants/images";
import { colors } from "@/theme";

type HomeHeaderProps = {
  // Delivery pincode shown in the location pill
  pincode: string;
  hasUnread: boolean;
  // What the location pill shows: the pin only (narrow phones), the pincode, or "Deliver to · pincode"
  pill?: "icon" | "pincode" | "full";
  onLocationPress: () => void;
  onNotificationsPress: () => void;
  onProfilePress: () => void;
};

// Logo and tagline on the left; delivery location and notifications on the right
export function HomeHeader({ pincode, hasUnread, pill = "full", onLocationPress, onNotificationsPress, onProfilePress }: HomeHeaderProps) {
  const compact = pill === "icon";
  return (
    <View className="flex-row items-start justify-between gap-2 px-5 pt-2">
      <View className="flex-1">
        <Image
          source={images.eatoWordmark}
          contentFit="contain"
          style={{ width: compact ? 88 : 100, height: (compact ? 88 : 100) / WORDMARK_RATIO, marginLeft: -3 }}
        />
        {/* Two lines on every width: next to the location pill the column can be narrow even on
            wide phones, and an ellipsis in the brand line is never acceptable */}
        <Text className="brand__tagline brand__tagline--tight mt-1" numberOfLines={2}>
          Eat better. Live stronger.
        </Text>
      </View>

      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={onLocationPress}
          className="home__pill"
          style={compact ? { paddingHorizontal: 10 } : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Deliver to ${pincode}. Change delivery address`}
        >
          <SymbolView
            name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
            size={18}
            tintColor={colors.forestInk}
          />
          {pill !== "icon" && <Text className="home__pill-label">{pill === "full" ? `Deliver to · ${pincode}` : pincode}</Text>}
          <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={14} tintColor={colors.muted} />
        </Pressable>

        <Pressable
          onPress={onNotificationsPress}
          className="home__icon-button"
          accessibilityRole="button"
          accessibilityLabel={hasUnread ? "Notifications, new" : "Notifications"}
        >
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={20} tintColor={colors.forestInk} />
          {hasUnread && <View className="home__unread" />}
        </Pressable>

        <Pressable onPress={onProfilePress} className="home__icon-button" accessibilityRole="button" accessibilityLabel="Profile">
          <SymbolView name={{ ios: "person.crop.circle", android: "person", web: "person" }} size={20} tintColor={colors.forestInk} />
        </Pressable>
      </View>
    </View>
  );
}
