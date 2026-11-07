import { Text, View } from "react-native";

import { GymIcon } from "@/components/gym/GymIcon";
import { GymError } from "@/components/gym/GymStates";
import { shortDate } from "@/data/gymDashboard";
import type { BusyHours } from "@/lib/gymApi";
import type { GymLoad } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOf = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// "5am", "12pm", "6pm" under the bars; "6–7 pm" / "11 am–12 pm" for the busiest and quietest hours
const meridiem = (h: number) => (h % 24 < 12 ? "am" : "pm");
const twelve = (h: number) => ((h % 12) === 0 ? 12 : h % 12);
export const hourTick = (h: number) => `${twelve(h)}${meridiem(h)}`;
export const hourRange = (h: number) => (meridiem(h) === meridiem(h + 1) ? `${twelve(h)}–${twelve(h + 1)} ${meridiem(h)}` : `${twelve(h)} ${meridiem(h)}–${twelve(h + 1)} ${meridiem(h + 1)}`);

// Attendance › Tomorrow's busy hours: the server's forecast (GET /api/gym/predictions/busy-hours),
// the average of the same weekday over the last four weeks, hour by hour. Until the branch has two
// such weeks of check-ins the card says so instead of guessing.
export function BusyHoursCard({ result, onRetry }: { result: GymLoad<BusyHours>; onRetry: () => void }) {
  const colors = useThemeColors();
  if (result.state === "loading") {
    return (
      <View className="gym-dash-card" style={{ padding: 14 }}>
        <Text className="gym-tx__meta">{"Working out tomorrow's hours…"}</Text>
      </View>
    );
  }
  if (result.state === "failed") return <GymError error={result.error} onRetry={onRetry} />;
  const d = result.data;
  const weekday = weekdayOf(d.forDate);

  if (!d.enough) {
    return (
      <View className="gym-dash-card flex-row items-center" style={{ padding: 14, gap: 12 }} accessible accessibilityLabel="Not enough attendance data to forecast tomorrow yet">
        <View className="gym-dash-row__icon" style={{ backgroundColor: colors.gymPrimarySoft }}>
          <GymIcon name="clock" size={18} color={colors.gymPrimary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="gym-tx__name">Not enough attendance data yet</Text>
          <Text className="gym-tx__meta">{`A forecast for ${weekday} needs at least two weeks of check-ins. ${d.weeksUsed === 0 ? "None recorded on recent " + weekday + "s so far." : "One week recorded so far."}`}</Text>
        </View>
      </View>
    );
  }

  const peak = Math.max(1, ...d.hours.map((h) => h.expected));
  const summary = `${weekday} ${shortDate(d.forDate)}: about ${d.total} ${d.total === 1 ? "check-in" : "check-ins"} expected`;
  // The hour ticks under the bars: one label per three bars (a bar is too narrow for its own)
  const ticks = d.hours.filter((_, i) => i % 3 === 0).map((h, i, list) => ({ hour: h.hour, span: i === list.length - 1 ? d.hours.length - i * 3 : 3 }));
  return (
    <View className="gym-dash-card" style={{ padding: 14, gap: 12 }}>
      <View>
        <Text className="gym-tx__name">{`About ${d.total} ${d.total === 1 ? "check-in" : "check-ins"} expected`}</Text>
        <Text className="gym-tx__meta">{`${weekday}, ${shortDate(d.forDate)}`}</Text>
      </View>
      {d.busiest && d.quietest ? (
        <View className="flex-row">
          {[
            ["Busiest", hourRange(d.busiest.hour), `${d.busiest.expected} expected`],
            ["Quietest", hourRange(d.quietest.hour), `${d.quietest.expected} expected`],
          ].map(([label, value, note]) => (
            <View key={label} className="gym-stat" accessible accessibilityLabel={`${label}: ${value}, ${note}`}>
              <Text className="gym-tx__name">{value}</Text>
              <Text className="gym-stat__label text-center" numberOfLines={2}>{`${label} · ${note}`}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="gym-tx__meta">{`No check-ins on recent ${weekday}s.`}</Text>
      )}
      <View accessible accessibilityLabel={`${summary}. By hour from ${hourTick(d.hours[0].hour)}: ${d.hours.map((h) => h.expected).join(", ")}`}>
        <View className="gym-bars" style={{ height: 80 }}>
          {d.hours.map((h) => (
            <View key={h.hour} className="gym-bars__col" style={{ gap: 2 }}>
              <Text className="gym-stat__label" style={{ fontSize: 9, lineHeight: 11 }}>{h.expected > 0 ? String(h.expected) : " "}</Text>
              <View className="gym-bars__bar" style={{ height: `${Math.max(4, (h.expected / peak) * 70)}%`, opacity: d.busiest && h.hour === d.busiest.hour ? 1 : 0.45 }} />
            </View>
          ))}
        </View>
        <View className="flex-row" style={{ gap: 6, marginTop: 4 }}>
          {ticks.map((t) => (
            <Text key={t.hour} className="gym-stat__label" style={{ flex: t.span, fontSize: 10, lineHeight: 12 }} numberOfLines={1}>{hourTick(t.hour)}</Text>
          ))}
        </View>
      </View>
      <Text className="gym-tx__meta">{`Average of the last ${d.weeksUsed} ${weekday}s${d.lastWeek ? ` · last ${weekday}: ${d.lastWeek.total}` : ""}. Worked out just now.`}</Text>
    </View>
  );
}
