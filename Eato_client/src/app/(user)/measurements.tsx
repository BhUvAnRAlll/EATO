import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { inRange, toNumberText } from "@/lib/numberInput";
import { fetchProfile, saveProfile, type SavedData } from "@/lib/profile";
import { measurementSave, type MeasurementSave } from "@/lib/profileScan";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Profile › Edit: change height and weight after setup. Both feed the calorie calculation, so
// the first tap shows what changes (including the daily target) and the second saves it.
export default function Measurements() {
  const getToken = useSessionToken();
  const [data, setData] = useState<SavedData | null>(null);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [pending, setPending] = useState<Extract<MeasurementSave, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // The saved values fill the fields
  useEffect(() => {
    let active = true;
    (async () => {
      const result = await fetchProfile(await getToken());
      if (!active) return;
      if (!result.ok) return setError(isSessionExpired(result) ? SESSION_EXPIRED_MESSAGE : result.error);
      setData(result.data);
      setHeightCm(result.data.profile?.heightCm != null ? String(result.data.profile.heightCm) : "");
      setWeightKg(result.data.profile?.weightKg != null ? String(result.data.profile.weightKg) : "");
    })();
    return () => {
      active = false;
    };
  }, [getToken]);

  const valid = inRange(heightCm, 100, 250) && inRange(weightKg, 30, 300);

  // First tap: work out the save and show it
  const review = () => {
    setError(null);
    const save = measurementSave(data?.profile ?? null, data?.nutrition ?? null, { heightCm: Number(heightCm), weightKg: Number(weightKg) });
    if (!save.ok) return setError(save.error);
    setPending(save);
  };

  // Second tap: save it and go back to Profile (which reloads)
  const confirm = async () => {
    if (!pending || isBusy) return;
    setError(null);
    setIsBusy(true);
    const saved = await saveProfile(await getToken(), pending.body);
    setIsBusy(false);
    if (!saved.ok) return setError(isSessionExpired(saved) ? SESSION_EXPIRED_MESSAGE : saved.error);
    router.back();
  };

  return (
    <SetupScreen
      step="personal"
      showProgress={false}
      title="Height & weight"
      subtitle="Keep these up to date. Your daily targets are recalculated from them."
      onNext={pending ? confirm : review}
      nextLabel={pending ? "Confirm and save" : "Save"}
      canContinue={pending !== null || (data !== null && valid)}
      loading={isBusy}
      // While a save waits for confirmation, Back returns to the fields
      onBack={() => (pending ? setPending(null) : router.canGoBack() ? router.back() : router.replace("/profile"))}
    >
      {error && (
        <View className="mb-3">
          <FormAlert message={error} />
        </View>
      )}
      {pending ? (
        <View className="setup__card setup__card--selected gap-1.5" accessibilityRole="summary">
          <Text className="setup__card-title">Save these changes?</Text>
          {pending.changes.map((line) => (
            <Text key={line} className="setup__card-text">
              {line}
            </Text>
          ))}
        </View>
      ) : data === null && !error ? (
        <ActivityIndicator color={colors.forest} />
      ) : (
        <View className="gap-3">
          <SetupField
            label="Height"
            icon={{ ios: "ruler", android: "height", web: "height" }}
            unit="cm"
            placeholder="170"
            value={heightCm}
            onChangeText={(text) => setHeightCm(toNumberText(text))}
            keyboardType="number-pad"
            invalid={heightCm !== "" && !inRange(heightCm, 100, 250)}
          />
          <SetupField
            label="Current weight"
            icon={{ ios: "scalemass", android: "scale", web: "scale" }}
            unit="kg"
            placeholder="70"
            value={weightKg}
            onChangeText={(text) => setWeightKg(toNumberText(text, true))}
            keyboardType="decimal-pad"
            invalid={weightKg !== "" && !inRange(weightKg, 30, 300)}
          />
          <Text className="type-caption px-1 text-muted">Height 100–250 cm, weight 30–300 kg.</Text>
        </View>
      )}
    </SetupScreen>
  );
}
