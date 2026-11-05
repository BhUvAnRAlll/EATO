import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { initialsOf } from "@/data/gymDashboard";
import { STATUS_TEXT, clockTime, dayOf, durationText } from "@/lib/attendanceText";
import type { GymVisit } from "@/lib/gymApi";
import { useThemeColors } from "@/theme";

// One visit: the member's photo (or initials), name and ID, check-in → check-out, how long, its
// status, and whether a QR scan or staff checked them in. With onCheckOut (members inside now),
// a Check out button for the front desk.
export function VisitRow({ visit, showDate = false, onPress, onCheckOut, busy = false }: { visit: GymVisit; showDate?: boolean; onPress?: () => void; onCheckOut?: () => void; busy?: boolean }) {
  const colors = useThemeColors();
  const tone = visit.status === "inside" ? { text: colors.gymSuccess, bg: colors.gymSuccessSoft } : visit.status === "completed" ? { text: colors.gymPrimary, bg: colors.gymPrimarySoft } : { text: colors.gymWarning, bg: colors.gymWarningSoft };
  const times = `${showDate ? `${dayOf(visit.checkedInAt)} · ` : ""}${clockTime(visit.checkedInAt)} → ${visit.checkedOutAt ? clockTime(visit.checkedOutAt) : visit.status === "inside" ? "now" : "—"}`;
  const length = visit.status === "no_checkout" ? "No check-out" : `${durationText(visit.durationMin)}${visit.status === "inside" ? " so far" : ""}`;
  const label = `${visit.memberName}, ${visit.memberCode}. ${STATUS_TEXT[visit.status]}. ${times}. ${length}. ${visit.inSource === "qr" ? "QR scan" : "By staff"}`;

  return (
    // The row and its Check out button are siblings: a button inside a button isn't allowed on the web
    <View className="gym-card flex-row items-center" style={{ gap: 12, padding: 12 }}>
      <Pressable onPress={onPress} disabled={!onPress} className="flex-1 flex-row items-center" style={{ gap: 12 }} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label}>
        <View className="gym-avatar">
          <Text className="gym-avatar__label">{initialsOf(visit.memberName)}</Text>
          <MemberPhotoImage url={visit.photoUrl} />
        </View>
        <View className="flex-1" style={{ gap: 2 }}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="gym-tx__name flex-shrink" numberOfLines={1}>{visit.memberName}</Text>
            <View className="gym-tag" style={{ backgroundColor: tone.bg }}>
              <Text className="gym-tag__label" style={{ color: tone.text }}>{STATUS_TEXT[visit.status]}</Text>
            </View>
          </View>
          <Text className="gym-tx__meta" numberOfLines={1}>{`${visit.memberCode} · ${visit.inSource === "qr" ? "QR scan" : "By staff"}`}</Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <GymIcon name="clock" size={13} color={colors.gymMuted} />
            <Text className="gym-tx__meta flex-shrink" numberOfLines={1}>{`${times} · ${length}`}</Text>
          </View>
        </View>
      </Pressable>
      {onCheckOut ? (
        <PressableScale onPress={onCheckOut} disabled={busy} haptic="tap" className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`Check out ${visit.memberName}`} accessibilityState={{ busy }}>
          {busy ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <GymIcon name="log-out" size={14} color={colors.gymPrimary} />}
          <Text className="gym-choice__label">Check out</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
