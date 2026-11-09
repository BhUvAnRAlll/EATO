import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KITCHEN_PILL, KITCHEN_STATUSES, KITCHEN_STATUS_LABEL } from "@/data/kitchens";
import { hoursLine } from "@/lib/kitchenRules";
import { kitchensApi, type Kitchen, type KitchenStatus } from "@/lib/kitchensApi";
import { mealImage } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// Super Admin › Kitchens (Meal Operations phase 1): every kitchen, Active first, filtered by status
// (with counts) and searched by name, area, city or a pincode it serves. A card opens the kitchen.
export default function AdminKitchens() {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const [status, setStatus] = useState<KitchenStatus | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback((t: string | null) => kitchensApi.list(t, { status, search: query }), [status, query]);
  const { result, retry, refresh } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;

  const filters: { value: KitchenStatus | null; label: string }[] = [{ value: null, label: "All" }, ...KITCHEN_STATUSES.map((s) => ({ value: s, label: KITCHEN_STATUS_LABEL[s] }))];

  const card = (k: Kitchen) => (
    <Pressable key={k.id} onPress={() => router.push({ pathname: "/admin/kitchens/[id]", params: { id: String(k.id) } })} className="card flex-row" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`${k.name}, ${KITCHEN_STATUS_LABEL[k.status]}`}>
      <View className="kitchen-thumb">
        {k.photoUrl ? (
          <Image source={mealImage(k.photoUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />
        ) : (
          <SymbolView name={{ ios: "frying.pan", android: "skillet", web: "skillet" }} size={24} tintColor={colors.primaryText} />
        )}
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 3 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="card__title flex-1" numberOfLines={1}>{k.name}</Text>
          <View className={KITCHEN_PILL[k.status].box}><Text className={KITCHEN_PILL[k.status].label}>{KITCHEN_STATUS_LABEL[k.status]}</Text></View>
        </View>
        <Text className="meta-text" numberOfLines={1}>{`${k.code} · ${[k.area, k.city].filter(Boolean).join(", ")}`}</Text>
        <Text className="meta-text" numberOfLines={1}>{`${k.status === "active" ? (k.openNow ? "Open now" : "Closed now") : "Not taking orders"} · ${hoursLine(k.hours)}`}</Text>
        <Text className="meta-text" numberOfLines={1}>{`${k.pincodeCount ?? 0} pincodes · ${k.staffCount ?? 0} staff · ${k.maxDailyOrders} orders a day`}</Text>
      </View>
    </Pressable>
  );

  return (
    <AdminScreen
      title="Kitchens"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={() => router.push("/admin/kitchens/new")} hitSlop={8} className="admin-chip admin-chip--on flex-row" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel="Add kitchen">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">Add</Text>
        </Pressable>
      }
    >
      <View style={{ gap: 14 }}>
        <View className="search search--pill search--on-page">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Name, area, city or pincode" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search kitchens" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {filters.map((f) => {
            const selected = status === f.value;
            const count = data ? data.counts[f.value ?? "all"] : null;
            return (
              <Pressable key={f.label} onPress={() => setStatus(f.value)} className={selected ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected }}>
                <Text className={selected ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{count === null ? f.label : `${f.label} · ${count}`}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {result.state === "loading" && <ScreenSkeleton label="Loading kitchens" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load kitchens" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {data && data.kitchens.length === 0 && (
          <DashedBlock
            icon={{ ios: "frying.pan", android: "skillet", web: "skillet" }}
            title={query || status ? "No kitchens match" : "No kitchens yet"}
            text={query || status ? "Try another search or status." : "Add the first kitchen: where it is, its hours, the pincodes it serves and how much it can cook."}
            onPress={query || status ? undefined : () => router.push("/admin/kitchens/new")}
          />
        )}
        {data && data.kitchens.length > 0 && <View style={{ gap: 10 }}>{data.kitchens.map(card)}</View>}
      </View>
    </AdminScreen>
  );
}
