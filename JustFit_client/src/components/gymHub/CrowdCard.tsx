import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SkeletonCard } from "@/components/Skeleton";
import { crowdApi } from "@/lib/gymCrowd";
import { timeText } from "@/lib/gymHubText";
import { useSessionToken } from "@/lib/session";
import { LEVEL_LABEL, WEEKDAY_LABEL, barShare, basedOnText, forecastLines, hourText, liveText, type CrowdForecast, type CrowdLevel, type LiveCrowd, type MemberCrowd } from "@/lib/gymCrowdRules";
import { useThemeColors } from "@/theme";

type Colors = ReturnType<typeof useThemeColors>;
const levelColors = (colors: Colors): Record<CrowdLevel, { fill: string; soft: string }> => ({
  low: { fill: colors.success, soft: colors.successSoft },
  moderate: { fill: colors.warning, soft: colors.warningSoft },
  busy: { fill: colors.iconPeach, soft: colors.tintPeach },
  very_busy: { fill: colors.danger, soft: colors.dangerSoft },
});

// The live estimate: how many are inside now, against the gym's capacity, with when it was worked
// out. Always labelled LIVE so it's never read as a forecast.
export function LiveCrowdCard({ live }: { live: LiveCrowd }) {
  const colors = useThemeColors();
  const text = liveText(live);
  const level = live.level ? levelColors(colors)[live.level] : null;
  return (
    <View className="card" style={{ gap: 10 }} accessible accessibilityLabel={`Live: ${text.title}. ${text.line}`}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="rounded-pill px-2 py-0.5" style={{ backgroundColor: colors.dangerSoft }}>
          <Text className="type-caption" style={{ color: colors.danger }}>● LIVE</Text>
        </View>
        <Text className="type-caption text-muted flex-1">{`Estimate · updated ${timeText(live.updatedAt)}`}</Text>
        {level && live.level ? (
          <View className="rounded-pill px-2 py-0.5" style={{ backgroundColor: level.soft }}>
            <Text className="type-caption" style={{ color: level.fill }}>{LEVEL_LABEL[live.level]}</Text>
          </View>
        ) : null}
      </View>
      <Text className="type-title text-ink">{text.title}</Text>
      <Text className="type-body text-muted">{text.line}</Text>
      {live.available && live.percent !== null && level ? (
        <View className="h-2 overflow-hidden rounded-pill bg-cream-tab">
          <View className="h-2 rounded-pill" style={{ width: `${Math.max(2, live.percent)}%`, backgroundColor: level.fill }} />
        </View>
      ) : null}
      {live.leftWithoutCheckout > 0 ? (
        <Text className="type-caption text-muted">{`${live.leftWithoutCheckout} check-in${live.leftWithoutCheckout === 1 ? "" : "s"} from earlier without a check-out ${live.leftWithoutCheckout === 1 ? "isn't" : "aren't"} counted.`}</Text>
      ) : null}
    </View>
  );
}

