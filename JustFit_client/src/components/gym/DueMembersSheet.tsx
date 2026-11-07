import { useCallback, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { SendReminderSheet } from "@/components/gym/SendReminderSheet";
import { initialsOf, payChipText, rupees } from "@/data/gymDashboard";
import { daysLeftText } from "@/lib/gymContact";
import {
  gymApi,
  type DueMember,
  type GymInfo,
  type PayLevel,
} from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Home › Due Members (the user's design): everyone who owes money, each with their ID (PT when on
// personal training), days left on their plan and what they owe; the bell opens Send Reminder
// (WhatsApp, SMS; notifications coming soon) on the due template, ⋯ (or the card) their options. Since prediction #2 each row carries how likely they are
// to pay late ("Likely late · 60" and why, from the server's rules), likeliest first.
export function DueMembersSheet({
  gym,
  onClose,
  onChanged,
}: {
  gym: GymInfo;
  onClose: () => void;
  onChanged: () => void;
}) {
  const colors = useThemeColors();
  const load = useCallback(
    (token: string | null) => gymApi.paymentRisks(token, ""),
    [],
  );
  const { result, retry, reload } = useGymData(load);
  const [open, setOpen] = useState<DueMember | null>(null);
  const [reminding, setReminding] = useState<DueMember | null>(null);
  const payTone = (level: PayLevel) =>
    level === "late"
      ? { bg: colors.gymDangerSoft, ink: colors.gymDanger }
      : level === "watch"
        ? { bg: colors.gymWarningSoft, ink: colors.gymWarning }
        : level === "on_time"
          ? { bg: colors.gymSuccessSoft, ink: colors.gymSuccess }
          : { bg: colors.gymBar, ink: colors.gymMuted };
  // Narrow phones: smaller round buttons, so the name and ID keep their room
  const narrow = useWindowDimensions().width < 360;
  const btn = narrow
    ? { width: 30, height: 30, borderRadius: 9 }
    : { width: 36, height: 36 };

  return (
    <GymSheet
      onClose={onClose}
      stack={
        <>
          {reminding && (
            <SendReminderSheet
              kind="due"
              member={reminding}
              gym={gym}
              onClose={() => setReminding(null)}
              onSent={reload}
            />
          )}
          {open && (
            <MemberActionsSheet
              member={open}
              gym={gym}
              onClose={() => setOpen(null)}
              onLeave={onClose}
              onChanged={(detail) => {
                // The score is the list's: it refreshes with reload() below
                setOpen(
                  detail.member.due > 0 && open
                    ? { ...detail.member, payment: open.payment }
                    : null,
                );
                reload();
                onChanged();
              }}
            />
          )}
        </>
      }
    >
      <Text
        className="gym-sheet__title text-center"
        style={{ fontSize: 20 }}
        accessibilityRole="header"
      >
        Payment Due Members
      </Text>
      {result.state === "loading" && <GymLoading label="Loading due members" />}
      {result.state === "failed" && (
        <GymError error={result.error} onRetry={retry} />
      )}
      {result.state === "ready" &&
        (result.data.members.length === 0 ? (
          <GymEmpty
            icon="badge-check"
            title="No dues"
            text="Members with a payment due show here."
          />
        ) : (
          result.data.members.map((m) => {
            const pay = {
              ...payTone(m.payment.level),
              text: payChipText(m.payment.level, m.payment.score),
              reasons: m.payment.reasons.map((r) => r.text).join(" · "),
            };
            return (
              <PressableScale
                key={m.id}
                onPress={() => setOpen(m)}
                className="gym-card flex-row items-center"
                style={{ gap: narrow ? 6 : 12, padding: narrow ? 10 : 14 }}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, ${m.code}${m.pt?.active ? ", on PT" : ""}, ${daysLeftText(m.daysLeft)}, ${rupees(m.due)} payment due${m.overdue ? ", overdue" : ""}, ${pay.text}`}
              >
                {!narrow && (
                  <View className="gym-due-avatar">
                    <Text
                      className="gym-member-photo__initials"
                      style={{ fontSize: 18 }}
                    >
                      {initialsOf(m.name)}
                    </Text>
                    <MemberPhotoImage url={m.photoUrl} />
                  </View>
                )}
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <Text className="gym-tx__name" numberOfLines={1}>
                    {m.name}
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <GymIcon name="id-card" size={13} color={colors.gymMuted} />
                    <Text className="gym-tx__meta" numberOfLines={1}>
                      {m.code}
                    </Text>
                    {m.pt?.active && (
                      <View
                        className="gym-chip"
                        style={{
                          borderColor: colors.gymSuccessLine,
                          backgroundColor: colors.gymSuccessSoft,
                        }}
                      >
                        <Text
                          className="gym-chip__label"
                          style={{ color: colors.gymSuccess }}
                        >
                          PT
                        </Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <View
                      className="gym-chip"
                      style={{ borderColor: pay.bg, backgroundColor: pay.bg }}
                    >
                      <Text
                        className="gym-chip__label"
                        style={{ color: pay.ink }}
                      >
                        {pay.text}
                      </Text>
                    </View>
                  </View>
                  {pay.reasons ? (
                    <Text className="gym-tx__meta" numberOfLines={2}>
                      {pay.reasons}
                    </Text>
                  ) : null}
                  <Text
                    className="gym-tx__meta"
                    numberOfLines={1}
                    style={
                      m.daysLeft < 0 ? { color: colors.gymDanger } : undefined
                    }
                  >
                    {daysLeftText(m.daysLeft)}
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <GymIcon
                      name="banknote"
                      size={14}
                      color={colors.gymPrimary}
                    />
                    <Text
                      className="gym-tx__meta"
                      numberOfLines={2} // "₹2,500 payment due · overdue" wraps beside the avatar and buttons
                      style={{
                        flexShrink: 1,
                        color: m.overdue ? colors.gymDanger : colors.gymInkSoft,
                      }}
                    >{`${rupees(m.due)} ${narrow ? "due" : "payment due"}${m.overdue ? " · overdue" : ""}`}</Text>
                  </View>
                </View>
                {m.birthdayToday && (
                  <GymIcon name="cake" size={18} color={colors.gymInkSoft} />
                )}
                <PressableScale
                  onPress={() => setReminding(m)}
                  hitSlop={6}
                  className="gym-icon-btn"
                  style={btn}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${m.name} a due reminder`}
                >
                  <GymIcon
                    name="bell-ring"
                    size={16}
                    color={colors.gymInkSoft}
                  />
                </PressableScale>
                <PressableScale
                  onPress={() => setOpen(m)}
                  hitSlop={6}
                  className="gym-icon-btn"
                  style={btn}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}: options`}
                >
                  <GymIcon
                    name="ellipsis"
                    size={16}
                    color={colors.gymInkSoft}
                  />
                </PressableScale>
              </PressableScale>
            );
          })
        ))}
    </GymSheet>
  );
}
