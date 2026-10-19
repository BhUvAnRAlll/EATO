import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";

import { RecreateFrame } from "@/components/workout/RecreateFrame";
import { useRecreateDraft } from "@/components/workout/RecreateDraft";
import { BODY_TYPES, FITNESS_STATEMENTS, GENDERS, PACES, PERFORMANCE, RECREATE_GOALS, label } from "@/data/recreate";
import { MONDAY_FIRST } from "@/lib/recreateRules";
import { shortDay } from "@/lib/workoutApi";
import { colors } from "@/theme";

// Rebuild my plan: the answers on three cards, each with an Edit that jumps back to its step,
// then "Generate my plan". Nothing is saved until the plan is generated.

export default function RecreateReview() {
  const { draft } = useRecreateDraft();
  const or = (text: string) => (text.trim() === "" ? "—" : text);
  const range = (key: (typeof PERFORMANCE)[number]["key"]) => {
    const q = PERFORMANCE.find((p) => p.key === key);
    const score = draft[key];
    return q && score ? q.ranges[score - 1] : "—";
  };
  const cards: { title: string; step: Href; rows: [string, string][] }[] = [
    {
      title: "Profile",
      step: "/workout/recreate",
      rows: [
        ["Gender", label(GENDERS, draft.gender)],
        ["Age", draft.age.trim() ? `${draft.age} years` : "—"],
        ["Weight", draft.weight.trim() ? `${draft.weight} kg` : "—"],
        ["Height", draft.height.trim() ? `${draft.height} cm` : "—"],
        ["Body type", label(BODY_TYPES, draft.bodyType)],
      ],
    },
    {
      title: "Goal & Schedule",
      step: "/workout/recreate/goals",
      rows: [
        ["Goal", label(RECREATE_GOALS, draft.goal)],
        ["Days a week", draft.daysPerWeek ? String(draft.daysPerWeek) : "—"],
        ["Weekdays", or(MONDAY_FIRST.filter((d) => draft.weekdays.includes(d)).map(shortDay).join(", "))],
        ["Pace", label(PACES, draft.pace)],
      ],
    },
    {
      title: "Fitness",
      step: "/workout/recreate/performance",
      rows: [
        ["Fitness level", label(FITNESS_STATEMENTS, draft.fitnessBase)],
        ["Squats", range("squatScore")],
        ["Push-ups", range("pushScore")],
        ["Pull-ups", range("pullScore")],
        ["Serious injury", draft.seriousInjury === null ? "—" : draft.seriousInjury ? "Yes" : "No"],
      ],
    },
  ];

  return (
    <RecreateFrame
      step="review"
      title="Review your answers"
      subtitle="Check everything before we build your plan."
      primaryLabel="Generate my plan"
      onPrimary={() => router.push("/workout/recreate/analysing")}
    >
      {cards.map((card) => (
        <View key={card.title} className="home__card gap-1" style={{ paddingVertical: 12 }}>
          <View className="flex-row items-center justify-between pb-1">
            <Text className="setup__section">{card.title}</Text>
            <Pressable onPress={() => router.navigate(card.step)} hitSlop={8} className="flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel={`Edit ${card.title}`}>
              <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={13} tintColor={colors.leaf} />
              <Text className="home__link">Edit</Text>
            </Pressable>
          </View>
          {card.rows.map(([name, value]) => (
            <View key={name} className="flex-row items-center justify-between py-1.5">
              <Text className="post__time">{name}</Text>
              <Text className="card__title">{value}</Text>
            </View>
          ))}
        </View>
      ))}

      <View className="gap-1">
        <Text className="type-overline" style={{ color: colors.leaf }}>New plan</Text>
        <Text className="type-body text-forest-ink">Your updated information will be used to create your new workout plan.</Text>
        <Text className="home__note">Your current plan will remain unchanged until the new plan is successfully created. Your workout history stays with it.</Text>
      </View>
    </RecreateFrame>
  );
}
