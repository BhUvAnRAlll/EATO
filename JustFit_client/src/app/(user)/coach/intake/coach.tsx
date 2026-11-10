import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { coaches, coachStyles } from "@/data/coach";
import { coachApi, type IntakeTargets } from "@/lib/coach";
import { openTargets } from "@/lib/profileEdit";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useHomeStore } from "@/store/home";
import { intakeFromDraft, useCoachIntakeStore } from "@/store/coachIntake";
import { useThemeColors } from "@/theme";

// What the save says about the targets (they are worked out in code on the server)
const TARGETS_LINE: Record<Exclude<IntakeTargets, null>, string> = {
  set: "Saved. Your daily targets are set",
  kept: "Saved. Your own target stays",
  needs_choice: "Saved. Pick your estimate to finish",
  needs_professional: "Saved. Add your doctor's target to finish",
  needs_details: "Saved. Add your height and weight in Profile",
};

// Intake 10/10: who coaches you and how they talk to you (both can be changed later), the "not
// medical advice" tick, and the save (the old Notes step, 2026-11-10). Saving is the only write in
// the whole intake: the coach answers, the profile answers and the targets in one go; it closes
// the flow back to the Coach tab.
export default function IntakeCoach() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { draft, update } = useCoachIntakeStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstName = coaches.find((c) => c.id === draft.coach)?.name.replace("Coach ", "");

  const save = async () => {
    if (saving) return;
    const intake = intakeFromDraft(draft);
    // A step was skipped (e.g. the app reloaded mid-intake): start again from the first one
    if (!intake) return setError("Some answers are missing. Go back and finish the earlier steps.");
    setError(null);
    setSaving(true);
    const result = await coachApi.saveIntake(await getToken().catch(() => null), intake);
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not reach justFit. Check your connection and try again.");
    // Home reads the new targets next time it shows
    useHomeStore.setState({ loadedAt: null });
    const targets = result.data.targets;
    if (targets) hud.success(TARGETS_LINE[targets]);
    // The intake is the only place the goal and activity are set: when the targets still need the
    // member (an estimate to pick, a doctor's target), the targets screen opens here and returns
    // to the Coach tab
    if (targets === "needs_choice" || targets === "needs_professional") {
      const problem = await openTargets(await getToken().catch(() => null), "coach", { replace: true });
      if (!problem) return;
    }
    router.dismissTo("/coach");
  };

  return (
    <IntakeFrame
      step="coach"
      title="Who's coaching you?"
      subtitle="You can change this anytime."
      nextLabel={draft.editing ? "Save my answers" : "Meet my coach"}
      onNext={save}
      canContinue={draft.coach !== null && draft.coachStyle !== null && draft.acceptedDisclaimer}
      loading={saving}
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

      <Pressable
        onPress={() => update({ acceptedDisclaimer: !draft.acceptedDisclaimer })}
        className={draft.acceptedDisclaimer ? "coach__option coach__option--selected mt-2 items-start" : "coach__option mt-2 items-start"}
        accessibilityRole="checkbox"
        aria-checked={draft.acceptedDisclaimer}
        accessibilityLabel="Fitness guidance, not medical advice"
      >
        <View className={draft.acceptedDisclaimer ? "coach__tick coach__tick--on" : "coach__tick"}>
          {draft.acceptedDisclaimer && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} />}
        </View>
        <View className="flex-1">
          <Text className="coach__option-title">Fitness guidance, not medical advice.</Text>
          <Text className="coach__option-note mt-1">{"I'll check with a doctor before starting, especially with a health condition."}</Text>
        </View>
      </Pressable>

      {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
    </IntakeFrame>
  );
}
