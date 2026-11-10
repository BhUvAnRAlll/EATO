import { useEffect, useState } from "react";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { SkeletonCard } from "@/components/Skeleton";
import { FoodForm, foodComplete } from "@/components/food/FoodForm";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { hud } from "@/lib/hud";
import { fetchProfile, saveFood, type FoodAnswers } from "@/lib/profile";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, useSessionToken } from "@/lib/session";

const empty: FoodAnswers = { diet: null, cuisines: [], dislikes: "", allergies: "", mealsPerDay: null };

// Profile › Food preferences (2026-11-10): diet, the food usually eaten, allergies, dislikes and
// meals per day, the same answers the AI Coach intake's Food step asks. The coach's meals and the
// kitchen read them; nothing else in the profile changes.
export default function FoodPreferences() {
  const getToken = useSessionToken();
  const [food, setFood] = useState<FoodAnswers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await fetchProfile(await getToken());
      if (!active) return;
      if (!result.ok) return setError(isSessionExpired(result) ? SESSION_EXPIRED_MESSAGE : result.error);
      const p = result.data.profile;
      setFood(p ? { diet: p.diet, cuisines: p.cuisines, dislikes: p.dislikes ?? "", allergies: p.allergies ?? "", mealsPerDay: p.mealsPerDay } : empty);
    })();
    return () => {
      active = false;
    };
  }, [getToken]);

  const save = async () => {
    if (!food || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveFood(await getToken(), { ...food, dislikes: food.dislikes.trim(), allergies: food.allergies.trim() });
    setSaving(false);
    if (!result.ok) return setError(isSessionExpired(result) ? SESSION_EXPIRED_MESSAGE : result.error);
    hud.success("Food preferences saved");
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  };

  return (
    <SetupScreen
      title="Food preferences"
      subtitle="Your coach and kitchen plan meals around these."
      onNext={save}
      nextLabel="Save"
      canContinue={food !== null && foodComplete(food)}
      loading={saving}
      showProgress={false}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
    >
      {error && <FormAlert message={error} />}
      {food ? <FoodForm value={food} onChange={(changes) => setFood({ ...food, ...changes })} /> : !error && <SkeletonCard tall />}
    </SetupScreen>
  );
}
