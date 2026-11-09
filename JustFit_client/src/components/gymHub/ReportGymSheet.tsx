import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PrimaryButton } from "@/components/PrimaryButton";
import { COMPLAINT_CATEGORIES, DETAILS_MAX, DETAILS_MIN, complaintsApi, type ComplaintCategory } from "@/lib/complaints";
import { fonts } from "@/constants/fonts";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// A gym's page › Report a problem (the brief's section 7): what it's about and what happened. It goes
// to the justFit team, not the gym; the member hears back in Notifications when it is closed.
export function ReportGymSheet({ gymId, gymName, onClose }: { gymId: number; gymName: string; onClose: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = category !== null && details.trim().length >= DETAILS_MIN;

  const send = async () => {
    if (!ready || busy || !category) return;
    setBusy(true);
    setError(null);
    const answer = await complaintsApi.report(await getToken().catch(() => null), { gymId, category, details: details.trim() });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    hud.success("Report sent to justFit");
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {() => (
      <KeyboardAvoider fill={false}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
          <Text className="card__title">{`Report a problem with ${gymName}`}</Text>
          <Text className="type-caption text-muted">This goes to the justFit team, not the gym. We look into every report.</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {COMPLAINT_CATEGORIES.map((c) => (
              <Pressable key={c.id} onPress={() => setCategory(c.id)} className={category === c.id ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="button" accessibilityState={{ selected: category === c.id }}>
                <Text className={category === c.id ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <View className="setup__field" style={{ alignItems: "flex-start" }}>
            <TextInput
              value={details}
              onChangeText={(t) => setDetails(t.slice(0, DETAILS_MAX))}
              placeholder="What happened, and when?"
              placeholderTextColor={colors.faint}
              multiline
              maxLength={DETAILS_MAX}
              style={{ flex: 1, minHeight: 96, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, textAlignVertical: "top" }}
              accessibilityLabel="What happened"
            />
          </View>
          <Text className="type-caption text-muted self-end">{details.trim().length < DETAILS_MIN ? `At least ${DETAILS_MIN} characters` : `${details.length}/${DETAILS_MAX}`}</Text>
          {error ? <FormAlert message={error} /> : null}
          <PrimaryButton label="Send report" onPress={send} loading={busy} disabled={!ready} />
        </ScrollView>
      </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
