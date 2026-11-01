import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { Ring } from "@/components/macro/Ring";
import { fonts } from "@/constants/fonts";
import { type DayProgress, type DayStatus } from "@/lib/macro";
import { useThemeColors, Palette } from "@/theme";

export const statusColor = (colors: Palette): Record<DayStatus, string> => ({ none: colors.creamLine, complete: colors.success, partial: colors.warning, low: colors.danger });
// The picked day's number follows the day's standing
const statusText = (colors: Palette): Record<DayStatus, string> => ({ none: colors.ink, complete: colors.success, partial: colors.warning, low: colors.danger });

// "Mon" from "2026-10-26"
const weekdayShort = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });

type WeekStripProps = {
  week: string[];
  selectedDate: string;
  today: string;
  progress: Record<string, DayProgress>;
  onSelect: (date: string) => void;
  width: number;
};

// Seven days, oldest first, straight on the page (no tiles): the weekday over the date, the date
// in a thin ring graded by how much of the target was eaten (dotted when nothing was logged; a
// day that reached its target is a solid green disc). The picked day's weekday and number are
// bold; future days can't be picked.
export function WeekStrip({ week, selectedDate, today, progress, onSelect, width }: WeekStripProps) {
  const colors = useThemeColors();
  const column = Math.floor(width / 7);
  const ring = Math.max(32, Math.min(44, column - 6));
  const stroke = 3;
  return (
    <View className="flex-row justify-between">
      {week.map((date) => {
        const day = progress[date];
        const status = day?.status ?? "none";
        const selected = date === selectedDate;
        const future = date > today;
        const done = status === "complete";
        return (
          <PressableScale haptic="select"
            key={date}
            onPress={() => onSelect(date)}
            disabled={future}
            className="items-center"
            style={{ width: column, gap: 10, opacity: future ? 0.4 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${date}${date === today ? ", today" : ""}${status === "none" ? ", nothing logged" : `, ${Math.round((day?.ratio ?? 0) * 100)}% of target`}`}
          >
            <Text className="macro__weekday" style={selected ? { color: colors.ink, fontFamily: fonts.semibold } : undefined}>{weekdayShort(date)}</Text>
            <Ring size={ring} stroke={stroke} progress={status === "none" ? 0 : Math.max(0.08, day?.ratio ?? 0)} color={statusColor(colors)[status]} trackColor={selected && status === "none" ? colors.lineStrong : colors.creamLine} dashed={status === "none"}>
              {done && <View className="macro__day-disc" style={{ width: ring - stroke * 2, height: ring - stroke * 2 }} />}
              <Text className="macro__ring-day" style={{ fontSize: 15, lineHeight: 19, color: done ? colors.white : selected ? statusText(colors)[status] : colors.ink, fontFamily: selected ? "Poppins_700Bold" : undefined }}>{Number(date.slice(8))}</Text>
            </Ring>
          </PressableScale>
        );
      })}
    </View>
  );
}
