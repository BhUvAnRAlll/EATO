import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymScreen } from "@/components/gym/GymScreen";
import { DraftNote, ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import { SaveButton } from "@/components/gym/SaveButton";
import { gymApi, type GymProfile } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { SECTIONS, type ShowSections } from "@/lib/gymProfile";
import { useSwitchColors, useThemeColors } from "@/theme";

// Gym Profile › What members see (2026-11-09, the user's request): one switch per section of the
// gym's page. A section switched off is left out for members (the server sends it empty), even when
// it's filled in; the gym's own screens keep it. Saved to the draft like every other change.
export default function GymProfileVisibility() {
  const { result, retry, canEdit } = useProfileDraft();
  return (
    <GymScreen title="What members see">
      <ProfileLoad result={result} retry={retry}>{(profile) => <VisibilityForm saved={profile} canEdit={canEdit} />}</ProfileLoad>
    </GymScreen>
  );
}

function VisibilityForm({ saved, canEdit }: { saved: GymProfile; canEdit: boolean }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [current, setCurrent] = useState(saved.show);
  const [show, setShow] = useState<ShowSections>(saved.show);
  const { busy, error, save } = useGymSave((data: GymProfile) => setCurrent(data.show), "Saved to your draft");
  const changed = SECTIONS.some((s) => show[s.id] !== current[s.id]);

  return (
    <>
      <Text className="gym-tx__meta">{"Switch off anything you don't want members to see on your gym's page. Your name, area and city always show."}</Text>
      <View className="gym-dash-card">
        {SECTIONS.map((s, index) => (
          <View key={s.id} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }}>
            <View className="min-w-0 flex-1">
              <Text className="gym-dash-row__title" style={show[s.id] ? undefined : { color: colors.gymFaint }}>{s.label}</Text>
              <Text className="gym-dash-row__text">{show[s.id] ? s.line : "Hidden from members"}</Text>
            </View>
            <Switch
              value={show[s.id]}
              disabled={!canEdit}
              onValueChange={(on) => setShow((all) => ({ ...all, [s.id]: on }))}
              {...switchColors}
              trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }}
              accessibilityLabel={`Show ${s.label} to members`}
            />
          </View>
        ))}
      </View>
      {error ? <FormAlert message={error} /> : null}
      {canEdit && <SaveButton label="Save to draft" ready={changed} busy={busy} onPress={() => save((token) => gymApi.updateProfile(token, { show }))} />}
      <DraftNote canEdit={canEdit} />
    </>
  );
}
