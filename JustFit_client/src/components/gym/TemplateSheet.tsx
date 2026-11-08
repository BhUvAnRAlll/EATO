import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type GymTemplates } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import {
  DEFAULT_TEMPLATES,
  PLACEHOLDER_LABEL,
  PLACEHOLDERS,
  SAMPLE_VALUES,
  TEMPLATE_INFO,
  TEMPLATE_MAX,
  fillTemplate,
  templateProblem,
  type Placeholder,
  type TemplateKind,
} from "@/lib/reminderTemplates";
import { useThemeColors } from "@/theme";

// Reminder Templates › Edit (the gym admin only): the message with its {placeholders}, chips that
// insert one where the cursor is, a preview with a sample member, Save, and Reset to default
// (asked once more) when the branch has its own wording.
export function TemplateSheet({ kind, saved, onClose, onSaved }: { kind: TemplateKind; saved: string | null; onClose: () => void; onSaved: (data: GymTemplates) => void }) {
  const colors = useThemeColors();
  const [text, setText] = useState(saved ?? DEFAULT_TEMPLATES[kind]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Where the cursor is, so a chip inserts its placeholder there (the end when the box was never touched)
  const cursor = useRef<number | null>(null);
  const { busy, error, save } = useGymSave((data: GymTemplates) => {
    onSaved(data);
    onClose();
  });

  const problem = templateProblem(kind, text);
  const changed = text.trim() !== (saved ?? DEFAULT_TEMPLATES[kind]);

  const insert = (key: Placeholder) => {
    haptic.select();
    const token = `{${key}}`;
    const at = Math.min(cursor.current ?? text.length, text.length);
    const next = `${text.slice(0, at)}${token}${text.slice(at)}`;
    if (next.length > TEMPLATE_MAX) return;
    setText(next);
    cursor.current = at + token.length;
  };

  return (
    <GymSheet
      title={TEMPLATE_INFO[kind].label}
      subtitle={TEMPLATE_INFO[kind].usedFor}
      onClose={onClose}
      onDismissOverlay={() => setConfirmingReset(false)}
      overlay={
        confirmingReset ? (
          <ConfirmDialog
            title="Use justFit's default text?"
            rows={[["Message", TEMPLATE_INFO[kind].label], ["Your wording", "Removed"]]}
            editLabel="Cancel"
            confirmLabel="Reset"
            onEdit={() => setConfirmingReset(false)}
            onConfirm={() => {
              setConfirmingReset(false);
              save((token) => gymApi.resetTemplate(token, kind));
            }}
          />
        ) : null
      }
    >
      <View style={{ gap: 10 }}>
        <Text className="gym-remind__heading">Message</Text>
        <View className="gym-remind__box">
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.slice(0, TEMPLATE_MAX))}
            onSelectionChange={(e) => { cursor.current = e.nativeEvent.selection.start; }}
            multiline
            maxLength={TEMPLATE_MAX}
            textAlignVertical="top"
            style={{ minHeight: 120, fontFamily: "Poppins-Regular", fontSize: 15, lineHeight: 22, color: colors.gymInk, padding: 0 }}
            accessibilityLabel={`${TEMPLATE_INFO[kind].label} message`}
          />
          <Text className="gym-remind__count">{`${text.length} / ${TEMPLATE_MAX}`}</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Insert a detail</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {PLACEHOLDERS[kind].map((key) => (
            <PressableScale key={key} onPress={() => insert(key)} className="gym-kind flex-row items-center" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel={`Insert ${PLACEHOLDER_LABEL[key]}`}>
              <GymIcon name="plus" size={14} color={colors.gymPrimary} />
              <Text className="gym-kind__label">{PLACEHOLDER_LABEL[key]}</Text>
            </PressableScale>
          ))}
        </View>
        <Text className="gym-tx__meta">{"Each detail is filled in for the member you send it to."}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Preview</Text>
        <View className="gym-template__preview" accessible accessibilityLabel={`Preview: ${fillTemplate(text, SAMPLE_VALUES)}`}>
          <Text className="gym-template__preview-text">{fillTemplate(text, SAMPLE_VALUES) || " "}</Text>
        </View>
      </View>

      {problem && text.trim().length > 0 ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{problem}</Text> : null}
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save Template" icon="check" ready={!problem && changed} busy={busy} onPress={() => save((token) => gymApi.saveTemplate(token, kind, text.trim()))} />
      {saved !== null && (
        <PressableScale onPress={() => { haptic.select(); setConfirmingReset(true); }} disabled={busy} className="flex-row items-center justify-center" style={{ gap: 6, minHeight: 44 }} accessibilityRole="button" accessibilityLabel="Reset to justFit's default text">
          <GymIcon name="refresh-ccw" size={16} color={colors.gymPrimary} />
          <Text className="gym-remind__template">Reset to default</Text>
        </PressableScale>
      )}
    </GymSheet>
  );
}
