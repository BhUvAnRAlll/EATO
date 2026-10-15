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

// Seven day rings, oldest first, graded by how much of the target was eaten. A day with
// nothing logged gets a dashed ring; future days can't be picked.
export function WeekStrip({ week, selectedDate, today, progress, onSelect, width }: WeekStripProps) {
  const ring = Math.max(30, Math.min(40, Math.floor((width - 6 * 6) / 7) - 6));
  return (
    <View className="flex-row justify-between">
      {week.map((date) => {
        const day = progress[date];
        const status = day?.status ?? "none";
        const selected = date === selectedDate;
        const future = date > today;
        return (
          <Pressable
            key={date}
            onPress={() => onSelect(date)}
            disabled={future}
            className="items-center gap-1.5 rounded-md px-1 py-1.5"
            style={{ backgroundColor: selected ? colors.forestSoft : "transparent", opacity: future ? 0.4 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${date}${date === today ? ", today" : ""}${status === "none" ? ", nothing logged" : `, ${Math.round((day?.ratio ?? 0) * 100)}% of target`}`}
          >
            <Ring size={ring} stroke={4} progress={status === "none" ? 0 : Math.max(0.08, day?.ratio ?? 0)} color={statusColor[status]} dashed={status === "none"}>
              <Text className="macro__ring-day" style={{ color: date === today ? colors.leaf : colors.forestInk }}>{Number(date.slice(8))}</Text>
            </Ring>
            <Text className="macro__weekday" style={selected ? { color: colors.forestInk } : undefined}>{weekdayInitial(date)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
