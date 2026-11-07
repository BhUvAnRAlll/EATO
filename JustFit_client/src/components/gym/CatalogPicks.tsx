import { useCallback } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { pickable, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";

// Above a form: the branch's catalogue items of one kind as chips ("3 Months · ₹4,000"); tapping
// one fills the form (onPick) and `selected` (its id, kept by the form) shows which one was picked.
// A plan or PT package still saved in days (before 2026-11-07) is left out until it's edited to
// months. Nothing in the catalogue yet: a link to Plans / Catalogue.
export function CatalogPicks({ kind, label, selected, onPick }: { kind: CatalogKind; label: string; selected: number | null; onPick: (item: CatalogItem) => void }) {
  const load = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result } = useGymData(load);
  if (result.state !== "ready") return null;
  const items = result.data.items.filter((i) => i.kind === kind && pickable(i));
  return (
    <View style={{ gap: 6 }}>
      <Text className="gym-field__label">{label}</Text>
      {items.length === 0 ? (
        <PressableScale onPress={() => router.push("/gym/manage?tab=catalog")} className="self-start" accessibilityRole="link" accessibilityLabel="Add prices in Plans / Catalogue">
          <Text className="gym-link" style={{ fontSize: 13 }}>Add prices in Plans / Catalogue</Text>
        </PressableScale>
      ) : (
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
          {items.map((item) => {
            const isSelected = item.id === selected;
            return (
              <PressableScale key={item.id} onPress={() => { if (!isSelected) haptic.select(); onPick(item); }} className={isSelected ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="radio" accessibilityState={{ selected: isSelected }} accessibilityLabel={`${item.name}, ${rupees(item.price)}`}>
                <Text className={isSelected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{`${item.name} · ${rupees(item.price)}`}</Text>
              </PressableScale>
            );
          })}
        </View>
      )}
    </View>
  );
}
