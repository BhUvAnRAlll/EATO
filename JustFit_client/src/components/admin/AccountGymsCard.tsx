import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminField } from "@/components/admin/AdminField";
import { adminPlatform, type AccountGyms } from "@/lib/adminPlatform";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { confirmChoice } from "@/lib/nativeSheets";

// Super Admin › an account › Gyms and access (the brief's section 7): the gym memberships on its
// number and the gyms it works at with its role, and suspending it (sessions end, sign-in refused)
// or reactivating it, with a reason. justFit admins can't be suspended here (the server refuses).
export function AccountGymsCard({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const load = useCallback((token: string | null) => adminPlatform.accountGyms(token, userId), [userId]);
  const { result, set, retry } = useGymData(load);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const change = useGymSave(({ suspension }: { suspension: AccountGyms["suspension"] }) => {
    if (result.state === "ready") set({ ...result.data, suspension });
    setAsking(false);
    setReason("");
  }, (d: { suspension: AccountGyms["suspension"] }) => (d.suspension ? "Account suspended" : "Account reactivated"));

  if (result.state === "loading") return null;
  if (result.state === "failed") {
    return (
      <Pressable onPress={retry} className="card" accessibilityRole="button">
        <Text className="meta-text">{`Gyms and access: ${result.error}`}</Text>
      </Pressable>
    );
  }
  const data = result.data;
  const suspend = async () => {
    if (reason.trim().length < 5) return;
    const sure = await confirmChoice({ title: "Suspend this account?", message: "They're signed out everywhere and can't sign in until it's reactivated.", confirmLabel: "Suspend" });
    if (sure) change.save((token) => adminPlatform.suspend(token, userId, reason.trim()));
  };

  return (
    <View className="card" style={{ gap: 10 }}>
      <Text className="card__title">Gyms and access</Text>
      {data.memberships.length === 0 && data.teams.length === 0 ? <Text className="meta-text">No gym memberships or gym team roles.</Text> : null}
      {data.memberships.map((m) => (
        <Text key={`m${m.id}`} className="type-body">{`Member · ${m.gym} · ${m.code} · ${m.active ? `until ${m.expiresOn}` : `ended ${m.expiresOn}`}`}</Text>
      ))}
      {data.teams.map((t) => (
        <Pressable key={`t${t.gymId}`} onPress={() => router.push({ pathname: "/admin/gyms/[id]", params: { id: String(t.gymId) } })} accessibilityRole="button">
          <Text className="type-body text-primary-text">{`${t.roleLabel} · ${t.gym}`}</Text>
        </Pressable>
      ))}
      {data.suspension ? (
        <View style={{ gap: 8 }}>
          <Text className="type-body text-danger">{`Suspended since ${new Date(data.suspension.at).toLocaleDateString("en-IN")}: “${data.suspension.reason}”`}</Text>
          {change.error ? <FormAlert message={change.error} /> : null}
          <Pressable onPress={() => change.save((token) => adminPlatform.reactivate(token, userId))} disabled={change.busy} className="btn-forest" accessibilityRole="button">
            <Text className="btn-forest__label">{change.busy ? "Saving…" : "Reactivate account"}</Text>
          </Pressable>
        </View>
      ) : isAdmin ? null : asking ? (
        <View style={{ gap: 8 }}>
          <AdminField label="Why is it suspended?" value={reason} onChangeText={setReason} maxLength={200} multiline placeholder="e.g. Reported for sharing their login" />
          {change.error ? <FormAlert message={change.error} /> : null}
          <Pressable onPress={suspend} disabled={change.busy || reason.trim().length < 5} className={reason.trim().length < 5 ? "btn-forest btn--disabled" : "btn-forest"} accessibilityRole="button">
            <Text className={reason.trim().length < 5 ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>{change.busy ? "Suspending…" : "Suspend account"}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setAsking(true)} accessibilityRole="button">
          <Text className="type-caption text-danger">Suspend this account…</Text>
        </Pressable>
      )}
    </View>
  );
}
