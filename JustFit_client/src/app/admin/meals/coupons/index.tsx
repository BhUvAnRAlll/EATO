import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { kitchenApi, type Coupon } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const STATE: Record<Coupon["state"], { label: string; done: boolean }> = {
  live: { label: "Live", done: false },
  scheduled: { label: "Scheduled", done: false },
  expired: { label: "Expired", done: true },
  off: { label: "Off", done: true },
};

// Super Admin › Meals › Coupons: every coupon with what it takes off, its state today (Live,
// Scheduled, Expired, Off) and how many orders used it. Tap one to edit it; New coupon adds one.
export default function AdminCoupons() {
  const colors = useThemeColors();
  const { result, retry, refresh } = useGymData(kitchenApi.coupons);
  const coupons = result.state === "ready" ? result.data.coupons : [];
  const openNew = () => router.push({ pathname: "/admin/meals/coupons/[id]", params: { id: "new" } });
  return (
    <AdminScreen title="Coupons" onRefresh={refresh}>
      <View style={{ gap: 14 }}>
        <Pressable onPress={openNew} className="btn-forest" accessibilityRole="button">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.onPrimary} />
          <Text className="btn-forest__label">New coupon</Text>
        </Pressable>
        <Text className="meta-text">Members apply a coupon in the cart. The server checks it again when they pay, so an expired or used-up coupon never lowers a price.</Text>
        {result.state === "loading" && <ScreenSkeleton label="Loading coupons" />}
        {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load coupons" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
        {result.state === "ready" && coupons.length === 0 && (
          <DashedBlock icon={{ ios: "tag", android: "sell", web: "sell" }} title="No coupons yet" text="For example: SAVE100, 50% off up to ₹100 above ₹149." onPress={openNew} />
        )}
        {coupons.length > 0 && (
          <View className="admin-list">
            {coupons.map((c, i) => (
              <Pressable key={c.id} onPress={() => router.push({ pathname: "/admin/meals/coupons/[id]", params: { id: String(c.id) } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: STATE[c.state].done ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`Edit coupon ${c.code}`}>
                <View className="admin-row__icon"><SymbolView name={{ ios: "tag.fill", android: "sell", web: "sell" }} size={16} tintColor={colors.primaryText} /></View>
                <View className="min-w-0 flex-1">
                  <Text className="card__title" numberOfLines={1}>{`${c.code} · ${c.off}`}</Text>
                  <Text className="meta-text" numberOfLines={1}>{[STATE[c.state].label, c.above, `${c.uses ?? 0} used`, c.endsOn ? `till ${c.endsOn}` : null].filter(Boolean).join(" · ")}</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </AdminScreen>
  );
}
