import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { OptionCard } from "@/components/setup/OptionCard";
import { SetupField } from "@/components/setup/SetupField";
import { RecreateField, RecreateFrame, tap } from "@/components/workout/RecreateFrame";
import { useRecreateDraft } from "@/components/workout/RecreateDraft";
import { BODY_TYPES, GENDERS } from "@/data/recreate";
import { basicsErrors, type Errors } from "@/lib/recreateRules";
import { colors } from "@/theme";

// Rebuild my plan, step 1 of 3: gender, age, weight, height and body type

export default function RecreateBasics() {
  const { load, draft, update, retry } = useRecreateDraft();
  const [errors, setErrors] = useState<Errors>({});
  const [tried, setTried] = useState(false);
  const [learnMore, setLearnMore] = useState(false);
  const trainerManaged = load.state === "ready" && load.trainerManaged;

  // Errors show only after a failed Continue, then follow the answers as they change
  const set = (change: Parameters<typeof update>[0]) => {
    const next = change(draft);
    update(() => next);
    if (tried) setErrors(basicsErrors(next));
  };
  const next = () => {
    const found = basicsErrors(draft);
    setTried(true);
    setErrors(found);
    if (Object.keys(found).length === 0) router.push("/workout/recreate/goals");
  };

  return (
    <RecreateFrame
      step={1}
      title="Recreate your plan"
      subtitle="Update your fitness details and we'll create a new workout plan based on your current goals."
      notice={trainerManaged ? "Your trainer manages your current plan, so it cannot be recreated here." : "Your current plan won't be changed until your new plan is successfully created."}
      primaryLabel="Continue"
      onPrimary={next}
      primaryDisabled={load.state !== "ready" || trainerManaged}
    >
      {load.state === "loading" ? (
        <View className="items-center py-16">
          <ActivityIndicator color={colors.forest} />
        </View>
      ) : load.state === "failed" ? (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load your answers" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      ) : (
        <>
          <RecreateField index={0} label="Gender" error={errors.gender}>
            <View className="flex-row gap-2.5">
              {GENDERS.map((g) => (
                <OptionCard key={g.value} layout="tile" label={g.label} selected={draft.gender === g.value} onPress={() => { tap(); set((d) => ({ ...d, gender: g.value })); }} />
              ))}
            </View>
          </RecreateField>
          <RecreateField index={1} label="Age" error={errors.age}>
            <SetupField label="Age" icon={{ ios: "birthday.cake", android: "cake", web: "cake" }} unit="years" keyboardType="number-pad" maxLength={3} value={draft.age} onChangeText={(age) => set((d) => ({ ...d, age }))} placeholder="Your age" invalid={Boolean(errors.age)} accessibilityLabel="Age in years" />
          </RecreateField>
          <RecreateField index={2} label="Weight" error={errors.weight}>
            <SetupField label="Weight" icon={{ ios: "scalemass", android: "monitor_weight", web: "monitor_weight" }} unit="kg" keyboardType="decimal-pad" maxLength={5} value={draft.weight} onChangeText={(weight) => set((d) => ({ ...d, weight }))} placeholder="e.g. 70.5" invalid={Boolean(errors.weight)} accessibilityLabel="Weight in kg" />
          </RecreateField>
          <RecreateField index={3} label="Height" error={errors.height}>
            <SetupField label="Height" icon={{ ios: "ruler", android: "straighten", web: "straighten" }} unit="cm" keyboardType="number-pad" maxLength={3} value={draft.height} onChangeText={(height) => set((d) => ({ ...d, height }))} placeholder="e.g. 170" invalid={Boolean(errors.height)} accessibilityLabel="Height in cm" />
          </RecreateField>
          <RecreateField index={4} label="Body type" error={errors.bodyType}>
            <View className="flex-row gap-2.5">
              {BODY_TYPES.map((b) => (
                <OptionCard key={b.value} layout="tile" label={b.label} icon={b.icon} selected={draft.bodyType === b.value} onPress={() => { tap(); set((d) => ({ ...d, bodyType: b.value })); }} />
              ))}
            </View>
            <Text className="post__time">Only shapes the conditioning we pick. It never changes how hard you train.</Text>
            <Pressable onPress={() => setLearnMore((v) => !v)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Learn more about body type">
              <Text className="home__link">{learnMore ? "Show less" : "Learn more"}</Text>
            </Pressable>
            {learnMore && (
              <Text className="post__time">Sets, reps and intensity come from your goal and your performance answers, not from body type.</Text>
            )}
          </RecreateField>
        </>
      )}
    </RecreateFrame>
  );
}
