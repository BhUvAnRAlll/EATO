import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { haptic } from "@/lib/haptics";
import { orderRemindersOn, setOrderRemindersOn } from "@/lib/orderReminders";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors, useThemeColors } from "@/theme";

// Order reminders on Home: a notification half an hour before each meal time stops taking orders,
// sent by the phone itself. Turning it on asks for notification permission; if the phone refuses,
// the row links to Settings. Not on the web build (no notifications).
export function OrderRemindersRow({ pick }: { pick: { name: string; price: number } | null }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    orderRemindersOn().then((value) => live && setOn(value));
    return () => {
      live = false;
    };
  }, []);

  if (Platform.OS === "web") return null;

  const toggle = async (next: boolean) => {
    haptic.select();
    setSaving(true);
    setOn(next);
    const result = await setOrderRemindersOn(next, await getToken().catch(() => null), pick).catch((): "failed" => "failed");
    setSaving(false);
    setOn(result === "on");
    setDenied(result === "denied");
    setFailed(result === "failed");
  };

  return (
    <View className="home__card flex-row items-center gap-3">
      <View className="macro__thumb" style={{ backgroundColor: colors.accentSoft }}>
        <SymbolView name={{ ios: "bell.fill", android: "notifications", web: "notifications" }} size={20} tintColor={colors.leaf} />
      </View>
      <View className="flex-1">
        <Text className="card__title">Order reminders</Text>
        <Text className="meta-text">A nudge 30 minutes before breakfast, lunch or dinner orders close, and when meals wait in your cart</Text>
        {denied && (
          <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6} accessibilityRole="link">
            <Text className="home__note mt-0.5" style={{ color: colors.danger }}>Notifications are off for justFit. Turn them on in Settings.</Text>
          </Pressable>
        )}
        {failed && <Text className="home__note mt-0.5" style={{ color: colors.danger }} accessibilityRole="alert">Couldn&apos;t set up reminders just now. Try again.</Text>}
      </View>
      <Switch {...switchColors} value={on} disabled={saving} onValueChange={toggle} accessibilityLabel="Order reminders" />
    </View>
  );
}
