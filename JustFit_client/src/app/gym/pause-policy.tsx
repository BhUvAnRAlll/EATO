import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { gymApi, type PausePolicy } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// "" is no limit; otherwise a whole number
const parse = (text: string) => (text.trim() === "" ? null : /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const shown = (n: number | null) => (n === null ? "" : String(n));

// Pause requests › Pause limits: the branch's rules for members' pause requests, counted over any
// 12 months (approved and waiting requests): how many pauses, how many days, the longest pause.
// Staff pausing a membership themselves aren't held to them.
export default function GymPausePolicy() {
  const { result, retry, set } = useGymData(gymApi.pausePolicy);
  return (
    <GymScreen title="Pause limits">
      {result.state === "loading" && <GymLoading label="Loading the limits" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <PolicyForm policy={result.data.policy} onSaved={(policy) => set({ ...result.data, policy })} />}
    </GymScreen>
  );
}

function PolicyForm({ policy, onSaved }: { policy: PausePolicy; onSaved: (p: PausePolicy) => void }) {
  const [perYear, setPerYear] = useState(shown(policy.maxPerYear));
  const [daysYear, setDaysYear] = useState(shown(policy.maxDaysPerYear));
  const [each, setEach] = useState(String(policy.maxDaysEach));
  const save = useGymSave(({ policy: saved }: { policy: PausePolicy }) => onSaved(saved), "Pause limits saved");
  const p = { maxPerYear: parse(perYear), maxDaysPerYear: parse(daysYear), maxDaysEach: parse(each) };
  const problem =
    Number.isNaN(p.maxPerYear) || (p.maxPerYear !== null && (p.maxPerYear < 1 || p.maxPerYear > 12)) ? "Pauses a year is 1 to 12, or empty for no limit."
      : Number.isNaN(p.maxDaysPerYear) || (p.maxDaysPerYear !== null && (p.maxDaysPerYear < 1 || p.maxDaysPerYear > 365)) ? "Days a year is 1 to 365, or empty for no limit."
      : p.maxDaysEach === null || Number.isNaN(p.maxDaysEach) || p.maxDaysEach < 1 || p.maxDaysEach > 90 ? "The longest pause is 1 to 90 days."
      : p.maxDaysPerYear !== null && p.maxDaysEach > p.maxDaysPerYear ? "The longest pause can't be more than the days a year."
      : null;

  return (
    <View style={{ gap: 14 }}>
      <Text className="gym-tx__meta">{"Members' pause requests must fit these, counted over any 12 months. Requests that don't are refused with the reason. A rejected or cancelled request doesn't count."}</Text>
      <GymField label="Pauses a year (empty: no limit)" icon="circle-pause" value={perYear} onChangeText={(t) => setPerYear(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="No limit" pinLabel />
      <GymField label="Pause days a year (empty: no limit)" icon="calendar" value={daysYear} onChangeText={(t) => setDaysYear(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="No limit" pinLabel />
      <GymField label="Longest single pause (days)" icon="clock" value={each} onChangeText={(t) => setEach(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="90" pinLabel />
      {problem ? <Text className="gym-tx__meta">{problem}</Text> : null}
      {save.error ? <FormAlert message={save.error} /> : null}
      <GymPrimaryButton label="Save pause limits" ready={!problem} busy={save.busy} icon="check" onPress={() => !problem && save.save((token) => gymApi.savePausePolicy(token, { maxPerYear: p.maxPerYear, maxDaysPerYear: p.maxDaysPerYear, maxDaysEach: p.maxDaysEach as number }))} />
    </View>
  );
}
