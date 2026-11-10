import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { ID_STATUS_LABEL, VEHICLE_LABEL } from "@/data/delivery";
import { deliveryApi, type Partner } from "@/lib/deliveryApi";
import { hud } from "@/lib/hud";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors, useThemeColors } from "@/theme";

// Super Admin › Delivery (Meal Operations phase 4): today's board (free partners, orders waiting for
// one, assigned, on the way, failed, delivered today) and every partner with what they carry now
// and an Available switch. Tap a partner to edit; + adds one. Orders are given to partners from the
// Orders tab.
export default function AdminDelivery() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { result, retry, refresh, update } = useGymData(deliveryApi.board);
  const [busyId, setBusyId] = useState<number | null>(null);
  const data = result.state === "ready" ? result.data : null;

  const setAvailable = async (p: Partner, available: boolean) => {
    if (busyId) return;
    setBusyId(p.id);
    const answer = await deliveryApi.setAvailable(await getToken(), p.id, available);
    setBusyId(null);
    if (!answer.ok) return hud.error(answer.error);
    update((d) => ({ ...d, partners: d.partners.map((x) => (x.id === p.id ? answer.data.partner : x)) }));
  };

  const stats = data
    ? ([
        ["Free partners", data.counts.free, false],
        ["Waiting for a partner", data.counts.unassigned, data.counts.unassigned > 0],
        ["Assigned", data.counts.assigned, false],
        ["On the way", data.counts.ongoing, false],
        ["Failed", data.counts.failed, data.counts.failed > 0],
        ["Delivered today", data.counts.delivered, false],
      ] as const)
    : [];

  return (
    <AdminScreen
      title="Delivery"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={() => router.push("/admin/delivery/new")} hitSlop={8} className="admin-chip admin-chip--on flex-row" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel="Add delivery partner">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">Add</Text>
        </Pressable>
      }
    >
      {result.state === "loading" && <ScreenSkeleton label="Loading deliveries" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load deliveries" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {data && (
        <View style={{ gap: 14 }}>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {stats.map(([label, value, warn]) => (
              <View key={label} className={warn ? "admin-stat admin-stat--half admin-stat--danger" : "admin-stat admin-stat--half"} accessibilityLabel={`${label}: ${value}`}>
                <Text className="admin-stat__label" numberOfLines={2}>{label}</Text>
                <Text className="admin-stat__value">{value}</Text>
              </View>
            ))}
          </View>
          {data.counts.unassigned > 0 ? (
            <Pressable onPress={() => router.push("/admin/orders")} className="admin-chip self-start" accessibilityRole="button">
              <Text className="admin-segment__label admin-segment__label--on">Give ready orders to partners</Text>
            </Pressable>
          ) : null}
          <Text className="admin-section__title">{`Partners (${data.partners.length})`}</Text>
          {data.partners.length === 0 ? (
            <DashedBlock icon={{ ios: "bicycle", android: "pedal_bike", web: "pedal_bike" }} title="No delivery partners yet" text="Add the people who deliver: their vehicle, ID check and the pincodes they cover." onPress={() => router.push("/admin/delivery/new")} />
          ) : (
            <View className="admin-list">
              {data.partners.map((p, i) => (
                <View key={p.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: p.active ? 1 : 0.6 }}>
                  <Pressable onPress={() => router.push({ pathname: "/admin/delivery/[id]", params: { id: String(p.id) } })} className="min-w-0 flex-1" accessibilityRole="button" accessibilityLabel={`Edit ${p.name}`}>
                    <Text className="card__title" numberOfLines={1}>{p.name}</Text>
                    <Text className="meta-text" numberOfLines={1}>{[VEHICLE_LABEL[p.vehicle], p.active ? null : "Inactive", p.idStatus === "verified" ? null : ID_STATUS_LABEL[p.idStatus]].filter(Boolean).join(" · ")}</Text>
                    <Text className="meta-text" numberOfLines={1}>{`Carrying ${p.carrying} of ${p.maxOrders} · ${p.deliveredToday} delivered today · ${p.pincodes.length} pincodes`}</Text>
                  </Pressable>
                  <Switch value={p.available} onValueChange={(v) => setAvailable(p, v)} disabled={busyId === p.id || !p.active} {...switchColors} accessibilityLabel={`${p.name} available`} />
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </AdminScreen>
  );
}
