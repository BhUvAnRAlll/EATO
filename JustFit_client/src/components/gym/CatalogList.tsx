import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GradientFill } from "@/components/gym/GradientFill";
import { CATALOG_KINDS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { CatalogSheet } from "@/components/gym/CatalogSheet";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Manage › Plan / Catalogue: the branch's price list by kind (Membership, PT, Service, Product).
// Each card shows the name, a small pill (the plan's length, or the kind) and the price; tapping
// it opens the Edit sheet; the + opens Add (CatalogSheet) for the kind shown.
export function CatalogList() {
  const colors = useThemeColors();
  const [kind, setKind] = useState<CatalogKind>("plan");
  const load = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result, retry, set } = useGymData(load);
  // The Add / Edit sheet: which item (null for a new one), or closed
  const [sheet, setSheet] = useState<{ item: CatalogItem | null } | null>(null);
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  const items = result.state === "ready" ? result.data.items.filter((i) => i.kind === kind) : [];

  return (
    <View className="flex-1">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }} accessibilityRole="tablist">
        {CATALOG_KINDS.map((k) => {
          const selected = k.id === kind;
          return (
            <PressableScale
              key={k.id}
              onPress={() => { if (!selected) haptic.select(); setKind(k.id); }}
              className={selected ? "gym-kind gym-kind--selected" : "gym-kind"}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={k.label}
            >
              {selected && <GradientFill radius={999} />}
              <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{k.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      <View className="flex-1 px-4 pt-3" style={{ gap: 10 }}>
        {result.state === "loading" && <GymLoading label="Loading the catalogue" />}
        {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
        {result.state === "ready" &&
          (items.length === 0 ? (
            <GymEmpty icon={{ ios: "list.bullet.rectangle", android: "list_alt", web: "list_alt" }} title={`No ${meta.noun}s yet`} text={`Tap + to add one, for example "${meta.example}". Its price fills in when you record a payment.`} />
          ) : (
            items.map((item) => (
              <PressableScale
                key={item.id}
                onPress={() => setSheet({ item })}
                className="gym-plan"
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.duration && item.unit ? planLabel(item.duration, item.unit) : meta.label}, ${rupees(item.price)}. Edit`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="gym-plan__name" numberOfLines={1}>{item.name}</Text>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymInk} />
                </View>
                <View className="flex-row items-center justify-between">
                  <View className="gym-plan__pill">
                    <SymbolView name={item.duration ? { ios: "clock", android: "schedule", web: "schedule" } : { ios: "tag", android: "sell", web: "sell" }} size={12} tintColor={colors.gymMuted} />
                    <Text className="gym-plan__pill-label">{item.duration && item.unit ? planLabel(item.duration, item.unit) : meta.label}</Text>
                  </View>
                  <Text className="gym-plan__price">{rupees(item.price)}</Text>
                </View>
              </PressableScale>
            ))
          ))}
      </View>
      <View className="absolute" style={{ right: 16, bottom: 16 }}>
        <PressableScale onPress={() => setSheet({ item: null })} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel={`Add a ${meta.noun}`}>
          <GradientFill radius={26} />
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={22} tintColor={colors.white} />
        </PressableScale>
      </View>
      {sheet && (
        <CatalogSheet
          kind={sheet.item?.kind ?? kind}
          item={sheet.item}
          onClose={() => setSheet(null)}
          onSaved={(updated) => {
            set({ items: updated });
            setSheet(null);
          }}
        />
      )}
    </View>
  );
}
