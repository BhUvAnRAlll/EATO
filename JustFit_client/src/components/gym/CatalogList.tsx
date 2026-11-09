import { useCallback, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GradientFill } from "@/components/gym/GradientFill";
import { FAB_CLEARANCE, FloatingSlot, useFabOnScroll } from "@/components/FloatingSlot";
import { FilterChip } from "@/components/gym/GymChip";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { CATALOG_KINDS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind } from "@/lib/gymApi";
import { CatalogSheet } from "@/components/gym/CatalogSheet";
import { haptic } from "@/lib/haptics";
import { useCenteredChip } from "@/lib/useCenteredChip";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useGymSave } from "@/lib/gymForm";
import { useSwitchColors, useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

// Manage › Plan / Catalogue: the branch's price list by kind (Membership, PT, Service, Product).
// Each card (the GymOps designs) shows the item's image when it has one (a thumbnail), the name, a
// small pill (a plan's or PT package's length with a clock, a product's stock with a box; services
// have none) and the price; tapping it opens the Edit sheet; the + opens Add (CatalogSheet) for the
// kind shown. Gym Profile phase 2 (2026-11-09): tags for Best value, Inactive and Archived and the
// number of benefits; archived items only with "Show archived"; ↑ ↓ set the order members see
// (saved at once, PUT /api/gym/catalog/order).
type Pill = { icon: GymIconName; label: string; empty?: boolean };
function pillOf(item: CatalogItem): Pill | null {
  // Saved in days before 2026-11-07: shown as it is, with what to do to use it again
  if (item.duration && item.unit === "days") return { icon: "clock", label: `${planLabel(item.duration, item.unit)} · set in months to use`, empty: true };
  if (item.duration && item.unit) return { icon: "clock", label: planLabel(item.duration, item.unit) };
  if (item.kind === "product" && item.stock !== null) {
    return { icon: "boxes", label: item.stock === 0 ? "Out of stock" : `${item.stock} in stock`, empty: item.stock === 0 };
  }
  return null;
}

export function CatalogList() {
  const colors = useThemeColors();
  const fab = useFabOnScroll();
  const [kind, setKind] = useState<CatalogKind>("plan");
  // The selected chip stays in view (lib/useCenteredChip.ts)
  const { setRow, onRowLayout, onChipLayout } = useCenteredChip(kind);
  const load = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result, retry, set } = useGymData(load);
  // The Add / Edit sheet: which item (null for a new one), or closed
  const [sheet, setSheet] = useState<{ item: CatalogItem | null } | null>(null);
  // Role & Permission: adding and editing are Plans / Catalogue › Add, edit and delete plans
  const canEdit = useCan()("catalog.edit");
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  const all = result.state === "ready" ? result.data.items.filter((i) => i.kind === kind) : [];
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = all.filter((i) => i.status === "archived").length;
  const items = all.filter((i) => showArchived || i.status !== "archived");
  const switchColors = useSwitchColors();
  const order = useGymSave((data: { items: CatalogItem[] }) => set({ items: data.items }));
  // ↑ ↓ move an item past the next one shown (archived ones keep their place when hidden)
  const move = (id: number, step: -1 | 1) => {
    const shown = items.map((i) => i.id);
    const neighbour = shown[shown.indexOf(id) + step];
    if (neighbour === undefined || order.busy) return;
    const ids = all.map((i) => i.id).filter((x) => x !== id);
    const at = ids.indexOf(neighbour);
    ids.splice(step > 0 ? at + 1 : at, 0, id);
    order.save((token) => gymApi.orderItems(token, kind, ids));
  };

  return (
    <View className="flex-1">
      <ScrollView ref={setRow} onLayout={onRowLayout} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }} accessibilityRole="tablist">
        {CATALOG_KINDS.map((k) => {
          const selected = k.id === kind;
          return (
            <FilterChip key={k.id} onLayout={onChipLayout(k.id)} onPress={() => { if (!selected) haptic.select(); setKind(k.id); }} selected={selected} label={k.label} accessibilityLabel={k.label} />
          );
        })}
      </ScrollView>
      {/* Up to 100 items a branch: they scroll, with room under the last one for the + button */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: FAB_CLEARANCE, gap: 10 }} showsVerticalScrollIndicator={false} onScroll={fab.onScroll} scrollEventThrottle={fab.scrollEventThrottle}>
        {result.state === "loading" && <GymLoading label="Loading the catalogue" />}
        {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
        {result.state === "ready" && archivedCount > 0 && (
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text className="gym-tx__meta">{`Show archived (${archivedCount})`}</Text>
            <Switch value={showArchived} onValueChange={setShowArchived} {...switchColors} trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }} accessibilityLabel="Show archived items" />
          </View>
        )}
        {order.error ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{order.error}</Text> : null}
        {result.state === "ready" &&
          (items.length === 0 ? (
            <GymEmpty icon="clipboard-list" title={`No ${meta.noun}s yet`} text={`Tap + to add one, for example "${meta.example}". Its price fills in when you record a payment.`} />
          ) : (
            items.map((item, index) => {
              const pill = pillOf(item);
              const tags: { label: string; tone: "best" | "off" | "info" }[] = [
                ...(item.bestValue ? [{ label: "Best value", tone: "best" as const }] : []),
                ...(item.status === "inactive" ? [{ label: "Inactive", tone: "off" as const }] : []),
                ...(item.status === "archived" ? [{ label: "Archived", tone: "off" as const }] : []),
                ...(item.benefits?.length ? [{ label: `${item.benefits.length} benefit${item.benefits.length === 1 ? "" : "s"}`, tone: "info" as const }] : []),
              ];
              return (
                <View key={item.id} className="gym-plan">
                <PressableScale
                  onPress={canEdit ? () => setSheet({ item }) : undefined}
                  disabled={!canEdit}
                  style={{ gap: 10 }}
                  accessibilityRole={canEdit ? "button" : "text"}
                  accessibilityLabel={`${item.name}, ${pill ? `${pill.label}, ` : ""}${rupees(item.price)}${tags.length ? `, ${tags.map((t) => t.label).join(", ")}` : ""}${item.imageUrl ? ", with image" : ""}${canEdit ? ". Edit" : ""}`}
                >
                  <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
                    {item.imageUrl && (
                      <View className="gym-item-image__thumb">
                        <MemberPhotoImage url={item.imageUrl} />
                      </View>
                    )}
                    <Text className="gym-plan__name" numberOfLines={1}>{item.name}</Text>
                    {canEdit && <GymIcon name="chevron-right" size={13} color={colors.gymInk} />}
                  </View>
                  <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
                    {pill ? (
                      // The pill gives way to the price on a narrow phone ("30 Days · set in months to use")
                      <View className="gym-plan__pill shrink" style={pill.empty ? { backgroundColor: colors.gymDangerSoft } : undefined}>
                        <GymIcon name={pill.icon} size={12} color={pill.empty ? colors.gymDanger : colors.gymMuted} />
                        <Text className="gym-plan__pill-label shrink" numberOfLines={2} style={pill.empty ? { color: colors.gymDanger } : undefined}>{pill.label}</Text>
                      </View>
                    ) : (
                      <View />
                    )}
                    <Text className="gym-plan__price">{rupees(item.price)}</Text>
                  </View>
                </PressableScale>
                  {(tags.length > 0 || (canEdit && items.length > 1)) && (
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <View className="min-w-0 flex-1 flex-row flex-wrap" style={{ gap: 6 }}>
                        {tags.map((t) => (
                          <View key={t.label} className="gym-tag" style={{ backgroundColor: t.tone === "best" ? colors.gymSuccessSoft : t.tone === "off" ? colors.gymWarningSoft : colors.gymPrimarySoft }}>
                            <Text className="gym-tag__label" style={{ color: t.tone === "best" ? colors.gymSuccess : t.tone === "off" ? colors.gymWarningInk : colors.gymPrimaryText }}>{t.label}</Text>
                          </View>
                        ))}
                      </View>
                      {canEdit && items.length > 1 && (
                        <>
                          <PressableScale onPress={() => move(item.id, -1)} disabled={index === 0 || order.busy} className="gym-icon-btn" style={{ opacity: index === 0 ? 0.35 : 1 }} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Move ${item.name} up`} accessibilityState={{ disabled: index === 0 || order.busy }}>
                            <GymIcon name="arrow-up" size={15} color={colors.gymPrimary} />
                          </PressableScale>
                          <PressableScale onPress={() => move(item.id, 1)} disabled={index === items.length - 1 || order.busy} className="gym-icon-btn" style={{ opacity: index === items.length - 1 ? 0.35 : 1 }} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Move ${item.name} down`} accessibilityState={{ disabled: index === items.length - 1 || order.busy }}>
                            <GymIcon name="arrow-down" size={15} color={colors.gymPrimary} />
                          </PressableScale>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          ))}
      </ScrollView>
      {canEdit && <FloatingSlot hidden={fab.hidden}>
        <PressableScale onPress={() => setSheet({ item: null })} haptic="tap" className="gym-fab-round" accessibilityRole="button" accessibilityLabel={`Add a ${meta.noun}`}>
          <GradientFill radius={26} />
          <GymIcon name="plus" size={22} color={colors.white} />
        </PressableScale>
      </FloatingSlot>}
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
