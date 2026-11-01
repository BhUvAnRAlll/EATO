import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { Ring } from "@/components/macro/Ring";
import { weekdayInitial, type DayProgress, type DayStatus } from "@/lib/macro";
import { useThemeColors, Palette } from "@/theme";

export const statusColor = (colors: Palette): Record<DayStatus, string> => ({ none: colors.creamLine, complete: colors.success, partial: colors.warning, low: colors.danger });
// The picked tile's tint and the day number's colour follow the day's standing
const statusTile: Record<DayStatus, string> = { none: "macro__day-tile--selected", complete: "macro__day-tile--complete", partial: "macro__day-tile--partial", low: "macro__day-tile--low" };
const statusText = (colors: Palette): Record<DayStatus, string> => ({ none: colors.primaryText, complete: colors.success, partial: colors.warning, low: colors.danger });

type WeekStripProps = {
  week: string[];
  selectedDate: string;
  today: string;
  progress: Record<string, DayProgress>;
  onSelect: (date: string) => void;
  width: number;
};

// Seven day tiles, oldest first: the date in a thin ring graded by how much of the target was
// eaten (dashed when nothing was logged; a day that reached its target is a solid green disc),
// the weekday under it. The picked day sits on a tile tinted in its standing's colour, today on
// grey; future days can't be picked.
export function WeekStrip({ week, selectedDate, today, progress, onSelect, width }: WeekStripProps) {
  const colors = useThemeColors();
  const gap = 6;
  const tile = Math.floor((width - gap * 6) / 7);
  const ring = Math.max(28, Math.min(34, tile - 14));
  const stroke = 3;
  return (
    <View className="flex-row justify-between" style={{ gap }}>
      {week.map((date) => {
        const day = progress[date];
        const status = day?.status ?? "none";
        const selected = date === selectedDate;
        const future = date > today;
        const done = status === "complete";
        const tileClass = selected ? `macro__day-tile ${statusTile[status]}` : date === today ? "macro__day-tile macro__day-tile--today" : "macro__day-tile";
        return (
          <PressableScale haptic="select"
            key={date}
            onPress={() => onSelect(date)}
            disabled={future}
            className={tileClass}
            style={{ width: tile, opacity: future ? 0.4 : 1 }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${date}${date === today ? ", today" : ""}${status === "none" ? ", nothing logged" : `, ${Math.round((day?.ratio ?? 0) * 100)}% of target`}`}
          >
            <Ring size={ring} stroke={stroke} progress={status === "none" ? 0 : Math.max(0.08, day?.ratio ?? 0)} color={statusColor(colors)[status]} trackColor={selected && status !== "none" ? colors.white : colors.creamLine} dashed={status === "none"}>
              {done && <View className="macro__day-disc" style={{ width: ring - stroke * 2, height: ring - stroke * 2 }} />}
              <Text className="macro__ring-day" style={{ color: done ? colors.white : selected ? statusText(colors)[status] : colors.ink }}>{Number(date.slice(8))}</Text>
            </Ring>
            <Text className="macro__weekday" style={selected ? { color: statusText(colors)[status] } : undefined}>{weekdayInitial(date)}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
