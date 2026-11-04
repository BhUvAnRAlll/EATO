import { useCallback, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { initialsOf, rupees } from "@/data/gymDashboard";
import { daysLeftText, dueReminder, sms, whatsapp } from "@/lib/gymContact";
import { gymApi, type GymInfo, type GymMember } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Home › Due Members (the user's design): everyone who owes money, each with their ID (PT when on
// personal training), days left on their plan and what they owe; a WhatsApp due reminder, an SMS,
// and ⋯ (or the card) for their options
export function DueMembersSheet({ gym, onClose, onChanged }: { gym: GymInfo; onClose: () => void; onChanged: () => void }) {
  const colors = useThemeColors();
  const load = useCallback((token: string | null) => gymApi.members(token, "due", ""), []);
  const { result, retry, reload } = useGymData(load);
  const [open, setOpen] = useState<GymMember | null>(null);
  // Narrow phones: smaller round buttons, so the name and ID keep their room
  const narrow = useWindowDimensions().width < 360;
  const btn = narrow ? { width: 30, height: 30, borderRadius: 9 } : { width: 36, height: 36 };

  return (
    <>
      <GymSheet onClose={onClose}>
        <Text className="gym-sheet__title text-center" style={{ fontSize: 20 }} accessibilityRole="header">Payment Due Members</Text>
        {result.state === "loading" && <GymLoading label="Loading members who owe" />}
        {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
        {result.state === "ready" &&
          (result.data.members.length === 0 ? (
            <GymEmpty icon="badge-check" title="Nobody owes anything" text="Members with a payment due show here." />
          ) : (
            result.data.members.map((m) => (
              <PressableScale key={m.id} onPress={() => setOpen(m)} className="gym-card flex-row items-center" style={{ gap: narrow ? 6 : 12, padding: narrow ? 10 : 14 }} accessibilityRole="button" accessibilityLabel={`${m.name}, ${m.code}${m.pt?.active ? ", on PT" : ""}, ${daysLeftText(m.daysLeft)}, ${rupees(m.due)} payment due${m.overdue ? ", overdue" : ""}`}>
                {!narrow && <View className="gym-due-avatar"><Text className="gym-member-photo__initials" style={{ fontSize: 18 }}>{initialsOf(m.name)}</Text></View>}
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>{m.name}</Text>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <GymIcon name="id-card" size={13} color={colors.gymMuted} />
                    <Text className="gym-tx__meta" numberOfLines={1}>{m.code}</Text>
                    {m.pt?.active && <View className="gym-chip" style={{ borderColor: colors.gymSuccessLine, backgroundColor: colors.gymSuccessSoft }}><Text className="gym-chip__label" style={{ color: colors.gymSuccess }}>PT</Text></View>}
                  </View>
                  <Text className="gym-tx__meta" numberOfLines={1} style={m.daysLeft < 0 ? { color: colors.gymDanger } : undefined}>{daysLeftText(m.daysLeft)}</Text>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <GymIcon name="banknote" size={14} color={colors.gymPrimary} />
                    <Text className="gym-tx__meta" numberOfLines={1} style={{ flexShrink: 1, color: m.overdue ? colors.gymDanger : colors.gymInkSoft }}>{`${rupees(m.due)} ${narrow ? "due" : "payment due"}${m.overdue ? " · overdue" : ""}`}</Text>
                  </View>
                </View>
                {m.birthdayToday && <GymIcon name="cake" size={18} color={colors.gymInkSoft} />}
                <PressableScale onPress={() => whatsapp(m, dueReminder(m, gym))} hitSlop={6} className="gym-icon-btn" style={btn} accessibilityRole="button" accessibilityLabel={`Send ${m.name} a due reminder on WhatsApp`}>
                  <GymIcon name="bell-ring" size={16} color={colors.gymInkSoft} />
                </PressableScale>
                <PressableScale onPress={() => sms(m, dueReminder(m, gym))} hitSlop={6} className="gym-icon-btn" style={btn} accessibilityRole="button" accessibilityLabel={`Text ${m.name} a due reminder`}>
                  <GymIcon name="message-square" size={16} color={colors.gymInkSoft} />
                </PressableScale>
                <PressableScale onPress={() => setOpen(m)} hitSlop={6} className="gym-icon-btn" style={btn} accessibilityRole="button" accessibilityLabel={`${m.name}: options`}>
                  <GymIcon name="ellipsis" size={16} color={colors.gymInkSoft} />
                </PressableScale>
              </PressableScale>
            ))
          ))}
      </GymSheet>
      {open && (
        <MemberActionsSheet
          member={open}
          gym={gym}
          onClose={() => setOpen(null)}
          onChanged={(detail) => {
            setOpen(detail.member.due > 0 ? detail.member : null);
            reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}
