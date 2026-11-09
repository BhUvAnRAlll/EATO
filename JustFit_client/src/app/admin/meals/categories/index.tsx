import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { TAG_LABEL } from "@/lib/mealRules";
import { kitchenApi, mealImage, type AdminCategory } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

/** How a category picks its meals, in a few words */
const listsWhat = (c: Pick<AdminCategory, "matchTag" | "maxPrice" | "mealIds">) =>
  c.matchTag ? `Every ${TAG_LABEL[c.matchTag].toLowerCase()} meal` : c.maxPrice ? `Every meal up to ₹${c.maxPrice}` : `${c.mealIds.length} picked ${c.mealIds.length === 1 ? "meal" : "meals"}`;

// Super Admin › Meals › Categories: the Meals tab's tiles (Under ₹99, High Protein…) and food
// categories (Biryani & Rice Bowls…), in their order. Tap one to edit it; New category adds one.
export default function AdminCategories() {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const { result, retry, refresh } = useGymData(kitchenApi.categories);
  const all = result.state === "ready" ? result.data.categories : [];
  const openNew = () => router.push({ pathname: "/admin/meals/categories/[id]", params: { id: "new" } });
  const group = (kind: "tile" | "food", title: string, line: string) => {
    const list = all.filter((c) => c.kind === kind);
    if (list.length === 0) return null;
    return (
      <View style={{ gap: 8 }}>
        <View>
          <Text className="type-headline text-forest-ink">{title}</Text>
          <Text className="meta-text">{line}</Text>
        </View>
        <View className="admin-list">
          {list.map((c, i) => (
            <Pressable key={c.id} onPress={() => router.push({ pathname: "/admin/meals/categories/[id]", params: { id: String(c.id) } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: c.active ? 1 : 0.6 }} accessibilityRole="button" accessibilityLabel={`Edit ${c.name}`}>
              <View className="items-center justify-center overflow-hidden rounded-md" style={{ width: 48, height: 48, backgroundColor: colors.creamDeep }}>
                {c.imageUrl ? <Image source={mealImage(c.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={18} tintColor={colors.faint} />}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="card__title" numberOfLines={1}>{c.name}</Text>
                <Text className="meta-text" numberOfLines={1}>{[listsWhat(c), c.featured ? "Row of cards" : null, c.active ? null : "Off"].filter(Boolean).join(" · ")}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  };
  return (
    <AdminScreen title="Categories" onRefresh={refresh}>
      <View style={{ gap: 18 }}>
        <Pressable onPress={openNew} className="btn-forest" accessibilityRole="button">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.onPrimary} />
          <Text className="btn-forest__label">New category</Text>
        </Pressable>
        {result.state === "loading" && <ScreenSkeleton label="Loading categories" />}
        {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load categories" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
        {result.state === "ready" && all.length === 0 && (
          <DashedBlock icon={{ ios: "square.grid.2x2", android: "grid_view", web: "grid_view" }} title="No categories yet" text="Add tiles like “Under ₹99” and food categories like “Biryani & Rice Bowls”. A category with no meals stays hidden." onPress={openNew} />
        )}
        {group("tile", "Tiles", "The photo tiles at the top of the Meals tab")}
        {group("food", "Food categories", "The round pictures; a “row of cards” one also shows its meals as a row")}
      </View>
    </AdminScreen>
  );
}
