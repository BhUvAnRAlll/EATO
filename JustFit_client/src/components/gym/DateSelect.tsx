import { useState } from "react";
import { Keyboard, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { shortDate, todayIso } from "@/data/gymDashboard";
import { useThemeColors } from "@/theme";

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// A labelled date as in the designs ("Date of Birth  [📅 Select]"): the button shows the chosen
// date and opens the phone's date picker, kept between `min` and `max` (YYYY-MM-DD)
export function DateSelect({ label, value, onChange, min, max, stacked = false }: { label: string; value: string | null; onChange: (iso: string) => void; min: string; max: string; stacked?: boolean }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    // The row wraps: a long label ("Pay the other ₹2,500 by") puts the date button on the next line
    // on a narrow phone instead of pushing it off the sheet (2026-11-08 audit, 320 wide)
    <View className={stacked ? "" : "flex-row flex-wrap items-center"} style={{ gap: stacked ? 8 : 12 }}>
      <Text className="gym-field__label" style={{ fontSize: 14, flexShrink: 1 }}>{label}</Text>
      <PressableScale onPress={() => { Keyboard.dismiss(); setOpen(true); }} className="gym-choice flex-row items-center self-start" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? shortDate(value) : "not set"}. Select`}>
        <GymIcon name="calendar" size={16} color={colors.gymPrimary} />
        <Text className="gym-choice__label">{value ? shortDate(value) : "Select"}</Text>
      </PressableScale>
      <DatePickerSheet
        visible={open}
        title={label}
        value={toDate(value ?? (max < todayIso() ? max : min > todayIso() ? min : todayIso()))}
        minimumDate={toDate(min)}
        maximumDate={toDate(max)}
        onSelect={(date) => onChange(toIso(date))}
        onClose={() => setOpen(false)}
        variant="gym"
      />
    </View>
  );
}
