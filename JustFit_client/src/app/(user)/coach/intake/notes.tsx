import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { CoachTextArea } from "@/components/coach/CoachTextArea";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { coachApi } from "@/lib/coach";
import { useSessionToken } from "@/lib/session";
import { intakeFromDraft, useCoachIntakeStore } from "@/store/coachIntake";
import { colors } from "@/theme";

const NOTES_MAX = 500;

// Intake 9/9: anything else for the plan, the "not medical advice" tick, and the save.
// Saving is the only write in the whole intake; it closes the flow back to the Coach tab.
export default function IntakeNotes() {
  const getToken = useSessionToken();
  const { draft, update } = useCoachIntakeStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intake = intakeFromDraft(draft);

  const save = async () => {
    if (saving) return;
    // A step was skipped (e.g. the app reloaded mid-intake): start again from the first one
    if (!intake) return setError("Some answers are missing. Go back and finish the earlier steps.");
    setError(null);
    setSaving(true);
    const result = await coachApi.saveIntake(await getToken().catch(() => null), intake);
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not reach justFit. Check your connection and try again.");
    router.dismissTo("/coach");
  };

  return (
    <IntakeFrame
      step="notes"
      title="Guide your plan"
      subtitle="Last step. Anything your coach should know?"
      nextLabel={draft.editing ? "Save my answers" : "Meet my coach"}
      onNext={save}
      canContinue={draft.acceptedDisclaimer}
      loading={saving}
    >
      <View className="coach__tip">
        <SymbolView name={{ ios: "lightbulb.fill", android: "lightbulb", web: "lightbulb" }} size={14} tintColor={colors.primary} />
        <Text className="coach__hint flex-shrink">Try: &quot;I walk 6k steps daily&quot; or &quot;No fish, please&quot;</Text>
      </View>

      <View className="coach__card">
        <Text className="coach__section">Plan notes (optional)</Text>
        <CoachTextArea
          value={draft.planNotes}
          onChangeText={(text) => update({ planNotes: text.slice(0, NOTES_MAX) })}
          placeholder="I prefer short workouts on weekdays…"
          accessibilityLabel="Plan notes"
          minHeight={132}
        />
        <Text className="coach__hint self-end">{`${draft.planNotes.length}/${NOTES_MAX}`}</Text>
      </View>

      <Pressable
        onPress={() => update({ acceptedDisclaimer: !draft.acceptedDisclaimer })}
        className={draft.acceptedDisclaimer ? "coach__option coach__option--selected items-start" : "coach__option items-start"}
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
