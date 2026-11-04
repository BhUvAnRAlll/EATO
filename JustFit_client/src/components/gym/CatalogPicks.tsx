import { useCallback } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";

// Above a form: the branch's catalogue items of one kind as chips ("3 Months · ₹4,000"); tapping
// one fills the form (onPick). Nothing in the catalogue yet: a link to Plans / Catalogue.
export function CatalogPicks({ kind, label, onPick }: { kind: CatalogKind; label: string; onPick: (item: CatalogItem) => void }) {
  const load = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result } = useGymData(load);
  if (result.state !== "ready") return null;
  const items = result.data.items.filter((i) => i.kind === kind);
  return (
    <View style={{ gap: 6 }}>
      <Text className="gym-field__label">{label}</Text>
      {items.length === 0 ? (
        <PressableScale onPress={() => router.push("/gym/manage?tab=catalog")} className="self-start" accessibilityRole="link" accessibilityLabel="Add prices in Plans / Catalogue">
          <Text className="gym-link" style={{ fontSize: 13 }}>Add prices in Plans / Catalogue</Text>
        </PressableScale>
      ) : (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {items.map((item) => (
            <PressableScale key={item.id} onPress={() => { haptic.select(); onPick(item); }} className="gym-choice" accessibilityRole="button" accessibilityLabel={`${item.name}, ${rupees(item.price)}`}>
              <Text className="gym-choice__label">{`${item.name} · ${rupees(item.price)}`}</Text>
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}
