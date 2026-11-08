import { useEffect } from "react";
import { Text, View } from "react-native";

import { GymChips } from "@/components/gym/GymField";
import { gymApi } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";

// "Trainer" on the PT form and in Change trainer: No trainer, or one of the branch's trainers
// (added in Staff / Admin Login). value "" is no trainer. The server checks the choice again.
export function TrainerChips({ value, onChange }: { value: string; onChange: (trainerId: string) => void }) {
  const { result } = useGymData(gymApi.trainers);
  // A trainer who has left the branch since is shown as No trainer: tell the form so, or its save
  // would still send the old id and the server refuse it (QA 2026-11-07)
  const gone = result.state === "ready" && value !== "" && !result.data.trainers.some((t) => t.id === value);
  useEffect(() => {
    if (gone) onChange("");
  }, [gone, onChange]);
  if (result.state === "loading") return <Text className="gym-tx__meta">Loading your trainers…</Text>;
  if (result.state === "failed") return <Text className="gym-tx__meta">{result.error}</Text>;
  const trainers = result.data.trainers;
  // A trainer who has left the branch since: shown as no trainer, so saving clears it
  const current = trainers.some((t) => t.id === value) ? value : "";
  return (
    <View style={{ gap: 6 }}>
      <GymChips label="Trainer" options={[{ value: "", label: "No trainer" }, ...trainers.map((t) => ({ value: t.id, label: t.name }))]} value={current} onChange={onChange} />
      {trainers.length === 0 && <Text className="gym-tx__meta">{"No trainers yet. The gym admin adds them in ☰ › Staff / Admin Login."}</Text>}
    </View>
  );
}
