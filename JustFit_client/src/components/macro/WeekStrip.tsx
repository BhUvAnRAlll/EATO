import { Pressable, Text, View } from "react-native";

import { Ring } from "@/components/macro/Ring";
import { weekdayInitial, type DayProgress, type DayStatus } from "@/lib/macro";
import { colors } from "@/theme";

export const statusColor: Record<DayStatus, string> = { none: colors.creamLine, complete: colors.success, partial: colors.warning, low: colors.danger };

type WeekStripProps = {
  week: string[];
  selectedDate: string;
  today: string;
  progress: Record<string, DayProgress>;
  onSelect: (date: string) => void;
  width: number;
};

// Seven day tiles, oldest first: the date in a thin ring graded by how much of the target was
// eaten (dashed when nothing was logged), the weekday under it. The picked day is on red, today
// on grey; future days can't be picked.
export function WeekStrip({ week, selectedDate, today, progress, onSelect, width }: WeekStripProps) {
  const gap = 6;
  const tile = Math.floor((width - gap * 6) / 7);
  const ring = Math.max(28, Math.min(34, tile - 14));
  return (
    <View className="flex-row justify-between" style={{ gap }}>
      {week.map((date) => {
        const day = progress[date];
        const status = day?.status ?? "none";
        const selected = date === selectedDate;
        const future = date > today;
        const tileClass = selected ? "macro__day-tile macro__day-tile--selected" : date === today ? "macro__day-tile macro__day-tile--today" : "macro__day-tile";
        return (
          <Pressable
            key={date}
            onPress={() => onSelect(date)}
            disabled={future}
            className={tileClass}
            style={{ width: tile, opacity: future ? 0.4 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${date}${date === today ? ", today" : ""}${status === "none" ? ", nothing logged" : `, ${Math.round((day?.ratio ?? 0) * 100)}% of target`}`}
          >
            <Ring size={ring} stroke={3} progress={status === "none" ? 0 : Math.max(0.08, day?.ratio ?? 0)} color={selected ? colors.primary : statusColor[status]} trackColor={selected ? colors.white : colors.creamLine} dashed={status === "none"}>
              <Text className="macro__ring-day" style={{ color: selected ? colors.primaryText : colors.ink }}>{Number(date.slice(8))}</Text>
            </Ring>
            <Text className="macro__weekday" style={selected ? { color: colors.primaryText } : undefined}>{weekdayInitial(date)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
