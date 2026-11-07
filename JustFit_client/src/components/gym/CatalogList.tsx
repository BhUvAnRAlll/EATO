import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GradientFill } from "@/components/gym/GradientFill";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { CATALOG_KINDS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { CatalogSheet } from "@/components/gym/CatalogSheet";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

// Manage › Plan / Catalogue: the branch's price list by kind (Membership, PT, Service, Product).
// Each card (the GymOps designs) shows the item's image when it has one (a thumbnail), the name, a
// small pill (a plan's or PT package's length with a clock, a product's stock with a box; services
// have none) and the price; tapping it opens the Edit sheet; the + opens Add (CatalogSheet) for the
// kind shown.
type Pill = { icon: GymIconName; label: string; empty?: boolean };
function pillOf(item: CatalogItem): Pill | null {
  if (item.duration && item.unit) return { icon: "clock", label: planLabel(item.duration, item.unit) };
  if (item.kind === "product" && item.stock !== null) {
    return { icon: "boxes", label: item.stock === 0 ? "Out of stock" : `${item.stock} in stock`, empty: item.stock === 0 };
  }
  return null;
}

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
      {/* Up to 100 items a branch: they scroll, with room under the last one for the + button */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 96, gap: 10 }} showsVerticalScrollIndicator={false}>
        {result.state === "loading" && <GymLoading label="Loading the catalogue" />}
        {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
        {result.state === "ready" &&
          (items.length === 0 ? (
            <GymEmpty icon="clipboard-list" title={`No ${meta.noun}s yet`} text={`Tap + to add one, for example "${meta.example}". Its price fills in when you record a payment.`} />
          ) : (
            items.map((item) => {
              const pill = pillOf(item);
              return (
                <PressableScale
                  key={item.id}
                  onPress={() => setSheet({ item })}
                  className="gym-plan"
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${pill ? `${pill.label}, ` : ""}${rupees(item.price)}${item.imageUrl ? ", with image" : ""}. Edit`}
                >
                  <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
                    {item.imageUrl && (
                      <View className="gym-item-image__thumb">
                        <MemberPhotoImage url={item.imageUrl} />
                      </View>
                    )}
                    <Text className="gym-plan__name" numberOfLines={1}>{item.name}</Text>
                    <GymIcon name="chevron-right" size={13} color={colors.gymInk} />
                  </View>
                  <View className="flex-row items-center justify-between">
                    {pill ? (
                      <View className="gym-plan__pill" style={pill.empty ? { backgroundColor: colors.gymDangerSoft } : undefined}>
                        <GymIcon name={pill.icon} size={12} color={pill.empty ? colors.gymDanger : colors.gymMuted} />
                        <Text className="gym-plan__pill-label" style={pill.empty ? { color: colors.gymDanger } : undefined}>{pill.label}</Text>
                      </View>
                    ) : (
                      <View />
                    )}
                    <Text className="gym-plan__price">{rupees(item.price)}</Text>
                  </View>
                </PressableScale>
              );
            })
          ))}
      </ScrollView>
      <View className="absolute" style={{ right: 16, bottom: 16 }}>
        <PressableScale onPress={() => setSheet({ item: null })} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel={`Add a ${meta.noun}`}>
          <GradientFill radius={26} />
          <GymIcon name="plus" size={22} color={colors.white} />
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
