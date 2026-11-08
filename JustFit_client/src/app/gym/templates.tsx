import { useState } from "react";
import { RefreshControl, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { TemplateSheet } from "@/components/gym/TemplateSheet";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { SAMPLE_VALUES, TEMPLATE_INFO, TEMPLATE_KINDS, fillTemplate, templateText, type TemplateKind } from "@/lib/reminderTemplates";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const ICON: Record<TemplateKind, GymIconName> = { due: "credit-card", expiry: "calendar-clock", expired: "calendar-x", enquiry: "user-plus" };

// ☰ › Reminder Templates (2026-11-08): this branch's wording for the messages Send Reminder and
// the enquiry cards' WhatsApp write, each shown with a sample member filled in, tagged Custom or
// Default. The gym admin edits one in TemplateSheet; Staff read them only. They go out from the
// phone's own WhatsApp or Messages app: justFit's own SMS keep their DLT-registered text.
export default function GymTemplates() {
  const colors = useThemeColors();
  const { result, retry, update, refreshing, refresh } = useGymData(gymApi.templates);
  const [editing, setEditing] = useState<TemplateKind | null>(null);

  return (
    <GymScreen title="Reminder Templates" refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
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
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <View className="gym-template__icon">
                    <GymIcon name={ICON[kind]} size={20} color={colors.gymPrimary} />
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                    <Text className="gym-template__title" numberOfLines={2}>{TEMPLATE_INFO[kind].label}</Text>
                    <Text className="gym-tx__meta" numberOfLines={2}>{TEMPLATE_INFO[kind].usedFor}</Text>
                  </View>
                  <View className="gym-tag" style={{ backgroundColor: custom ? colors.gymPrimarySoft : colors.gymSuccessSoft }}>
                    <Text className="gym-tag__label" style={{ color: custom ? colors.gymPrimary : colors.gymSuccess }}>{custom ? "Custom" : "Default"}</Text>
                  </View>
                </View>
                <View className="gym-template__preview" accessible accessibilityLabel={`Preview: ${preview}`}>
                  <Text className="gym-template__preview-text">{preview}</Text>
                </View>
                {result.data.canEdit && (
                  <PressableScale onPress={() => { haptic.select(); setEditing(kind); }} className="gym-template__edit" accessibilityRole="button" accessibilityLabel={`Edit ${TEMPLATE_INFO[kind].label}`}>
                    <GymIcon name="pencil-line" size={16} color={colors.gymPrimary} />
                    <Text className="gym-remind__template">Edit</Text>
                  </PressableScale>
                )}
              </View>
            );
          })}
        </>
      )}

      {editing && result.state === "ready" && (
        <TemplateSheet kind={editing} saved={result.data.templates[editing]} onClose={() => setEditing(null)} onSaved={(data) => update(() => data)} />
      )}
    </GymScreen>
  );
}
