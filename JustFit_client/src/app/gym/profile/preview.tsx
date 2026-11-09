import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { useProfileDraft } from "@/components/gym/ProfileParts";
import { GymPageView } from "@/components/gymHub/GymPageView";
import { gymApi, type GymProfile } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym Profile › Preview (2026-11-09): the gym's page drawn exactly as the member app draws it
// (GymPageView), from the draft, with the sections switched off left out. Nothing here is visible to
// members until Publish, which the banner offers to logins allowed to publish.
export default function GymProfilePreview() {
  const colors = useThemeColors();
  const preview = useGymData(gymApi.profilePreview);
  const draft = useProfileDraft();
  const [at] = useState(() => Date.now());
  const onPublished = useCallback((next: GymProfile) => draft.update(() => next), [draft]);
  const { busy, error, save } = useGymSave(onPublished, "Published. Members see it now");

  const p = draft.result.state === "ready" ? draft.result.data.publishing : null;
  const publish = async () => {
    const ok = await confirmChoice({ title: "Publish your gym profile?", message: "Members in the justFit app will see this version of your profile.", confirmLabel: "Publish" });
    if (ok) save((token) => gymApi.publishProfile(token));
  };

  return (
    <GymScreen title="Preview" scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <View className="gym-dash-card" style={{ padding: 12, gap: 4, backgroundColor: colors.gymPrimarySoft }}>
          <Text className="gym-dash-row__title">This is what members will see</Text>
          <Text className="gym-tx__meta">
            {p?.state === "published" ? "Your profile is published as shown." : "These are your draft changes. Members see them once you publish."}
          </Text>
        </View>
        {error ? <FormAlert message={error} /> : null}
        {draft.canPublish && p && p.state !== "published" && (
          <>
            <GymPrimaryButton label="Publish" icon="send" ready={!p.problem} busy={busy} onPress={publish} />
            {p.problem ? <Text className="gym-tx__meta" style={{ textAlign: "center" }}>{p.problem}</Text> : null}
          </>
        )}
      </View>
      {preview.result.state === "loading" && <View style={{ padding: 16 }}><GymLoading label="Loading the preview" /></View>}
      {preview.result.state === "failed" && <View style={{ padding: 16 }}><GymError error={preview.result.error} onRetry={preview.retry} /></View>}
      {preview.result.state === "ready" && <View className="flex-1 bg-cream"><GymPageView gym={preview.result.data} at={at} /></View>}
    </GymScreen>
  );
}
