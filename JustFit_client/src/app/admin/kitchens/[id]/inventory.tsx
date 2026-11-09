import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { IngredientPickerSheet } from "@/components/admin/IngredientPickerSheet";
import { StockItemSheet } from "@/components/admin/StockItemSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { INGREDIENT_CATEGORY_LABEL } from "@/data/kitchens";
import { hud } from "@/lib/hud";
import { kitchensApi, type Kitchen, type StockFilter, type StockItem } from "@/lib/kitchensApi";
import { rupees } from "@/lib/mealRules";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const FILTERS: { value: StockFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
  { value: "expiring", label: "Expiring" },
];

// Super Admin › Kitchens › a kitchen › Inventory (Meal Operations phase 2): the stock's value and
// today's use and waste; All / Low / Out / Expiring (within 3 days) with counts; search by name or
// supplier; each ingredient with its quantity against its minimum. Tap one to buy, use, waste,
// count, send it to another kitchen or change its details; Add puts an ingredient on the list.
export default function KitchenInventory() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const kitchenId = Number(id);
  const [filter, setFilter] = useState<StockFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [others, setOthers] = useState<Kitchen[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    (async () => {
      const answer = await kitchensApi.list(await getToken(), { status: "active" });
      if (answer.ok) setOthers(answer.data.kitchens.filter((k) => k.id !== kitchenId));
    })();
  }, [getToken, kitchenId]);
  const load = useCallback((t: string | null) => kitchensApi.inventory(t, kitchenId, filter, query), [kitchenId, filter, query]);
  const { result, retry, refresh, reload } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;

  const add = async (ingredientId: number) => {
    const answer = await kitchensApi.saveStock(await getToken(), kitchenId, ingredientId, { minQuantity: 0, unitPrice: null, supplier: null, expiresOn: null, storage: null });
    if (!answer.ok) return hud.error(answer.error);
    reload();
    setOpen(ingredientId);
  };

  const tag = (i: StockItem) => (i.out ? "Out" : i.expired ? "Expired" : i.low ? "Low" : i.expiring ? "Expiring" : null);

  return (
    <AdminScreen
      title="Inventory"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={() => setAdding(true)} hitSlop={8} className="admin-chip admin-chip--on flex-row" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel="Add ingredient">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">Add</Text>
        </Pressable>
      }
    >
      <View style={{ gap: 14 }}>
        {data && (
          <View className="card flex-row" style={{ gap: 12 }}>
            <View className="flex-1"><Text className="meta-text">Stock value</Text><Text className="card__title">{rupees(data.value)}</Text></View>
            <View className="flex-1"><Text className="meta-text">Used today</Text><Text className="card__title">{rupees(data.today.used.value)}</Text></View>
            <View className="flex-1"><Text className="meta-text">Wasted today</Text><Text className="card__title" style={{ color: data.today.wasted.value > 0 ? colors.danger : colors.ink }}>{rupees(data.today.wasted.value)}</Text></View>
          </View>
        )}
        <View className="search search--pill search--on-page">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Ingredient or supplier" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search the inventory" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const selected = filter === f.value;
            return (
              <Pressable key={f.value} onPress={() => setFilter(f.value)} className={selected ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected }}>
                <Text className={selected ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{data ? `${f.label} · ${data.counts[f.value]}` : f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {result.state === "loading" && <ScreenSkeleton label="Loading the inventory" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the inventory" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {data && data.items.length === 0 && (
          <DashedBlock
            icon={{ ios: "shippingbox", android: "inventory_2", web: "inventory_2" }}
            title={filter !== "all" || query ? "Nothing here" : "No stock yet"}
            text={filter !== "all" || query ? "Try another filter or search." : "Add the ingredients this kitchen keeps, then record what you buy."}
            onPress={filter !== "all" || query ? undefined : () => setAdding(true)}
          />
        )}
        {data && data.items.length > 0 && (
          <View className="admin-list">
            {data.items.map((i, n) => {
              const t = tag(i);
              return (
                <Pressable key={i.ingredientId} onPress={() => setOpen(i.ingredientId)} className={n === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button" accessibilityLabel={`${i.name}, ${i.quantity} ${i.unit}${t ? `, ${t}` : ""}`}>
                  <View className="min-w-0 flex-1">
                    <Text className="card__title" numberOfLines={1}>{i.name}</Text>
                    <Text className="meta-text" numberOfLines={1}>{[INGREDIENT_CATEGORY_LABEL[i.category], `min ${i.minQuantity} ${i.unit}`, i.supplier].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text className="card__title" style={{ color: i.out || i.low || i.expired ? colors.danger : colors.ink }}>{`${i.quantity} ${i.unit}`}</Text>
                    {t ? <Text className="meta-text" style={{ color: colors.danger }}>{t}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {open !== null && <StockItemSheet kitchenId={kitchenId} ingredientId={open} kitchens={others} onChanged={reload} onClose={() => setOpen(null)} />}
      {adding && <IngredientPickerSheet taken={data?.items.map((i) => i.ingredientId) ?? []} onPick={(ing) => void add(ing.id)} onClose={() => setAdding(false)} />}
    </AdminScreen>
  );
}
