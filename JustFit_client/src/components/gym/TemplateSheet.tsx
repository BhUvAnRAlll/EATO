import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type GymTemplates } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import {
  DEFAULT_TEMPLATES,
  NAME_MAX,
  PLACEHOLDER_LABEL,
  SAMPLE_VALUES,
  TEMPLATE_INFO,
  TEMPLATE_MAX,
  fillTemplate,
  placeholdersFor,
  templateNameProblem,
  templateProblem,
  type AddedTemplate,
  type Placeholder,
  type TemplateKind,
} from "@/lib/reminderTemplates";
import { useThemeColors } from "@/theme";

// What the sheet edits: one of the four reminders, or a template the gym admin added (null: a new one)
export type TemplateEditing = { kind: TemplateKind } | { added: AddedTemplate | null };

// The text a new template starts with
const NEW_TEXT = "Hi {name}, ";

// Reminder Templates › Edit / Add template (the gym admin only): a name for an added template, the
// message with its {placeholders}, chips that insert one where the cursor is, a preview with a
// sample member, Save, then Reset to default (a reminder with the branch's own wording) or Delete
// (an added template), each asked once more.
export function TemplateSheet({ editing, templates, onClose, onSaved }: { editing: TemplateEditing; templates: GymTemplates; onClose: () => void; onSaved: (data: GymTemplates) => void }) {
  const colors = useThemeColors();
  const kind = "kind" in editing ? editing.kind : null;
  const added = "added" in editing ? editing.added : null;
  const target = kind ?? "added";
  // A reminder's saved wording (null: the default)
  const saved = kind ? templates.templates[kind] : null;
  const startText = kind ? saved ?? DEFAULT_TEMPLATES[kind] : added?.text ?? NEW_TEXT;
  const [text, setText] = useState(startText);
  const [name, setName] = useState(added?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  // Where the cursor is, so a chip inserts its placeholder there (the end when the box was never touched)
  const cursor = useRef<number | null>(null);
  const { busy, error, save } = useGymSave((data: GymTemplates) => {
    onSaved(data);
    onClose();
  });

  const tidyName = name.replace(/\s+/g, " ").trim();
  const problem = (kind ? null : templateNameProblem(name)) ?? templateProblem(target, text);
  const changed = text.trim() !== startText.trim() || (!kind && tidyName !== (added?.name ?? ""));
  const title = kind ? TEMPLATE_INFO[kind].label : added ? "Edit template" : "Add template";
  const subtitle = kind ? TEMPLATE_INFO[kind].usedFor : "Listed on Use Template when you send a reminder";

  const insert = (key: Placeholder) => {
    haptic.select();
    const token = `{${key}}`;
    const at = Math.min(cursor.current ?? text.length, text.length);
    const next = `${text.slice(0, at)}${token}${text.slice(at)}`;
    if (next.length > TEMPLATE_MAX) return;
    setText(next);
    cursor.current = at + token.length;
  };

  const submit = () => {
    const body = { name: tidyName, text: text.trim() };
    if (kind) save((token) => gymApi.saveTemplate(token, kind, body.text));
    else if (added) save((token) => gymApi.editTemplate(token, added.id, body));
    else save((token) => gymApi.addTemplate(token, body));
  };

  return (
    <GymSheet
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      onDismissOverlay={() => setConfirming(false)}
      overlay={
        !confirming ? null : kind ? (
          <ConfirmDialog
            title="Use justFit's default text?"
            rows={[["Message", TEMPLATE_INFO[kind].label], ["Your wording", "Removed"]]}
            editLabel="Cancel"
            confirmLabel="Reset"
            onEdit={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              save((token) => gymApi.resetTemplate(token, kind));
            }}
          />
        ) : added ? (
          <ConfirmDialog
            title="Delete this template?"
            rows={[["Template", added.name]]}
            editLabel="Cancel"
            confirmLabel="Delete"
            onEdit={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              save((token) => gymApi.deleteTemplate(token, added.id));
            }}
          />
        ) : null
      }
    >
      {!kind && (
        <GymField
          label="Template name"
          icon="pencil-line"
          pinLabel
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="For example: Festive offer"
          autoCapitalize="sentences"
          accessibilityLabel="Template name"
          hint={name.length > 0 && templateNameProblem(name) ? templateNameProblem(name) ?? undefined : undefined}
        />
      )}

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
            placeholder="Write the message"
            placeholderTextColor={colors.gymMuted}
            style={{ minHeight: 120, fontFamily: "Poppins-Regular", fontSize: 15, lineHeight: 22, color: colors.gymInk, padding: 0 }}
            accessibilityLabel={`${kind ? TEMPLATE_INFO[kind].label : "Template"} message`}
          />
          <Text className="gym-remind__count">{`${text.length} / ${TEMPLATE_MAX}`}</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Insert a detail</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {placeholdersFor(target).map((key) => (
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

      {problem && text.trim().length > 0 && (kind || name.length > 0) ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{problem}</Text> : null}
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={kind || added ? "Save Template" : "Add Template"} icon="check" ready={!problem && changed} busy={busy} onPress={submit} />
      {(saved !== null || added) && (
        <PressableScale
          onPress={() => { haptic.select(); setConfirming(true); }}
          disabled={busy}
          className="flex-row items-center justify-center"
          style={{ gap: 6, minHeight: 44 }}
          accessibilityRole="button"
          accessibilityLabel={kind ? "Reset to justFit's default text" : `Delete ${added?.name ?? "template"}`}
        >
          <GymIcon name={kind ? "refresh-ccw" : "trash-2"} size={16} color={kind ? colors.gymPrimary : colors.gymDanger} />
          <Text className="gym-remind__template" style={kind ? undefined : { color: colors.gymDanger }}>{kind ? "Reset to default" : "Delete template"}</Text>
        </PressableScale>
      )}
    </GymSheet>
  );
}
