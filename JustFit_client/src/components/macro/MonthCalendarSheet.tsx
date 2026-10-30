import { useEffect, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { Ring } from "@/components/macro/Ring";
import { statusColor } from "@/components/macro/WeekStrip";
import { dateOf, isoOf, macro, type DayProgress } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type MonthCalendarSheetProps = {
  visible: boolean;
  selectedDate: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
};

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
// Every day of the month containing `iso`, as YYYY-MM-DD
function monthDays(iso: string) {
  const first = dateOf(iso);
  first.setDate(1);
  const days: string[] = [];
  for (const d = new Date(first); d.getMonth() === first.getMonth(); d.setDate(d.getDate() + 1)) days.push(isoOf(d));
  return days;
}

// "Jump to a day": a month of day rings graded by calories, moving back from today
export function MonthCalendarSheet(props: MonthCalendarSheetProps) {
  // Mounted only while open, so each opening starts on the selected day's month
  return props.visible ? <CalendarBody {...props} /> : null;
}

function CalendarBody({ visible, selectedDate, today, onPick, onClose }: MonthCalendarSheetProps) {
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(selectedDate.slice(0, 7));
  const [progress, setProgress] = useState<Record<string, DayProgress>>({});

  const days = monthDays(`${month}-01`);
  const daysKey = days.join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const shown = daysKey.split(",").filter((d) => d <= today);
      if (shown.length === 0) return;
      const result = await macro.progress(await getToken().catch(() => null), shown);
      if (!cancelled && result.ok) setProgress(Object.fromEntries(result.data.days.map((d) => [d.date, d])));
    })();
    return () => {
      cancelled = true;
    };
  }, [daysKey, today, getToken]);

  const step = (months: number) => {
    const d = dateOf(`${month}-01`);
    d.setMonth(d.getMonth() + months);
    setMonth(isoOf(d).slice(0, 7));
  };
  const atCurrentMonth = month >= today.slice(0, 7);
  const leading = (dateOf(days[0]).getDay() + 6) % 7; // Monday first
  const cell = Math.floor((Math.min(width, 480) - 48) / 7);
  const ring = Math.min(36, cell - 8);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-4" onPress={() => {}} accessibilityViewIsModal>
          <View className="flex-row items-center justify-between">
            <Text className="type-headline text-forest-ink">Jump to a day</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text className="auth__link">Done</Text>
            </Pressable>
          </View>

          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => step(-1)} hitSlop={10} className="home__icon-button" accessibilityRole="button" accessibilityLabel="Previous month">
              <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={18} tintColor={colors.forestInk} />
            </Pressable>
            <Text className="setup__section">{dateOf(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</Text>
            <Pressable onPress={() => step(1)} disabled={atCurrentMonth} hitSlop={10} className="home__icon-button" style={{ opacity: atCurrentMonth ? 0.35 : 1 }} accessibilityRole="button" accessibilityLabel="Next month">
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={colors.forestInk} />
            </Pressable>
          </View>

          <View className="flex-row flex-wrap">
            {WEEKDAYS.map((d, i) => (
              <Text key={`${d}${i}`} className="macro__weekday text-center" style={{ width: cell }}>{d}</Text>
            ))}
            {Array.from({ length: leading }, (_, i) => <View key={`blank${i}`} style={{ width: cell, height: cell }} />)}
            {days.map((date) => {
              const future = date > today;
              const day = progress[date];
              const status = day?.status ?? "none";
              return (
                <Pressable
                  key={date}
                  disabled={future}
                  onPress={() => { onPick(date); onClose(); }}
                  style={{ width: cell, height: cell, opacity: future ? 0.3 : 1 }}
                  className="items-center justify-center"
                  accessibilityRole="button"
                  accessibilityState={{ selected: date === selectedDate }}
                  accessibilityLabel={date}
                >
                  <View className="items-center justify-center rounded-pill" style={{ width: ring + 6, height: ring + 6, backgroundColor: date === selectedDate ? colors.forestSoft : "transparent" }}>
                    <Ring size={ring} stroke={3} progress={status === "none" ? 0 : Math.max(0.08, day?.ratio ?? 0)} color={statusColor[status]} dashed={status === "none"}>
                      <Text className="macro__ring-day" style={{ color: date === today ? colors.leaf : colors.forestInk }}>{Number(date.slice(8))}</Text>
                    </Ring>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View className="flex-row flex-wrap justify-center gap-4">
            {[
              { label: "On target", color: colors.success },
              { label: "Part way", color: colors.warning },
              { label: "Nothing logged", color: colors.sand },
            ].map((item) => (
              <View key={item.label} className="flex-row items-center gap-1.5">
                <View className="h-2.5 w-2.5 rounded-pill" style={{ backgroundColor: item.color }} />
                <Text className="home__note">{item.label}</Text>
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
