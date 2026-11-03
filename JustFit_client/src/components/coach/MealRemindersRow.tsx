import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { CoachPlan } from "@/lib/coach";
import { remindersOn, setRemindersOn } from "@/lib/mealReminders";
import { useSwitchColors, useThemeColors } from "@/theme";

type Props = {
  plan: CoachPlan;
  // The plan's day (today)
  date: string;
};

// Meal reminders on the Meal Plan screen: a notification at each planned meal's time ("Lunch at
// 1:30 PM"), sent by the phone itself. Turning it on asks for notification permission; if the
// phone refuses, the row says so and links to Settings. Not on the web build (no notifications).
export function MealRemindersRow({ plan, date }: Props) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    remindersOn().then((value) => live && setOn(value));
    return () => {
      live = false;
    };
  }, []);

  if (Platform.OS === "web") return null;

  const toggle = async (next: boolean) => {
    setSaving(true);
    setOn(next);
    const result = await setRemindersOn(next, plan, date);
    setSaving(false);
    setOn(result === "on");
    setDenied(result === "denied");
  };

  return (
    <View className="home__card flex-row items-center gap-3">
      <View className="macro__thumb" style={{ backgroundColor: colors.accentSoft }}>
        <SymbolView name={{ ios: "bell.fill", android: "notifications", web: "notifications" }} size={20} tintColor={colors.leaf} />
      </View>
      <View className="flex-1">
        <Text className="card__title">Meal reminders</Text>
        <Text className="meta-text">A notification at each meal’s time, to log it when you eat</Text>
        {denied && (
          <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6} accessibilityRole="link">
            <Text className="home__note mt-0.5" style={{ color: colors.danger }}>Notifications are off for justFit. Turn them on in Settings.</Text>
          </Pressable>
        )}
      </View>
      <Switch {...switchColors} value={on} disabled={saving} onValueChange={toggle} accessibilityLabel="Meal reminders" />
    </View>
  );
}
