import { Text, View } from "react-native";

import { ActivityCard } from "@/components/ActivityCard";
import { ProgressStat } from "@/components/ProgressStat";
import { SectionHeader } from "@/components/home/SectionHeader";
import type { NutritionToday } from "@/data/home";
import { colors } from "@/theme";

type NutritionProgressCardProps = {
  heading: string;
  actionLabel: string;
  nutrition: NutritionToday;
  // Inner width of the page (screen width minus the page padding)
  width: number;
  onEditGoal: () => void;
  // Opens the Macro tab (today's meals and logging)
  onOpen: () => void;
};

const macros = [
  { key: "proteinG", label: "Protein", color: colors.protein },
  { key: "carbsG", label: "Carbs", color: colors.carbs },
  { key: "fatG", label: "Fats", color: colors.fat },
] as const;

const kcal = (n: number) => n.toLocaleString("en-IN");
const share = (eaten: number, target: number) => (target > 0 ? eaten / target : 0);

// "Today's Macros" (the admins' heading) as the Peak Fitness ActivityCard: today's calories and
// a ring, then one progress row per amount. The card opens the Macro tab; "Edit Goal" stays a
// separate link (no button inside a button).
export function NutritionProgressCard({ heading, actionLabel, nutrition, width, onEditGoal, onOpen }: NutritionProgressCardProps) {
  const { consumed, targets } = nutrition;
  const calories = share(consumed.calories, targets.calories);

  return (
    <View>
      <SectionHeader title={heading} actionLabel={actionLabel} onAction={onEditGoal} />
      <View className="mt-3">
        <ActivityCard
          title="Today's calories"
          metric={kcal(consumed.calories)}
          meta={`/ ${kcal(targets.calories)} Kcal`}
          progress={calories}
          compact={width < 330}
          onPress={onOpen}
          accessibilityLabel={`${heading}: ${consumed.calories} of ${targets.calories} kcal eaten. Open Macro`}
        >
          <ProgressStat label="Calories" value={kcal(consumed.calories)} unit="Kcal" progress={calories} />
          {macros.map((macro) => (
            <ProgressStat
              key={macro.key}
              label={macro.label}
              value={`${consumed[macro.key]}/${targets[macro.key]}`}
              unit="g"
              progress={share(consumed[macro.key], targets[macro.key])}
              color={macro.color}
            />
          ))}
          <Text className="home__note mt-1">
            {nutrition.source === "sample"
              ? "Sample numbers: your targets couldn't be loaded."
              : consumed.calories > 0
                ? `${kcal(consumed.calories)} kcal logged today. Tap to see your meals.`
                : "Nothing logged yet today. Tap to log a meal."}
          </Text>
        </ActivityCard>
      </View>
    </View>
  );
}
