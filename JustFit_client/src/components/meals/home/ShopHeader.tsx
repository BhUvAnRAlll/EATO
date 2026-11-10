import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { KIND_LABEL } from "@/lib/addressRules";
import type { DeliveryAddress } from "@/lib/addressApi";
import { useThemeColors } from "@/theme";

// The Meals tab's top, Zomato-style (the user's 2026-11-10 ask): where it's delivered first (the
// pin, "Home ▾" and the address under it; tap to pick another), with the bell and the cart (and
// its count) on the right. Subscribing starts on a meal's page, so there is no Order | Subscription switch.
export function ShopHeader({ address, count }: { address: DeliveryAddress | null; count: number }) {
  const colors = useThemeColors();
  const place = address ? [address.house, address.deliveryArea ?? address.street, address.city].filter(Boolean).join(", ") : "";
  return (
    <View className="flex-row items-center px-4 pt-2" style={{ gap: 4 }}>
      <PressableScale
        scaleTo={0.98}
        onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })}
        className="min-w-0 flex-1 flex-row items-center"
        style={{ gap: 8 }}
        accessibilityRole="button"
        accessibilityLabel={address ? `Delivering to ${KIND_LABEL[address.kind]}, ${place || address.pincode}. Change` : "Add a delivery address"}
      >
        <SymbolView name={{ ios: "location", android: "near_me", web: "near_me" }} size={22} tintColor={colors.mealPrimary} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <Text className="shop-location__kind" numberOfLines={1}>{address ? KIND_LABEL[address.kind] : "Add an address"}</Text>
            <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={13} tintColor={colors.ink} />
          </View>
          <Text className="shop-location__line" numberOfLines={1}>{address ? place || address.pincode : "So we know where to deliver"}</Text>
        </View>
      </PressableScale>
      <PressableScale onPress={() => router.push("/notifications")} className="shop-cart" accessibilityRole="button" accessibilityLabel="Notifications">
        <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={23} tintColor={colors.ink} />
      </PressableScale>
      <PressableScale onPress={() => router.push("/meals/cart")} className="shop-cart" accessibilityRole="button" accessibilityLabel={count ? `Cart, ${count} meals` : "Cart, empty"}>
        <SymbolView name={{ ios: "cart", android: "shopping_cart", web: "shopping_cart" }} size={23} tintColor={colors.ink} />
        {count > 0 && <View className="shop-cart__count"><Text className="shop-cart__count-label">{count}</Text></View>}
      </PressableScale>
    </View>
  );
}
