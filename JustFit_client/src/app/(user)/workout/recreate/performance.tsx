import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { Chip } from "@/components/setup/Chip";
import { RecreateField, RecreateFrame, tap } from "@/components/workout/RecreateFrame";
import { useRecreateDraft } from "@/components/workout/RecreateDraft";
import { PERFORMANCE } from "@/data/recreate";
import { performanceErrors, type Draft, type Errors, type Score } from "@/lib/recreateRules";
import { colors } from "@/theme";

// Rebuild my plan, step 3 of 3: what the member can do today, and whether anything needs
// training around. A "yes" puts the plan in safety mode in the engine (beginner movements,
// nothing high-risk) and asks for a professional's review.

export default function RecreatePerformance() {
  const { draft, update } = useRecreateDraft();
  const [errors, setErrors] = useState<Errors>({});
  const [tried, setTried] = useState(false);

  const set = (change: (d: Draft) => Draft) => {
    tap();
    const next = change(draft);
    update(() => next);
    if (tried) setErrors(performanceErrors(next));
  };
  const next = () => {
    const found = performanceErrors(draft);
    setTried(true);
    setErrors(found);
    if (Object.keys(found).length === 0) router.push("/workout/recreate/review");
  };

  return (
    <RecreateFrame
      step={3}
      title="Your current performance"
      subtitle="These answers help justFit choose the right training intensity for you."
      aside={{ title: "Be real.", text: "This helps us create a safer, better plan for you." }}
      footnote="You can always update this later in settings."
      primaryLabel="Continue"
      onPrimary={next}
    >
      {PERFORMANCE.map((q, index) => (
        <RecreateField key={q.key} index={index} label={q.label} error={errors[q.key]}>
          <View className="flex-row gap-2" accessibilityRole="radiogroup" accessibilityLabel={q.label}>
            {q.ranges.map((range, i) => (
              <Chip key={range} grow label={range} selected={draft[q.key] === i + 1} onPress={() => set((d) => ({ ...d, [q.key]: (i + 1) as Score }))} />
            ))}
          </View>
        </RecreateField>
      ))}

      <RecreateField index={3} label="Serious injury" error={errors.seriousInjury}>
        <Text className="post__time">Anything a doctor or physio has told you to train around?</Text>
        <View className="flex-row gap-2">
          <Chip grow label="No" selected={draft.seriousInjury === false} onPress={() => set((d) => ({ ...d, seriousInjury: false }))} />
          <Chip grow label="Yes" selected={draft.seriousInjury === true} onPress={() => set((d) => ({ ...d, seriousInjury: true }))} />
        </View>
        {draft.seriousInjury === true && (
          <View className="workout-safety" accessibilityRole="alert">
            <SymbolView name={{ ios: "exclamationmark.shield.fill", android: "health_and_safety", web: "health_and_safety" }} size={18} tintColor={colors.warning} />
            <Text className="workout-safety__text">
              For your safety, your new plan will use beginner-level exercises and exclude high-risk movements. Please review it with a qualified healthcare professional or trainer before exercising.
            </Text>
          </View>
        )}
      </RecreateField>
    </RecreateFrame>
  );
}
