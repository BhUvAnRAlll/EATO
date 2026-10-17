import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { plans, settingOptions, visibilityLabels, type GymVisibility } from "@/lib/gymRules";
import { gyms, type Gym, type GymSettingsChanges } from "@/lib/gyms";
import { colors } from "@/theme";

type Props = { gym: Gym; getToken: () => Promise<string | null>; onSaved: (gym: Gym) => void };

// Manage → Settings: who can post, comment and create events, member approval, post moderation,
// visibility, and the plan card. Each change saves at once. The plan is a label only: there is
// no payment, and the confirmation says so.
export function GymSettingsForm({ gym, getToken, onSaved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planChoice, setPlanChoice] = useState<Gym["plan"] | null>(null);

  const save = async (changes: GymSettingsChanges) => {
    setSaving(true);
    setError(null);
    const result = await gyms.updateSettings(await getToken(), gym.id, changes);
    setSaving(false);
    setPlanChoice(null);
    if (!result.ok) return setError(result.error);
    onSaved(result.data.gym);
  };

  const choice = <K extends "whoCanPost" | "whoCanComment" | "whoCanCreateEvents">(key: K, label: string) => (
    <View className="post__card gap-2">
      <Text className="setup__section">{label}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {settingOptions[key].map((option) => {
          const selected = gym.settings[key] === option.value;
          return (
            <Pressable key={option.value} onPress={() => !selected && save({ [key]: option.value } as GymSettingsChanges)} disabled={saving} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${label}: ${option.label}`}>
              <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const toggle = (key: "memberApproval" | "postModeration", label: string, hint: string) => (
    <View className="post__card flex-row items-center gap-3">
      <View className="flex-1">
        <Text className="auth__label">{label}</Text>
        <Text className="home__note">{hint}</Text>
      </View>
      <Switch value={gym.settings[key]} onValueChange={(value) => save({ [key]: value })} disabled={saving} trackColor={{ true: colors.forest }} accessibilityLabel={label} />
    </View>
  );

  return (
    <View className="gap-3">
      {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {choice("whoCanPost", "Who can post")}
      {choice("whoCanComment", "Who can comment")}
      {choice("whoCanCreateEvents", "Who can create events")}
      {toggle("memberApproval", "Member approval", "New members wait for an admin to approve them.")}
      {toggle("postModeration", "Post moderation", "Members' posts wait for staff before others see them.")}
      <View className="post__card gap-2">
        <Text className="setup__section">Visibility</Text>
        {(Object.keys(visibilityLabels) as GymVisibility[]).map((value) => {
          const selected = gym.visibility === value;
          return (
            <Pressable key={value} onPress={() => !selected && save({ visibility: value })} disabled={saving} className="flex-row items-center gap-3 py-1.5" accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${visibilityLabels[value].label}: ${visibilityLabels[value].hint}`}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? colors.forest : colors.creamLine, alignItems: "center", justifyContent: "center" }}>
                {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.forest }} />}
              </View>
              <View className="flex-1">
                <Text className="auth__label">{visibilityLabels[value].label}</Text>
                <Text className="home__note">{visibilityLabels[value].hint}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="post__card gap-2">
        <Text className="setup__section">Plan</Text>
        <Text className="home__note">Plans are a preview only: no payment is taken and nothing is charged.</Text>
        {plans.map((plan) => {
          const current = gym.plan === plan.id;
          return (
            <View key={plan.id} className="flex-row items-center gap-3 py-1.5">
              <View className="flex-1">
                <Text className="auth__label">{plan.name} · {plan.price}</Text>
                <Text className="home__note">{plan.perks}</Text>
              </View>
              {current ? (
                <Text className="post__time" style={{ color: colors.leaf }}>Current</Text>
              ) : (
                <Pressable onPress={() => setPlanChoice(plan.id)} disabled={saving} className="admin__action" accessibilityRole="button" accessibilityLabel={`Switch to ${plan.name}`}>
                  <Text className="admin__action-label">Switch</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <ConfirmSheet
        visible={planChoice !== null}
        title={`Switch to ${plans.find((p) => p.id === planChoice)?.name ?? "this plan"}?`}
        text="This only changes the plan shown for the gym. No payment is processed."
        confirmLabel="Switch plan"
        busy={saving}
        onConfirm={() => planChoice && save({ plan: planChoice })}
        onCancel={() => setPlanChoice(null)}
      />
    </View>
  );
}
