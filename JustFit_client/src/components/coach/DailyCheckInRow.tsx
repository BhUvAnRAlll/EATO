import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { checkInsOn, refreshCheckIns, setCheckInsOn } from "@/lib/coachCheckIns";
import { haptic } from "@/lib/haptics";
import { useSwitchColors, useThemeColors } from "@/theme";

// The Coach tab's Daily check-in switch: a notification every evening at 8:30 pm, sent by the phone
// itself; tapping it opens the chat, where the coach writes a note on the day. Turning it on asks for
// notification permission; if the phone refuses, the row links to Settings. Not on the web build.
export function DailyCheckInRow({ coachName }: { coachName: string | null }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    checkInsOn().then((value) => live && setOn(value));
    // The notification names the coach the member has now
    refreshCheckIns(coachName).catch(() => {});
    return () => {
      live = false;
    };
  }, [coachName]);

  if (Platform.OS === "web") return null;

  const toggle = async (next: boolean) => {
    haptic.select();
    setSaving(true);
    setOn(next);
    const result = await setCheckInsOn(next, coachName).catch((): "failed" => "failed");
    setSaving(false);
    setOn(result === "on");
    setDenied(result === "denied");
    setFailed(result === "failed");
  };

  return (
    <View className="coach__card flex-row items-center gap-3">
      <View className="coach__option-icon h-11 w-11">
        <SymbolView name={{ ios: "bell.fill", android: "notifications", web: "notifications" }} size={20} tintColor={colors.leaf} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="coach__option-title">Daily check-in</Text>
        <Text className="coach__option-note">{`${coachName ?? "Your coach"} sends a note on your day at 8:30 pm`}</Text>
        {denied && (
          <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6} accessibilityRole="link">
            <Text className="coach__hint" style={{ color: colors.danger }}>Notifications are off for justFit. Turn them on in Settings.</Text>
          </Pressable>
        )}
        {failed && <Text className="coach__hint" style={{ color: colors.danger }} accessibilityRole="alert">Couldn&apos;t set up the check-in just now. Try again.</Text>}
      </View>
      <Switch {...switchColors} value={on} disabled={saving} onValueChange={toggle} accessibilityLabel="Daily check-in" />
    </View>
  );
}
