import { Pressable, Text, View } from "react-native";

import { ProgressRing } from "@/components/ProgressRing";
import { SymbolView } from "@/components/SymbolView";
import { whole, type Totals } from "@/lib/macro";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

type IntakeCardProps = {
  title: string;
  totals: Totals;
  targets: Totals;
  // Inner width of the page (screen width minus the page padding)
  width: number;
  onPress: () => void;
};

const kcal = (n: number) => whole(n).toLocaleString("en-IN");
const share = (done: number, target: number) => (target > 0 ? done / target : 0);
const percent = (ratio: number) => `${Math.round(Math.min(ratio, 9.99) * 100)}%`;

// The three macros as tiles: a tinted icon, the grams against the target and the share as a pill
const MACROS: { key: "proteinG" | "carbsG" | "fatG"; label: string; icon: Icon; tint: string; color: string }[] = [
  { key: "proteinG", label: "Protein", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, tint: colors.tintGreen, color: colors.iconGreen },
  { key: "carbsG", label: "Carbs", icon: { ios: "carrot.fill", android: "nutrition", web: "nutrition" }, tint: colors.tintLavender, color: colors.iconLavender },
  { key: "fatG", label: "Fat", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" }, tint: colors.warningSoft, color: colors.warning },
];

// The day's intake on a white card: calories eaten against the target with the share as a ring
// and a pill, then the three macros as tiles on a soft panel. The whole card opens the daily view.
export function IntakeCard({ title, totals, targets, width, onPress }: IntakeCardProps) {
  const ratio = share(totals.kcal, targets.kcal);
  // Three tiles side by side on standard phones; on a 320pt phone the icon sits above the label
  const narrow = width < 350;
  const ring = width < 350 ? 84 : 96;
  return (
    <Pressable onPress={onPress} className="home__card" accessibilityRole="button" accessibilityLabel={`${title}: ${kcal(totals.kcal)} of ${kcal(targets.kcal)} kcal, ${percent(ratio)} of the daily goal. Open daily calories`}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="macro__icon-tile" style={{ backgroundColor: colors.accentSoft }}>
          <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={18} tintColor={colors.primary} />
        </View>
        <Text className="home__card-title flex-1" numberOfLines={1}>{title}</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
      </View>

      <View className="mt-3 flex-row items-center justify-between" style={{ gap: 12 }}>
        <View className="min-w-0 flex-1" style={{ gap: 10 }}>
          <View className="flex-row items-baseline" style={{ gap: 6 }}>
            <Text className="macro__intake-number" numberOfLines={1} adjustsFontSizeToFit>{kcal(totals.kcal)}</Text>
            <Text className="home__stat-unit" numberOfLines={1}>{`/ ${kcal(targets.kcal)} Kcal`}</Text>
          </View>
          <View className="home__pill-soft self-start">
            <SymbolView name={{ ios: "target", android: "track_changes", web: "track_changes" }} size={13} tintColor={colors.primaryText} />
            <Text className="home__pill-soft-label">{`${percent(ratio)} of daily goal`}</Text>
          </View>
        </View>
        <ProgressRing progress={ratio} size={ring} stroke={8} color={colors.primary}>
          {() => <Text className="home__ring-value" numberOfLines={1} adjustsFontSizeToFit>{percent(ratio)}</Text>}
        </ProgressRing>
      </View>

      <View className="macro__intake-panel mt-4">
        {MACROS.map((m, index) => {
          const done = totals[m.key];
          const target = targets[m.key];
          const r = share(done, target);
          return (
            <View key={m.key} className={index > 0 ? "macro__macro-col macro__macro-col--divided" : "macro__macro-col"} accessibilityLabel={`${m.label}: ${whole(done)} of ${target} g, ${percent(r)}`}>
              <View className={narrow ? "items-start" : "flex-row items-center"} style={{ gap: 8 }}>
                <View className="macro__icon-tile macro__icon-tile--small" style={{ backgroundColor: m.tint }}>
                  <SymbolView name={m.icon} size={14} tintColor={m.color} />
                </View>
                <Text className="home__ring-label" numberOfLines={1}>{m.label}</Text>
              </View>
              <Text className="macro__macro-value" numberOfLines={1}>{`${whole(done)}/${target} g`}</Text>
              <View className="macro__chip self-start" style={{ backgroundColor: m.tint }}>
                <Text className="macro__chip-label" style={{ color: m.color }}>{percent(r)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}
