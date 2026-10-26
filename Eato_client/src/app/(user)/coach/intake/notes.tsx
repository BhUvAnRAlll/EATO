import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

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
    if (!result.ok) return setError(result.status ? result.error : "Could not reach JustFit. Check your connection and try again.");
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
      <View className="flex-row items-center gap-2 self-start rounded-pill bg-surface px-3 py-2">
        <SymbolView name={{ ios: "lightbulb", android: "lightbulb", web: "lightbulb" }} size={14} tintColor={colors.leaf} />
        <Text className="post__time">Try: &quot;I walk 6k steps daily&quot; or &quot;No fish, please&quot;</Text>
      </View>

      <View className="coach__card">
        <Text className="setup__section">Plan notes (optional)</Text>
        <TextInput
          value={draft.planNotes}
          onChangeText={(text) => update({ planNotes: text.slice(0, NOTES_MAX) })}
          placeholder="I prefer short workouts on weekdays…"
          placeholderTextColor={colors.faint}
          multiline
          accessibilityLabel="Plan notes"
          style={{ minHeight: 120, padding: 12, borderRadius: 16, backgroundColor: colors.surfaceAlt, color: colors.forestInk, fontSize: 15, textAlignVertical: "top" }}
        />
        <Text className="post__time self-end">{`${draft.planNotes.length}/${NOTES_MAX}`}</Text>
      </View>

      <Pressable
        onPress={() => update({ acceptedDisclaimer: !draft.acceptedDisclaimer })}
        className="coach__card flex-row items-start"
        accessibilityRole="checkbox"
        aria-checked={draft.acceptedDisclaimer}
        accessibilityLabel="Fitness guidance, not medical advice"
      >
        <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-sm" style={{ borderWidth: draft.acceptedDisclaimer ? 0 : 1.5, borderColor: colors.sand, backgroundColor: draft.acceptedDisclaimer ? colors.forest : colors.surface }}>
          {draft.acceptedDisclaimer && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} />}
        </View>
        <View className="flex-1">
          <Text className="setup__note-title">Fitness guidance, not medical advice.</Text>
          <Text className="setup__note-text mt-1">{"I'll check with a doctor before starting, especially with a health condition."}</Text>
        </View>
      </Pressable>

      {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
    </IntakeFrame>
  );
}
