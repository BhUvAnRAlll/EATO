import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { plans, settingOptions, visibilityLabels, type GymVisibility } from "@/lib/gymRules";
import { gyms, type Gym, type GymSettingsChanges } from "@/lib/gyms";
import { colors, switchColors } from "@/theme";

type Props = { gym: Gym; getToken: () => Promise<string | null>; onSaved: (gym: Gym) => void };

// A line under some choices, so the effect is clear
const hints: Record<string, string> = {
  "whoCanPost:everyone": "Anyone in the gym can share posts",
  "whoCanPost:admins": "Announcement-style feed",
  "whoCanComment:off": "Only admins can comment",
};

function Radio({ selected }: { selected: boolean }) {
  return (
    <View className={selected ? "radio radio--selected" : "radio"}>
      {selected && <View className="radio__dot" />}
    </View>
  );
}

// Community Settings: who can post, comment and create events, member approval, post
// moderation and visibility. Each change saves at once and applies across the gym.
export function GymSettingsForm({ gym, getToken, onSaved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (changes: GymSettingsChanges) => {
    setSaving(true);
    setError(null);
    const result = await gyms.updateSettings(await getToken(), gym.id, changes);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.data.gym);
  };

  const choice = <K extends "whoCanPost" | "whoCanComment" | "whoCanCreateEvents">(key: K, label: string) => (
    <View className="gap-2">
      <Text className="gym-group__title">{label}</Text>
      <View accessibilityRole="radiogroup">
        {settingOptions[key].map((option, index, all) => {
          const selected = gym.settings[key] === option.value;
          const hint = hints[`${key}:${option.value}`];
          return (
            <Pressable key={option.value} onPress={() => !selected && save({ [key]: option.value } as GymSettingsChanges)} disabled={saving} className={["about-row", index === 0 ? "friend-row--first" : "", index === all.length - 1 ? "friend-row--last" : ""].join(" ")} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${label}: ${option.label}`}>
              <View className="min-w-0 flex-1">
                <Text className="join-card__title">{option.label}</Text>
                {hint && <Text className="join-card__hint">{hint}</Text>}
              </View>
              <Radio selected={selected} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const toggle = (key: "memberApproval" | "postModeration", label: string, hint: string, first: boolean) => (
    <View className={["about-row", first ? "friend-row--first" : "friend-row--last"].join(" ")}>
      <View className="min-w-0 flex-1">
        <Text className="join-card__title">{label}</Text>
        <Text className="join-card__hint">{hint}</Text>
      </View>
      <Switch {...switchColors} value={gym.settings[key]} onValueChange={(value) => save({ [key]: value })} disabled={saving} accessibilityLabel={label} />
    </View>
  );

  return (
    <View className="gap-5">
      <View className="info-banner">
        <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.inkSoft} />
        <Text className="info-banner__text">Changes apply immediately across the gym community.</Text>
      </View>
      {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {choice("whoCanPost", "Who can post")}
      {choice("whoCanComment", "Who can comment")}
      <View className="gap-2">
        <Text className="gym-group__title">Moderation</Text>
        <View>
          {toggle("memberApproval", "Member approval", "New members must be approved before joining", true)}
          {toggle("postModeration", "Post moderation", "Member posts are reviewed by staff before publishing", false)}
        </View>
      </View>
      {choice("whoCanCreateEvents", "Event permissions")}
      <View className="gap-2">
        <Text className="gym-group__title">Community visibility</Text>
        <View accessibilityRole="radiogroup">
          {(Object.keys(visibilityLabels) as GymVisibility[]).map((value, index, all) => {
            const selected = gym.visibility === value;
            return (
              <Pressable key={value} onPress={() => !selected && save({ visibility: value })} disabled={saving} className={["about-row", index === 0 ? "friend-row--first" : "", index === all.length - 1 ? "friend-row--last" : ""].join(" ")} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${visibilityLabels[value].label}: ${visibilityLabels[value].hint}`}>
                <View className="min-w-0 flex-1">
                  <Text className="join-card__title">{visibilityLabels[value].label}</Text>
                  <Text className="join-card__hint">{visibilityLabels[value].hint}</Text>
                </View>
                <Radio selected={selected} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// Subscription: the plan shown for the gym. A label only: no payment is taken, and the
// confirmation says so.
export function GymPlanPicker({ gym, getToken, onSaved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planChoice, setPlanChoice] = useState<Gym["plan"] | null>(null);

  const save = async (plan: Gym["plan"]) => {
    setSaving(true);
    setError(null);
    const result = await gyms.updateSettings(await getToken(), gym.id, { plan });
    setSaving(false);
    setPlanChoice(null);
    if (!result.ok) return setError(result.error);
    onSaved(result.data.gym);
  };

  return (
    <View className="gap-3">
      <View className="info-banner">
        <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.inkSoft} />
        <Text className="info-banner__text">Plans are a preview only: no payment is taken and nothing is charged.</Text>
      </View>
      {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
      {plans.map((plan) => {
        const current = gym.plan === plan.id;
        return (
          <View key={plan.id} className="join-card flex-row items-center gap-3">
            <View className="min-w-0 flex-1">
              <Text className="join-card__title">{plan.name} · {plan.price}</Text>
              <Text className="join-card__hint">{plan.perks}</Text>
            </View>
            {current ? (
              <View className="gym-badge gym-badge--staff"><Text className="gym-badge__label gym-badge__label--staff">Current</Text></View>
            ) : (
              <Pressable onPress={() => setPlanChoice(plan.id)} disabled={saving} className="gym-join" accessibilityRole="button" accessibilityLabel={`Switch to ${plan.name}`}>
                <Text className="gym-join__label">Switch</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <ConfirmSheet
        visible={planChoice !== null}
        title={`Switch to ${plans.find((p) => p.id === planChoice)?.name ?? "this plan"}?`}
        text="This only changes the plan shown for the gym. No payment is processed."
        confirmLabel="Switch plan"
        busy={saving}
        onConfirm={() => planChoice && save(planChoice)}
        onCancel={() => setPlanChoice(null)}
      />
    </View>
  );
}
