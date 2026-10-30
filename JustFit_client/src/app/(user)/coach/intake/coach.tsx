import { Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { coaches, coachStyles } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 8/9: who coaches you and how they talk to you. Both can be changed later.
export default function IntakeCoach() {
  const { draft, update } = useCoachIntakeStore();
  const firstName = coaches.find((c) => c.id === draft.coach)?.name.replace("Coach ", "");

  return (
    <IntakeFrame
      step="coach"
      title="Who's coaching you?"
      subtitle="You can change this anytime."
      onNext={() => router.push("/coach/intake/notes")}
      canContinue={draft.coach !== null && draft.coachStyle !== null}
    >
      <View className="gap-3" accessibilityRole="radiogroup">
        {coaches.map((coach) => (
          <ChoiceCard
            key={coach.id}
            label={coach.name}
            note={coach.note}
            coach={coach.id}
            selected={draft.coach === coach.id}
            onPress={() => update({ coach: coach.id })}
          />
        ))}
      </View>

      <Text className="coach__section mt-2">{firstName ? `How should ${firstName} coach you?` : "Coaching style"}</Text>
      <View className="gap-3" accessibilityRole="radiogroup">
        {coachStyles.map((style) => (
          <ChoiceCard key={style.id} label={style.label} note={style.note} icon={style.icon} selected={draft.coachStyle === style.id} onPress={() => update({ coachStyle: style.id })} />
        ))}
      </View>
    </IntakeFrame>
  );
}
