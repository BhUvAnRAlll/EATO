import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { STAFF_AREAS } from "@/data/gymDashboard";
import { gymApi, type GymTeam, type StaffArea, type TeamMember } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

// Role & Permission › a Staff login: one switch per portal area, saved together. Everything off
// leaves them Home only. The server applies the change on their very next request.
export function PermissionsSheet({ member, branchLine, onClose, onSaved }: { member: TeamMember; branchLine: string; onClose: () => void; onSaved: (team: GymTeam) => void }) {
  const colors = useThemeColors();
  const [areas, setAreas] = useState<StaffArea[]>(member.areas);
  const { busy, error, save } = useGymSave<GymTeam>(onSaved);
  const changed = areas.join() !== member.areas.join();
  const toggle = (area: StaffArea, on: boolean) => setAreas((current) => (on ? STAFF_AREAS.map((a) => a.id).filter((id) => id === area || current.includes(id)) : current.filter((id) => id !== area)));
  const name = member.name ?? "This Staff login";

  return (
    <GymSheet title={name} subtitle={`Staff · ${branchLine}`} onClose={onClose}>
      <Text className="gym-tx__meta">What they can open in the gym portal. Home always stays.</Text>
      <View className="gym-card" style={{ paddingVertical: 2 }}>
        {STAFF_AREAS.map((a, i) => {
          const on = areas.includes(a.id);
          return (
            <View key={a.id} className="gym-reminder" style={i > 0 ? { borderTopWidth: 1, borderColor: colors.gymLine } : undefined}>
              <View className="gym-reminder__icon" style={{ backgroundColor: on ? colors.gymPrimarySoft : colors.gymPage }}>
                <GymIcon name={a.icon} size={20} color={on ? colors.gymPrimary : colors.gymFaint} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="gym-reminder__title" numberOfLines={1}>{a.label}</Text>
                <Text className="gym-reminder__when" numberOfLines={2}>{a.line}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={(next) => toggle(a.id, next)}
                disabled={busy}
                trackColor={{ false: colors.gymLine, true: colors.gymPrimary }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.gymLine}
                accessibilityLabel={`${a.label} for ${name}`}
              />
            </View>
          );
        })}
      </View>
      {areas.length === 0 ? (
        <View className="gym-note">
          <GymIcon name="info" size={18} color={colors.gymPrimary} />
          <Text className="gym-note__text">{"With everything off they can only see Home: the day's numbers, nothing to open."}</Text>
        </View>
      ) : null}
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save" ready={changed} busy={busy} onPress={() => save((token) => gymApi.setPermissions(token, member.id, areas))} />
    </GymSheet>
  );
}
