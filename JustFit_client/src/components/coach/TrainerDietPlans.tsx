import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { RecommendedMeals } from "@/components/meals/RecommendedMeals";
import { dietPlanApi, type MemberDietPlans } from "@/lib/dietPlanApi";
import { DIET_SLOT_LABEL, dietTime } from "@/lib/dietPlanText";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors } from "@/theme";

type TrainerDietPlansProps = {
  data: MemberDietPlans;
  onShared: (shared: boolean) => void;
};

const updatedText = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

// Coach › Meal Plan › From your trainer (2026-11-10): each diet plan a gym trainer shared, its meals
// for the day, and under breakfast, lunch and dinner the justFit meals the trainer recommends,
// ready to add to the cart. Picks that don't suit the member's own diet or allergies never show
// (the server leaves them out and says how many). The switch lets their trainers see their diet,
// allergies and dislikes, so the picks fit from the start.
export function TrainerDietPlans({ data, onShared }: TrainerDietPlansProps) {
  const getToken = useSessionToken();
  const switchColors = useSwitchColors();
  const [saving, setSaving] = useState(false);

  const share = async (next: boolean) => {
    haptic.select();
    setSaving(true);
    const answer = await dietPlanApi.share(await getToken().catch(() => null), next);
    setSaving(false);
    if (!answer.ok) return hud.error(answer.error);
    onShared(answer.data.shared);
  };

  return (
    <View style={{ gap: 16 }}>
      {data.plans.map((plan) => {
        const who = plan.trainer ?? "Your trainer";
        return (
          <View key={plan.id} style={{ gap: 12 }}>
            <View className="coach__card" style={{ gap: 4 }}>
              <Text className="coach__section">{`Diet plan from ${who}`}</Text>
              <Text className="coach__hint">{`${plan.gym} ${plan.branch} · updated ${updatedText(plan.updatedAt)}`}</Text>
              {plan.note ? <Text className="coach__option-note">{`“${plan.note}”`}</Text> : null}
            </View>
            {plan.meals.map((meal, i) => (
              <View key={`${plan.id}-${i}`} style={{ gap: 8 }}>
                <View className="home__card" style={{ gap: 4 }}>
                  <Text className="coach__hint">{[dietTime(meal.time), DIET_SLOT_LABEL[meal.slot]].filter(Boolean).join(" · ")}</Text>
                  <Text className="card__title">{meal.food}</Text>
                  {meal.kcal !== null || meal.proteinG !== null ? (
                    <Text className="meta-text">{[meal.kcal !== null ? `${meal.kcal} kcal` : null, meal.proteinG !== null ? `${meal.proteinG} g protein` : null].filter(Boolean).join(" · ")}</Text>
                  ) : null}
                </View>
                {meal.picks.length > 0 && <RecommendedMeals items={meal.picks.map((m) => ({ meal: m, note: `Recommended by ${who}` }))} />}
              </View>
            ))}
            {plan.hidden > 0 && (
              <Text className="coach__hint">{`${plan.hidden} ${plan.hidden === 1 ? "pick is" : "picks are"} hidden because ${plan.hidden === 1 ? "it doesn't" : "they don't"} suit your diet or allergies.`}</Text>
            )}
          </View>
        );
      })}
      <View className="home__card flex-row items-center" style={{ gap: 12 }}>
        <View className="min-w-0 flex-1">
          <Text className="card__title">Share my food answers</Text>
          <Text className="meta-text">Let my gym trainers see my diet, allergies and dislikes, so their picks suit me</Text>
        </View>
        <Switch {...switchColors} value={data.shared} disabled={saving} onValueChange={share} accessibilityLabel="Share my food answers with my trainers" />
      </View>
    </View>
  );
}
