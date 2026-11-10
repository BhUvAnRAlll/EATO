import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { AdminField } from "@/components/admin/AdminField";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { hud } from "@/lib/hud";
import { kitchensApi, type DeliveryArea } from "@/lib/kitchensApi";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors, useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));
const PINCODE = /^[1-9][0-9]{5}$/;

// Super Admin › Meals › Delivery areas (2026-11-10, the user's request): the pincodes justFit
// delivers to. Add one with its area name, rename it, switch deliveries there off and on, or
// remove it. A member's address outside the active list is saved but can't be delivered to.
// Each area shows the kitchens that serve it: with none, orders there have no kitchen to go to.
export default function AdminDeliveryAreas() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { result, retry, set, refreshing, refresh } = useGymData(kitchensApi.deliveryAreas);
  const [pincode, setPincode] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ pincode: string; area: string } | null>(null);

  // Every change answers the whole list again
  const apply = async (key: string, call: (token: string | null) => ReturnType<typeof kitchensApi.deliveryAreas>, done: string) => {
    if (busy) return false;
    setBusy(key);
    setError(null);
    const answer = await call(await getToken().catch(() => null));
    setBusy(null);
    if (!answer.ok) {
      setError(answer.error);
      return false;
    }
    set(answer.data);
    hud.success(done);
    return true;
  };

  const add = async () => {
    if (!PINCODE.test(pincode)) return setError("Enter the 6-digit pincode.");
    const ok = await apply("add", (token) => kitchensApi.addDeliveryArea(token, pincode, area.trim()), `Delivering to ${pincode}`);
    if (ok) {
      setPincode("");
      setArea("");
    }
  };
  const remove = async (a: DeliveryArea) => {
    const sure = await confirmChoice({
      title: `Remove ${a.pincode}?`,
      message: a.addresses ? `${a.addresses} saved ${a.addresses === 1 ? "address is" : "addresses are"} there; they stay saved but can't be delivered to.` : "justFit stops delivering there.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (sure) await apply(`remove-${a.pincode}`, (token) => kitchensApi.removeDeliveryArea(token, a.pincode), `${a.pincode} removed`);
  };

  const areas = result.state === "ready" ? result.data.areas : [];
  const on = areas.filter((a) => a.active).length;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="Delivery areas" subtitle={result.state === "ready" ? `${on} of ${areas.length} on` : undefined} onBack={back} />
        <KeyboardAvoider>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />}>
            <Text className="meta-text">Members can order only to these pincodes. A kitchen must also serve the pincode (Meals › Kitchens) for its orders to go through.</Text>

            <View className="card" style={{ gap: 12 }}>
              <Text className="type-headline text-forest-ink">Add an area</Text>
              <AdminField label="Pincode" value={pincode} onChangeText={(t) => setPincode(t.replace(/[^0-9]/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="572103" maxLength={6} />
              <AdminField label="Area name (optional)" value={area} onChangeText={(t) => setArea(t.slice(0, 80))} placeholder="Tumakuru" maxLength={80} />
              <Pressable onPress={add} disabled={busy !== null || pincode.length !== 6} className={pincode.length === 6 ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
                {busy === "add" && <ActivityIndicator size="small" color={colors.onPrimary} />}
                <Text className={pincode.length === 6 ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>Add area</Text>
              </Pressable>
            </View>

            {error ? <FormAlert message={error} /> : null}
            {result.state === "loading" && <ScreenSkeleton label="Loading delivery areas" />}
            {result.state === "failed" && (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the areas" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
            )}
            {result.state === "ready" && areas.length === 0 && (
              <DashedBlock icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} title="No delivery areas yet" text="Add a pincode above: members can't order until there's one." />
            )}

            {areas.map((a) => {
              const kitchens = a.kitchens.filter((k) => k.active);
              return (
                <View key={a.pincode} className="card" style={{ gap: 10, opacity: a.active ? 1 : 0.75 }}>
                  <View className="flex-row items-center" style={{ gap: 10 }}>
                    <View className="flex-1" style={{ gap: 2 }}>
                      <Text className="type-headline text-forest-ink">{a.area ? `${a.pincode} · ${a.area}` : a.pincode}</Text>
                      <Text className="meta-text">{a.active ? "Delivering here" : "Off: members can't order here"}</Text>
                    </View>
                    {busy === `toggle-${a.pincode}` ? (
                      <ActivityIndicator color={colors.leaf} />
                    ) : (
                      <Switch
                        value={a.active}
                        onValueChange={(value) => void apply(`toggle-${a.pincode}`, (token) => kitchensApi.editDeliveryArea(token, a.pincode, { active: value }), value ? `Delivering to ${a.pincode}` : `${a.pincode} turned off`)}
                        {...switchColors}
                        accessibilityLabel={`Deliver to ${a.pincode}`}
                      />
                    )}
                  </View>
                  <Text className="meta-text" style={kitchens.length === 0 && a.active ? { color: colors.danger } : undefined}>
                    {kitchens.length ? `Served by ${kitchens.map((k) => k.name).join(", ")}` : "No active kitchen serves this pincode yet"}
                  </Text>
                  <Text className="meta-text">{`${a.addresses} saved ${a.addresses === 1 ? "address" : "addresses"} here`}</Text>

                  {renaming?.pincode === a.pincode ? (
                    <View style={{ gap: 10 }}>
                      <AdminField label="Area name" value={renaming.area} onChangeText={(t) => setRenaming({ pincode: a.pincode, area: t.slice(0, 80) })} placeholder="Tumakuru" maxLength={80} autoFocus />
                      <View className="flex-row" style={{ gap: 10 }}>
                        <Pressable onPress={() => setRenaming(null)} className="btn-outline flex-1" accessibilityRole="button">
                          <Text className="btn-outline__label">Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={async () => {
                            if (await apply(`rename-${a.pincode}`, (token) => kitchensApi.editDeliveryArea(token, a.pincode, { area: renaming.area.trim() }), "Area renamed")) setRenaming(null);
                          }}
                          className="btn-forest flex-1"
                          accessibilityRole="button"
                        >
                          {busy === `rename-${a.pincode}` && <ActivityIndicator size="small" color={colors.onPrimary} />}
                          <Text className="btn-forest__label">Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View className="flex-row" style={{ gap: 10 }}>
                      <Pressable onPress={() => setRenaming({ pincode: a.pincode, area: a.area ?? "" })} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Rename ${a.pincode}`}>
                        <Text className="type-caption text-ink">Rename</Text>
                      </Pressable>
                      <Pressable onPress={() => remove(a)} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Remove ${a.pincode}`}>
                        <Text className="type-caption" style={{ color: colors.danger }}>Remove</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
