import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { gymApi, type GymDashboard } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › Branch details: the open branch's name, area and city (shown on Home's header). The
// gym's own name is the justFit team's to change. They see every change on the branch's page and
// in their activity log. (The admin's own name was removed from here on 2026-11-07.)
export default function GymDetails() {
  const { result, retry } = useGymData(gymApi.dashboard);
  return (
    <GymScreen title="Branch details">
      {result.state === "loading" && <GymLoading label="Loading your gym" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <DetailsForm gym={result.data.gym} />}
    </GymScreen>
  );
}

function DetailsForm({ gym }: { gym: GymDashboard["gym"] }) {
  const [branch, setBranch] = useState(gym.branch);
  const [area, setArea] = useState(gym.area);
  const [city, setCity] = useState(gym.city);
  const { busy, error, save } = useGymSave(() => router.back());

  // Only what changed is sent
  const changes: { branch?: string; area?: string; city?: string } = {};
  if (branch.trim() !== gym.branch) changes.branch = branch.trim();
  if (area.trim() !== gym.area) changes.area = area.trim();
  if (city.trim() !== gym.city) changes.city = city.trim();
  const valid = [branch, area, city].every((v) => v.trim().length >= 2);
  const ready = valid && Object.keys(changes).length > 0;

  return (
    <>
      <Text className="gym-section-title">{`${gym.name} branch`}</Text>
      <GymField label="Branch name" value={branch} onChangeText={setBranch} maxLength={80} placeholder="For example: Tumkur" />
      <GymField label="Area" value={area} onChangeText={setArea} maxLength={80} placeholder="For example: Anna Nagar" />
      <GymField label="City" value={city} onChangeText={setCity} maxLength={60} placeholder="For example: Chennai" />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateDetails(token, changes))} />
    </>
  );
}
