import { useCallback } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { apiFetch, type ApiResult } from "@/lib/api";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors } from "@/theme";

type Featured = { featured: boolean; unavailable?: boolean };
const signedOut = (): Promise<ApiResult<Featured>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });

// Super Admin › a gym › Featured on Discover (2026-11-10): members' Discover shows featured gyms first
// with a badge. Only an approved branch can be featured (the server checks).
export function FeatureGymCard({ gymId }: { gymId: number }) {
  const switchColors = useSwitchColors();
  const load = useCallback((token: string | null) => (token ? apiFetch<Featured>(`/api/admin/portal/gyms/${gymId}/feature`, { token }) : signedOut()), [gymId]);
  const { result, set } = useGymData(load);
  const save = useGymSave((data: Featured) => set(data), (d: Featured) => (d.featured ? "Gym featured" : "No longer featured"));
  if (result.state !== "ready" || result.data.unavailable) return null;
  return (
    <View className="card" style={{ gap: 8 }}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="flex-1" style={{ gap: 2 }}>
          <Text className="card__title">Featured on Discover</Text>
          <Text className="meta-text">Shown first to members, with a badge.</Text>
        </View>
        <Switch
          value={result.data.featured}
          disabled={save.busy}
          onValueChange={(on) => save.save((token) => (token ? apiFetch<Featured>(`/api/admin/portal/gyms/${gymId}/feature`, { token, method: "POST", body: { featured: on } }) : signedOut()))}
          {...switchColors}
          accessibilityLabel="Featured on Discover"
        />
      </View>
      {save.error ? <FormAlert message={save.error} /> : null}
    </View>
  );
}