// The forecast: the usual crowd by hour, labelled USUAL, from past weeks; quietest and busiest
// times, today's hours as bars and the week as a heatmap. Without enough history it says so.
export function CrowdForecastCard({ forecast }: { forecast: CrowdForecast }) {
  const colors = useThemeColors();
  const palette = levelColors(colors);
  const [view, setView] = useState<"today" | "week">("today");
  if (!forecast.enough || !forecast.today) {
    return (
      <View className="card" style={{ gap: 6 }}>
        <Text className="type-caption text-muted">USUAL CROWD · FORECAST</Text>
        <Text className="card__title">Not enough visits yet</Text>
        <Text className="type-body text-muted">Best times appear after two weeks of check-ins on the same day of the week.</Text>
      </View>
    );
  }
  const lines = forecastLines(forecast);
  const today = forecast.today;
  const peak = Math.max(0, ...today.hours.map((h) => h.expected));
  return (
    <View className="card" style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text className="type-caption text-muted">USUAL CROWD · FORECAST</Text>
        <Text className="type-caption text-muted">{`${basedOnText(forecast.basedOnDays)}${forecast.relativeLevels ? " · levels compare the gym's own busy hours" : ""}`}</Text>
      </View>
      {lines.map((l) => (
        <View key={l.label} className="flex-row" style={{ gap: 12 }}>
          <Text className="type-caption text-muted" style={{ width: 120 }}>{l.label}</Text>
          <Text className="type-body flex-1">{l.value}</Text>
        </View>
      ))}

      <View className="flex-row" style={{ gap: 8 }}>
        {(["today", "week"] as const).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} className={view === v ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="button" accessibilityState={{ selected: view === v }}>
            <Text className={view === v ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{v === "today" ? "Today by hour" : "This week"}</Text>
          </Pressable>
        ))}
      </View>

      {view === "today" ? (
        !today.enough || today.closed ? (
          <Text className="type-body text-muted">{today.closed ? "The gym is closed today." : "Not enough visits on this day of the week yet."}</Text>
        ) : (
          <View className="flex-row items-end" style={{ gap: 3, height: 120 }} accessibilityLabel="Usual crowd today by hour">
            {today.hours.map((h) => (
              <View key={h.hour} className="flex-1 items-center" style={{ gap: 4 }} accessible accessibilityLabel={`${hourText(h.hour)}: about ${Math.round(h.expected)}`}>
                <View className="w-full justify-end" style={{ height: 96 }}>
                  <View className="w-full rounded-sm" style={{ height: Math.max(3, barShare(h.expected, peak) * 96), backgroundColor: palette[h.level].fill }} />
                </View>
                <Text className="text-faint" style={{ fontSize: 9 }} numberOfLines={1}>{h.hour % 3 === 0 ? hourText(h.hour).replace(" ", "") : ""}</Text>
              </View>
            ))}
          </View>
        )
      ) : (
        <View style={{ gap: 4 }} accessibilityLabel="Usual crowd this week">
          {forecast.week.map((d) => (
            <View key={d.weekday} className="flex-row items-center" style={{ gap: 6 }}>
              <Text className="type-caption text-muted" style={{ width: 30 }}>{WEEKDAY_LABEL[d.weekday]}</Text>
              {d.enough && d.hours.length ? (
                <View className="flex-1 flex-row" style={{ gap: 2 }}>
                  {d.hours.map((h) => <View key={h.hour} className="flex-1 rounded-sm" style={{ height: 16, backgroundColor: h.expected > 0 ? palette[h.level].fill : colors.creamDeep, opacity: h.expected > 0 ? 0.85 : 1 }} />)}
                </View>
              ) : (
                <Text className="type-caption text-faint flex-1">{d.enough ? "Closed" : "Not enough visits yet"}</Text>
              )}
            </View>
          ))}
          <View className="mt-1 flex-row flex-wrap" style={{ gap: 10 }}>
            {(Object.keys(LEVEL_LABEL) as CrowdLevel[]).map((l) => (
              <View key={l} className="flex-row items-center" style={{ gap: 4 }}>
                <View className="rounded-sm" style={{ width: 10, height: 10, backgroundColor: palette[l].fill }} />
                <Text className="type-caption text-muted">{LEVEL_LABEL[l]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// Gym Hub › a membership › Crowd: the live estimate and the usual crowd at this member's own gym,
// read when the page opens and again on a pull (refreshKey)
export function MemberCrowdSection({ membershipId, refreshKey }: { membershipId: number; refreshKey: number }) {
  const getToken = useSessionToken();
  const [state, setState] = useState<{ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: MemberCrowd }>({ state: "loading" });
  useEffect(() => {
    let live = true;
    (async () => {
      const answer = await crowdApi.member(await getToken().catch(() => null), membershipId);
      if (!live) return;
      setState(answer.ok ? { state: "ready", data: answer.data } : { state: "failed", error: answer.error });
    })();
    return () => {
      live = false;
    };
  }, [membershipId, refreshKey, getToken]);

  return (
    <View style={{ gap: 10 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Crowd</Text>
      {state.state === "loading" ? <SkeletonCard /> : null}
      {state.state === "failed" ? (
        <View className="card"><Text className="type-body text-muted">{`The crowd couldn't be loaded. ${state.error}`}</Text></View>
      ) : null}
      {state.state === "ready" ? (
        <>
          <LiveCrowdCard live={state.data.live} />
          <CrowdForecastCard forecast={state.data.forecast} />
        </>
      ) : null}
    </View>
  );
}
