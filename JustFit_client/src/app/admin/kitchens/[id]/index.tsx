import { useCallback, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { KitchenStaffSheet } from "@/components/admin/KitchenStaffSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KITCHEN_PILL, KITCHEN_STATUSES, KITCHEN_STATUS_LABEL, STAFF_ROLE_LABEL, STATUS_REASONS } from "@/data/kitchens";
import { hud } from "@/lib/hud";
import { hoursLine } from "@/lib/kitchenRules";
import { kitchensApi, type Kitchen, type KitchenStaff, type KitchenStatus } from "@/lib/kitchensApi";
import { directionsUrl } from "@/lib/mealRules";
import { mealImage } from "@/lib/mealsApi";
import { confirmChoice, showActions } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);

// Super Admin › Kitchens › a kitchen: its photo, status (change it with a reason: active, closed for
// a while, under maintenance, inactive), contact (Call, Directions), hours, the pincodes it serves,
// capacity, and the staff roster (add, edit, remove). Orders reach kitchens from phase 3.
export default function AdminKitchen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((t: string | null) => kitchensApi.get(t, Number(id)), [id]);
  const { result, retry, refresh, update } = useGymData(load);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<KitchenStaff | "new" | null>(null);
  const kitchen = result.state === "ready" ? result.data.kitchen : null;
  const replace = (next: Kitchen) => update(() => ({ kitchen: next }));

  const setStatus = async (status: KitchenStatus, note: string | null) => {
    if (!kitchen || busy) return;
    setBusy(true);
    const answer = await kitchensApi.setStatus(await getToken(), kitchen.id, status, note);
    setBusy(false);
    if (!answer.ok) return hud.error(answer.error);
    replace(answer.data.kitchen);
    hud.success(KITCHEN_STATUS_LABEL[status]);
  };
  const changeStatus = () => {
    if (!kitchen) return;
    showActions({
      title: "Kitchen status",
      message: `Now: ${KITCHEN_STATUS_LABEL[kitchen.status]}`,
      actions: KITCHEN_STATUSES.filter((s) => s !== kitchen.status).map((s) => ({
        label: KITCHEN_STATUS_LABEL[s],
        destructive: s === "inactive",
        onPress: () => {
          if (s === "active") return void setStatus("active", null);
          showActions({ title: `${KITCHEN_STATUS_LABEL[s]}: why?`, actions: STATUS_REASONS[s].map((reason) => ({ label: reason, onPress: () => void setStatus(s, reason) })) });
        },
      })),
    });
  };

  const saveStaff = async (person: KitchenStaff | null, input: Parameters<typeof kitchensApi.addStaff>[2]) => {
    if (!kitchen) return "Please try again.";
    const t = await getToken();
    const answer = person ? await kitchensApi.editStaff(t, kitchen.id, person.id, input) : await kitchensApi.addStaff(t, kitchen.id, input);
    if (!answer.ok) return answer.error;
    replace(answer.data.kitchen);
    hud.success(person ? "Staff saved" : "Added to staff");
    return null;
  };
  const removeStaff = async (person: KitchenStaff) => {
    if (!kitchen) return;
    const sure = await confirmChoice({ title: `Remove ${person.name}?`, message: "They leave this kitchen's staff list.", confirmLabel: "Remove", destructive: true });
    if (!sure) return;
    const answer = await kitchensApi.removeStaff(await getToken(), kitchen.id, person.id);
    if (!answer.ok) return hud.error(answer.error);
    replace(answer.data.kitchen);
    hud.success("Removed from staff");
  };
  const open = (url: string | null, what: string) => {
    if (url) Linking.openURL(url).catch(() => hud.error(`Couldn't open ${what}`));
  };

  return (
    <AdminScreen
      title={kitchen?.name ?? "Kitchen"}
      subtitle={kitchen?.code}
      onRefresh={refresh}
      headerRight={
        kitchen ? (
          <Pressable onPress={() => router.push({ pathname: "/admin/kitchens/[id]/edit", params: { id: String(kitchen.id) } })} hitSlop={8} className="admin-chip" accessibilityRole="button" accessibilityLabel="Edit kitchen">
            <Text className="admin-segment__label admin-segment__label--on">Edit</Text>
          </Pressable>
        ) : undefined
      }
    >
      {result.state === "loading" && <ScreenSkeleton label="Loading the kitchen" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the kitchen" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {kitchen && (
        <View style={{ gap: 14 }}>
          {kitchen.photoUrl ? (
            <View className="meal__card" style={{ aspectRatio: 16 / 9 }}>
              <Image source={mealImage(kitchen.photoUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} accessibilityLabel={`${kitchen.name} photo`} />
            </View>
          ) : null}

          <View className="card" style={{ gap: 10 }}>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <View className={KITCHEN_PILL[kitchen.status].box}><Text className={KITCHEN_PILL[kitchen.status].label}>{KITCHEN_STATUS_LABEL[kitchen.status]}</Text></View>
              <Text className="meta-text flex-1">{kitchen.status === "active" ? (kitchen.openNow ? "Open now" : "Closed now") : "Not taking orders"}</Text>
            </View>
            {kitchen.statusNote ? <Text className="type-body text-forest-ink">{kitchen.statusNote}</Text> : null}
            {kitchen.statusChangedAt ? <Text className="meta-text">{`Since ${when(kitchen.statusChangedAt)}`}</Text> : null}
            <Pressable onPress={changeStatus} disabled={busy} className="admin-chip self-start" accessibilityRole="button">
              <Text className="admin-segment__label admin-segment__label--on">{busy ? "Saving…" : "Change status"}</Text>
            </Pressable>
          </View>

          <View className="card" style={{ gap: 8 }}>
            <Text className="card__title">Contact</Text>
            <Text className="type-body text-forest-ink">{`${kitchen.contactName} · +91 ${kitchen.phone}`}</Text>
            {kitchen.email ? <Text className="meta-text">{kitchen.email}</Text> : null}
            <Text className="meta-text">{[kitchen.address, kitchen.area, kitchen.city, kitchen.pincode].filter(Boolean).join(", ")}</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <Pressable onPress={() => open(`tel:${kitchen.phone}`, "the phone app")} className="admin-chip flex-1 flex-row" style={{ gap: 6 }} accessibilityRole="button">
                <SymbolView name={{ ios: "phone.fill", android: "call", web: "call" }} size={15} tintColor={colors.leaf} />
                <Text className="admin-segment__label admin-segment__label--on">Call</Text>
              </Pressable>
              <Pressable onPress={() => open(directionsUrl({ latitude: kitchen.latitude, longitude: kitchen.longitude, line: `${kitchen.address}, ${kitchen.city} ${kitchen.pincode}` }), "maps")} className="admin-chip flex-1 flex-row" style={{ gap: 6 }} accessibilityRole="button">
                <SymbolView name={{ ios: "map.fill", android: "map", web: "map" }} size={15} tintColor={colors.leaf} />
                <Text className="admin-segment__label admin-segment__label--on">Directions</Text>
              </Pressable>
            </View>
          </View>

          <View className="card" style={{ gap: 6 }}>
            <Text className="card__title">Hours and capacity</Text>
            <Text className="type-body text-forest-ink">{hoursLine(kitchen.hours)}</Text>
            <Text className="meta-text">{`${kitchen.maxDailyOrders} orders a day · ${kitchen.prepCapacity} meals a meal time · ${kitchen.radiusKm} km radius`}</Text>
          </View>

          <View className="card" style={{ gap: 8 }}>
            <Text className="card__title">{`Delivers to ${kitchen.pincodes?.length ?? 0} ${(kitchen.pincodes?.length ?? 0) === 1 ? "pincode" : "pincodes"}`}</Text>
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {(kitchen.pincodes ?? []).map((p) => (
                <View key={p} className="kitchen-pill kitchen-pill--active"><Text className="kitchen-pill__label kitchen-pill__label--active">{p}</Text></View>
              ))}
            </View>
          </View>

          <View className="flex-row items-center">
            <Text className="setup__section flex-1">{`Staff (${kitchen.staff?.length ?? 0})`}</Text>
            <Pressable onPress={() => setEditing("new")} hitSlop={8} className="admin-chip admin-chip--on flex-row" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel="Add staff">
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
              <Text className="admin-segment__label admin-segment__label--on">Add</Text>
            </Pressable>
          </View>
          {(kitchen.staff ?? []).length === 0 ? (
            <DashedBlock icon={{ ios: "person.2", android: "group", web: "group" }} title="No staff listed" text="Add the kitchen manager, chefs and preparation staff." onPress={() => setEditing("new")} />
          ) : (
            <View className="admin-list">
              {(kitchen.staff ?? []).map((p, i) => (
                <View key={p.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}>
                  <Pressable onPress={() => setEditing(p)} className="min-w-0 flex-1" accessibilityRole="button" accessibilityLabel={`Edit ${p.name}, ${STAFF_ROLE_LABEL[p.role]}`}>
                    <Text className="card__title" numberOfLines={1}>{p.name}</Text>
                    <Text className="meta-text" numberOfLines={1}>{[STAFF_ROLE_LABEL[p.role], `+91 ${p.phone}`, p.available ? null : "Away", p.note].filter(Boolean).join(" · ")}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeStaff(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
                    <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={17} tintColor={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {editing && <KitchenStaffSheet person={editing === "new" ? null : editing} onSave={(input) => saveStaff(editing === "new" ? null : editing, input)} onClose={() => setEditing(null)} />}
    </AdminScreen>
  );
}
