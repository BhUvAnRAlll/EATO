import { useState } from "react";
import { RefreshControl, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { TemplateSheet, type TemplateEditing } from "@/components/gym/TemplateSheet";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { ADDED_MAX, SAMPLE_VALUES, TEMPLATE_INFO, TEMPLATE_KINDS, fillTemplate, templateText, type TemplateKind } from "@/lib/reminderTemplates";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

const ICON: Record<TemplateKind, GymIconName> = { due: "credit-card", expiry: "calendar-clock", expired: "calendar-x", enquiry: "user-plus" };

// ☰ › Reminder Templates (2026-11-08): this branch's wording for the messages Send Reminder and
// the enquiry cards' WhatsApp write, each shown with a sample member filled in, tagged Custom or
// Default. The gym admin edits one in TemplateSheet; Staff read them only. Under them, Your
// templates: messages the gym admin added (the round +, up to 20 a branch), listed in Send
// Reminder's Use Template. They go out from the
// phone's own WhatsApp or Messages app: justFit's own SMS keep their DLT-registered text.
export default function GymTemplates() {
  const colors = useThemeColors();
  const can = useCan();
  const { result, retry, update, refreshing, refresh } = useGymData(gymApi.templates);
  const [editing, setEditing] = useState<TemplateEditing | null>(null);
  const data = result.state === "ready" ? result.data : null;
  const full = (data?.added.length ?? 0) >= ADDED_MAX;
  const fab = data?.canAdd && !full ? (
    <PressableScale onPress={() => setEditing({ added: null })} haptic="tap" className="gym-fab" accessibilityRole="button" accessibilityLabel="Add template">
      <GradientFill radius={18} />
      <GymIcon name="plus" size={22} color={colors.white} />
    </PressableScale>
  ) : undefined;

  // Role & Permission › Reminder Templates. The wording itself stays readable to every login, since
  // Send Reminder and the enquiry cards use it; this only decides who sees the screen.
  if (!can("templates.view")) {
    return (
      <GymScreen title="Reminder Templates">
        <GymEmpty icon="layout-grid" title="No access to Reminder Templates" text="Your login doesn't include Reminder Templates. Ask your gym admin." />
      </GymScreen>
    );
  }

  return (
    <GymScreen title="Reminder Templates" floating={fab} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
      <View className="gym-template__note">
        <GymIcon name="info" size={18} color={colors.gymPrimary} />
        <Text className="gym-template__note-text">
          {"Used when you send a reminder by WhatsApp or your phone's SMS app. SMS sent through justFit use the registered text."}
        </Text>
      </View>

      {result.state === "loading" && <GymLoading label="Loading the templates" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          {!result.data.canEdit && <Text className="gym-tx__meta">Only the gym admin can change these.</Text>}
          {TEMPLATE_KINDS.map((kind) => {
            const custom = result.data.templates[kind] !== null;
            const preview = fillTemplate(templateText(kind, result.data.templates), SAMPLE_VALUES);
            return (
              <View key={kind} className="gym-dash-card gym-template">
                <View className="flex-row items-start" style={{ gap: 12 }}>
                  <View className="gym-template__icon">
                    <GymIcon name={ICON[kind]} size={20} color={colors.gymPrimary} />
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="gym-template__title" numberOfLines={2}>{TEMPLATE_INFO[kind].label}</Text>
                    <Text className="gym-tx__meta" numberOfLines={2}>{TEMPLATE_INFO[kind].usedFor}</Text>
                    {/* The tag under the description, so the title has the card's width (2026-11-08) */}
                    <View className="gym-tag self-start" style={{ marginTop: 4, backgroundColor: custom ? colors.gymPrimarySoft : colors.gymSuccessSoft }}>
                      <Text className="gym-tag__label" style={{ color: custom ? colors.gymPrimary : colors.gymSuccess }}>{custom ? "Custom" : "Default"}</Text>
                    </View>
                  </View>
                </View>
                <View className="gym-template__preview" accessible accessibilityLabel={`Preview: ${preview}`}>
                  <Text className="gym-template__preview-text">{preview}</Text>
                </View>
                {result.data.canEdit && (
                  <PressableScale onPress={() => { haptic.select(); setEditing({ kind }); }} className="gym-template__edit" accessibilityRole="button" accessibilityLabel={`Edit ${TEMPLATE_INFO[kind].label}`}>
                    <GymIcon name="pencil-line" size={16} color={colors.gymPrimary} />
                    <Text className="gym-remind__template">Edit</Text>
                  </PressableScale>
                )}
              </View>
            );
          })}

          {(result.data.added.length > 0 || result.data.canAdd) && (
            <View style={{ gap: 4 }}>
              <Text className="gym-template__title">Your templates</Text>
              <Text className="gym-tx__meta">
                {result.data.added.length === 0
                  ? "Add a message of your own, like an offer or a holiday notice. Tap + to write one."
                  : full
                    ? `You have ${ADDED_MAX} templates, the most a branch can keep. Delete one to add another.`
                    : "Your own messages, listed on Use Template when you send a reminder."}
              </Text>
            </View>
          )}
          {result.data.added.map((item) => {
            const preview = fillTemplate(item.text, SAMPLE_VALUES);
            return (
              <View key={item.id} className="gym-dash-card gym-template">
                <View className="flex-row items-start" style={{ gap: 12 }}>
                  <View className="gym-template__icon">
                    <GymIcon name="file-text" size={20} color={colors.gymPrimary} />
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="gym-template__title" numberOfLines={2}>{item.name}</Text>
                    <Text className="gym-tx__meta" numberOfLines={1}>Send Reminder › Use Template</Text>
                    <View className="gym-tag self-start" style={{ marginTop: 4, backgroundColor: colors.gymPrimarySoft }}>
                      <Text className="gym-tag__label" style={{ color: colors.gymPrimary }}>Added</Text>
                    </View>
                  </View>
                </View>
                <View className="gym-template__preview" accessible accessibilityLabel={`Preview: ${preview}`}>
                  <Text className="gym-template__preview-text">{preview}</Text>
                </View>
                {result.data.canEdit && (
                  <PressableScale onPress={() => { haptic.select(); setEditing({ added: item }); }} className="gym-template__edit" accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}>
                    <GymIcon name="pencil-line" size={16} color={colors.gymPrimary} />
                    <Text className="gym-remind__template">Edit</Text>
                  </PressableScale>
                )}
              </View>
            );
          })}
        </>
      )}

      {editing && data && (
        <TemplateSheet editing={editing} templates={data} onClose={() => setEditing(null)} onSaved={(next) => update(() => next)} />
      )}
    </GymScreen>
  );
}
