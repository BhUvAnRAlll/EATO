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

// The three macros as columns: a tinted icon, the grams against the target, a thin bar in the
// macro's colour and the share as a chip
const MACROS: { key: "proteinG" | "carbsG" | "fatG"; label: string; icon: Icon; tint: string; color: string }[] = [
  { key: "proteinG", label: "Protein", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, tint: colors.tintGreen, color: colors.iconGreen },
  { key: "carbsG", label: "Carbs", icon: { ios: "carrot.fill", android: "nutrition", web: "nutrition" }, tint: colors.tintLavender, color: colors.iconLavender },
  { key: "fatG", label: "Fat", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" }, tint: colors.warningSoft, color: colors.warning },
];

// The day's intake on a white card: the calories eaten over "of <target> kcal" with how far the
// day stands as a soft pill, the share as a thin ring with the value inside and "of goal" under
// it (the Home rings' pattern), then the three macros side by side under a hairline.
// The whole card opens the daily view.
export function IntakeCard({ title, totals, targets, width, onPress }: IntakeCardProps) {
  const ratio = share(totals.kcal, targets.kcal);
  const over = targets.kcal > 0 && totals.kcal > targets.kcal;
  // On a 320pt phone the macro columns are tight: a smaller ring, the icon above the name
  const narrow = width < 350;
  const ring = narrow ? 72 : 84;
  return (
    <Pressable onPress={onPress} className="home__card" accessibilityRole="button" accessibilityLabel={`${title}: ${kcal(totals.kcal)} of ${kcal(targets.kcal)} kcal, ${percent(ratio)} of the daily goal. Open daily calories`}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="macro__icon-tile macro__icon-tile--heading" style={{ backgroundColor: colors.accentSoft }}>
          <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={18} tintColor={colors.primary} />
        </View>
        <Text className="home__card-title flex-1" numberOfLines={1}>{title}</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
      </View>

      <View className="mt-4 flex-row items-center" style={{ gap: 16 }}>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Text className="macro__intake-number" numberOfLines={1} adjustsFontSizeToFit>{kcal(totals.kcal)}</Text>
          <Text className="macro__intake-of" numberOfLines={1}>{`of ${kcal(targets.kcal)} kcal`}</Text>
          <View className={over ? "home__pill-soft mt-2 self-start" : "home__pill-soft home__pill-soft--grey mt-2 self-start"}>
            <SymbolView name={over ? { ios: "exclamationmark.circle.fill", android: "error", web: "error" } : { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={13} tintColor={over ? colors.primaryText : colors.muted} />
            <Text className={over ? "home__pill-soft-label" : "home__pill-soft-label home__pill-soft-label--grey"} numberOfLines={1}>
              {over ? `${kcal(totals.kcal - targets.kcal)} kcal over` : `${kcal(Math.max(0, targets.kcal - totals.kcal))} kcal left`}
            </Text>
          </View>
        </View>
        <View className="items-center" style={{ gap: 6 }}>
          <ProgressRing progress={ratio} size={ring} stroke={7} color={colors.primary}>
            {() => <Text className="home__ring-value" numberOfLines={1} adjustsFontSizeToFit>{percent(ratio)}</Text>}
          </ProgressRing>
          <Text className="home__ring-of">of goal</Text>
        </View>
      </View>

      <View className="macro__divider mt-4" />

      {/* The three macros side by side: icon and name, the grams, a thin bar, the share */}
      <View className="mt-3 flex-row" style={{ gap: narrow ? 8 : 12 }}>
        {MACROS.map((m) => {
          const done = totals[m.key];
          const target = targets[m.key];
          const r = share(done, target);
          return (
            <View key={m.key} className="min-w-0 flex-1" style={{ gap: 8 }} accessibilityLabel={`${m.label}: ${whole(done)} of ${target} g, ${percent(r)}`}>
              <View className={narrow ? "items-start" : "flex-row items-center"} style={{ gap: 6 }}>
                <View className="macro__icon-tile macro__icon-tile--small" style={{ backgroundColor: m.tint }}>
                  <SymbolView name={m.icon} size={14} tintColor={m.color} />
                </View>
                <Text className="home__ring-label" numberOfLines={1}>{m.label}</Text>
              </View>
              <Text className="macro__macro-value" numberOfLines={1} adjustsFontSizeToFit>
                {`${whole(done)} `}
                <Text className="macro__macro-target">{`/ ${target} g`}</Text>
              </Text>
              <View className="macro__track">
                <View className="h-full rounded-pill" style={{ width: `${Math.round(Math.min(1, r) * 100)}%`, backgroundColor: m.color }} />
              </View>
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
