import { useState } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymSheet } from "@/components/gym/GymSheet";
import { DAYS, MAX_SESSIONS, TIME_SLOTS, copyToAll, dayText, nextSession, sessionsProblem, timeLabel, type Day, type OpeningHours, type Session } from "@/lib/gymProfile";
import { useThemeColors } from "@/theme";

// Which time is being picked: a day's session, its opening (0) or closing (1)
type Picking = { day: Day; index: number; end: 0 | 1 };

// Settings › Public profile › Opening hours: a day a row with its sessions (up to two, the usual
// morning and evening batches), each time a pill that opens the half-hour picker; Closed for a
// day off; "Same as Monday" copies Monday to the week. A day whose times don't work says why
// under it; the screen's Save waits until every day works (the server checks again).
export function OpeningHoursEditor({ hours, onChange }: { hours: OpeningHours; onChange: (hours: OpeningHours) => void }) {
  const colors = useThemeColors();
  const [picking, setPicking] = useState<Picking | null>(null);

  const setDay = (day: Day, sessions: Session[]) => onChange({ ...hours, [day]: sessions });
  const setTime = (time: string) => {
    if (!picking) return;
    const sessions = hours[picking.day].map((s, i) => (i === picking.index ? ((picking.end === 0 ? [time, s[1]] : [s[0], time]) as Session) : s));
    setDay(picking.day, sessions);
    setPicking(null);
  };
  const current = picking ? hours[picking.day][picking.index]?.[picking.end] : null;

  return (
    <View>
      {DAYS.map((day, d) => {
        const sessions = hours[day.id];
        const problem = sessionsProblem(sessions);
        return (
          <View key={day.id} className="gym-hours-row" style={{ borderTopWidth: d === 0 ? 0 : 1 }} accessible={false}>
            <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
              <Text className="gym-tx__name" accessibilityLabel={`${day.label}: ${dayText(sessions)}`}>{day.label}</Text>
              <PressableScale
                onPress={() => setDay(day.id, sessions.length === 0 ? [nextSession([])] : [])}
                className={sessions.length === 0 ? "gym-choice gym-choice--selected" : "gym-choice"}
                style={{ minHeight: 32 }}
                accessibilityRole="switch"
                accessibilityState={{ checked: sessions.length === 0 }}
                accessibilityLabel={`${day.label} closed`}
              >
                <Text className={sessions.length === 0 ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>Closed</Text>
              </PressableScale>
            </View>
            {sessions.length > 0 && (
              <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
                {sessions.map((session, index) => (
                  <View key={index} className="flex-row items-center" style={{ gap: 4 }}>
                    {([0, 1] as const).map((end) => (
                      <PressableScale
                        key={end}
                        onPress={() => setPicking({ day: day.id, index, end })}
                        className="gym-time-pill"
                        accessibilityRole="button"
                        accessibilityLabel={`${day.label}, ${index === 0 ? "first" : "second"} session ${end === 0 ? "opens" : "closes"} at ${timeLabel(session[end])}. Change`}
                      >
                        <Text className="gym-time-pill__label">{timeLabel(session[end])}</Text>
                      </PressableScale>
                    ))}
                    {sessions.length > 1 && (
                      <PressableScale onPress={() => setDay(day.id, sessions.filter((_, i) => i !== index))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${day.label}'s ${index === 0 ? "first" : "second"} session`}>
                        <GymIcon name="x" size={16} color={colors.gymMuted} />
                      </PressableScale>
                    )}
                  </View>
                ))}
                {sessions.length < MAX_SESSIONS && (
                  <PressableScale onPress={() => setDay(day.id, [...sessions, nextSession(sessions)])} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add a second session on ${day.label}`}>
                    <GymIcon name="plus" size={14} color={colors.gymPrimary} />
                    <Text className="gym-time-pill__label">Session</Text>
                  </PressableScale>
                )}
              </View>
            )}
            {problem ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{problem}</Text> : null}
            {day.id === "mon" && (
              <PressableScale onPress={() => onChange(copyToAll(hours, "mon"))} className="self-start" hitSlop={8} accessibilityRole="button" accessibilityLabel="Use Monday's hours for every day">
                <Text className="gym-time-pill__label">Same as Monday for every day</Text>
              </PressableScale>
            )}
          </View>
        );
      })}

      {picking && (
        <GymSheet title={picking.end === 0 ? "Opens at" : "Closes at"} subtitle={DAYS.find((d) => d.id === picking.day)?.label} onClose={() => setPicking(null)}>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {TIME_SLOTS.map((slot) => {
              const on = slot === current;
              return (
                <PressableScale key={slot} onPress={() => setTime(slot)} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} style={{ minWidth: 84, alignItems: "center" }} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={timeLabel(slot)}>
                  <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{timeLabel(slot)}</Text>
                </PressableScale>
              );
            })}
          </View>
        </GymSheet>
      )}
    </View>
  );
}
