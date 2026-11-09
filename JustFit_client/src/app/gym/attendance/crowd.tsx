import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { DEFAULT_THRESHOLDS, LEVEL_LABEL, crowdApi, type GymCrowd } from "@/lib/gymCrowd";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";

const STAY_SOURCE = { gym: "your figure", history: "your members' visits", default: "a typical workout" } as const;
const whole = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null);

// Attendance › Crowd settings (Attendance › Location and QR code): how many people the branch holds
// at once, the usual workout (it decides when a visit that never checked out stops counting) and
// where Moderate, Busy and Very busy start. Members see the levels on their membership page.
export default function GymCrowdSettings() {
  const { result, retry, set } = useGymData(crowdApi.gym);
  return (
    <GymScreen title="Crowd settings">
      {result.state === "loading" && <GymLoading label="Loading the settings" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <CrowdForm crowd={result.data} onSaved={set} />}
    </GymScreen>
  );
}

function CrowdForm({ crowd, onSaved }: { crowd: GymCrowd; onSaved: (c: GymCrowd) => void }) {
  const getToken = useSessionToken();
  const s = crowd.settings;
  const [capacity, setCapacity] = useState(s.capacity ? String(s.capacity) : "");
  const [stay, setStay] = useState(s.avgStayMin ? String(s.avgStayMin) : "");
  const [levels, setLevels] = useState({ moderate: String(s.thresholds.moderate), busy: String(s.thresholds.busy), veryBusy: String(s.thresholds.veryBusy) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cap = capacity.trim() === "" ? null : whole(capacity);
  const stayMin = stay.trim() === "" ? null : whole(stay);
  const t = { moderate: whole(levels.moderate), busy: whole(levels.busy), veryBusy: whole(levels.veryBusy) };
  const problem =
    capacity.trim() !== "" && (cap === null || cap < 5 || cap > 2000) ? "Capacity is 5 to 2,000 people."
      : stay.trim() !== "" && (stayMin === null || stayMin < 15 || stayMin > 300) ? "The usual workout is 15 to 300 minutes."
      : t.moderate === null || t.busy === null || t.veryBusy === null || t.moderate < 5 || t.veryBusy > 100 || !(t.moderate < t.busy && t.busy < t.veryBusy) ? "Levels start at rising percentages, 5 to 100."
      : null;

  const save = async () => {
    if (problem || saving || t.moderate === null || t.busy === null || t.veryBusy === null) return;
    setSaving(true);
    setError("");
    const custom = t.moderate !== DEFAULT_THRESHOLDS.moderate || t.busy !== DEFAULT_THRESHOLDS.busy || t.veryBusy !== DEFAULT_THRESHOLDS.veryBusy;
    const answer = await crowdApi.saveSettings(await getToken().catch(() => null), {
      capacity: cap,
      avgStayMin: stayMin,
      thresholds: custom ? { moderate: t.moderate, busy: t.busy, veryBusy: t.veryBusy } : null,
    });
    setSaving(false);
    if (!answer.ok) return setError(answer.error);
    onSaved(answer.data);
    hud.success("Crowd settings saved");
  };

  return (
    <View style={{ gap: 14 }}>
      <Text className="gym-page-section">Capacity</Text>
      <GymField label="People the gym holds at once" icon="users" value={capacity} onChangeText={(v) => setCapacity(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder="e.g. 60" hint="Without it, members see how many are inside but no crowd level." />

      <Text className="gym-page-section">Usual workout</Text>
      <GymField label="Minutes (optional)" icon="clock" value={stay} onChangeText={(v) => setStay(v.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder={String(crowd.stay.minutes)} hint={`Now ${crowd.stay.minutes} minutes, from ${STAY_SOURCE[crowd.stay.source]}. A check-in without a check-out stops counting after twice this, at least 2 hours.`} />

      <Text className="gym-page-section">Crowd levels (% of capacity)</Text>
      <View className="flex-row" style={{ gap: 10 }}>
        {(["moderate", "busy", "veryBusy"] as const).map((key) => (
          <View key={key} className="flex-1">
            <GymField label={`${LEVEL_LABEL[key === "veryBusy" ? "very_busy" : key]} from`} value={levels[key]} onChangeText={(v) => setLevels((l) => ({ ...l, [key]: v.replace(/\D/g, "").slice(0, 3) }))} keyboardType="number-pad" pinLabel />
          </View>
        ))}
      </View>
      <Text className="gym-tx__meta">{`Below ${t.moderate ?? "…"}% is Low. justFit's defaults are ${DEFAULT_THRESHOLDS.moderate}, ${DEFAULT_THRESHOLDS.busy} and ${DEFAULT_THRESHOLDS.veryBusy}.`}</Text>

      {problem ? <Text className="gym-tx__meta">{problem}</Text> : null}
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save crowd settings" ready={!problem} busy={saving} onPress={save} />
    </View>
  );
}
