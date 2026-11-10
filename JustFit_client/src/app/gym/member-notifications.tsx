import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { gymApi, type MemberNotice } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useSwitchColors, useThemeColors } from "@/theme";

// Settings › Messages › Member notifications (2026-11-10, the user's choice): members don't switch
// their notifications; the branch decides which membership and pause notices its members get in
// their justFit inbox. Every notice is on until it's turned off. Gym admin, and Staff with
// SMS › Member notifications.
export default function GymMemberNotifications() {
  const { result, retry, set } = useGymData(gymApi.memberNotices);
  return (
    <GymScreen title="Member notifications">
      {result.state === "loading" && <GymLoading label="Loading the notices" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <NoticesForm notices={result.data.notices} onSaved={(notices) => set({ notices })} />}
    </GymScreen>
  );
}

function NoticesForm({ notices, onSaved }: { notices: MemberNotice[]; onSaved: (n: MemberNotice[]) => void }) {
  const switchColors = useSwitchColors();
  const colors = useThemeColors();
  const [on, setOn] = useState(() => new Set(notices.filter((n) => n.on).map((n) => n.kind)));
  const save = useGymSave(({ notices: saved }: { notices: MemberNotice[] }) => onSaved(saved), "Member notifications saved");
  const changed = notices.some((n) => n.on !== on.has(n.kind));
  const groups: [string, MemberNotice[]][] = [
    ["Memberships", notices.filter((n) => n.kind.startsWith("membership."))],
    ["Pauses", notices.filter((n) => n.kind.startsWith("pause."))],
  ];

  return (
    <View style={{ gap: 14 }}>
      <Text className="gym-tx__meta">{"What your members are told in their justFit app. Members can't turn these off themselves."}</Text>
      {groups.map(([title, list]) => (
        <View key={title} className="gym-dash-card" style={{ gap: 12 }}>
          <Text className="gym-section-title">{title}</Text>
          {list.map((n) => (
            <View key={n.kind} className="flex-row items-center" style={{ gap: 12 }}>
              <Text className="gym-tx__name flex-1">{n.label}</Text>
              <Switch
                value={on.has(n.kind)}
                onValueChange={(value) => setOn((current) => { const next = new Set(current); if (value) next.add(n.kind); else next.delete(n.kind); return next; })}
                {...switchColors}
                trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }}
                accessibilityLabel={n.label}
              />
            </View>
          ))}
        </View>
      ))}
      {save.error ? <FormAlert message={save.error} /> : null}
      <GymPrimaryButton label="Save" ready={changed} busy={save.busy} icon="check" onPress={() => changed && save.save((token) => gymApi.saveMemberNotices(token, notices.filter((n) => !on.has(n.kind)).map((n) => n.kind)))} />
    </View>
  );
}
