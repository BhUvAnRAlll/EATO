import { useState } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { BulkSmsSheet } from "@/components/gym/BulkSmsSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import type { GymIconName } from "@/constants/gymIcons";
import { phoneText } from "@/data/gymDashboard";
import { gymApi, type StaffOption } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// area: the Role & Permission area the row needs; ownerOnly: the gym admin only. Either way the
// screen it opens checks again, and the server refuses regardless: this only keeps the list tidy.
type SettingRow = { label: string; text: string; icon: GymIconName; href?: Href; action?: "sms"; ownerOnly?: boolean; need?: StaffOption };
type SettingGroup = { title: string; rows: SettingRow[] };

const GROUPS: SettingGroup[] = [
  {
    title: "Branch",
    rows: [
      { label: "Branch details", text: "Name, area and city", icon: "store", href: "/gym/details", ownerOnly: true },
      { label: "Invoice details & logo", text: "Address, phone, GSTIN and your logo", icon: "file-text", href: "/gym/details", ownerOnly: true },
      { label: "Gym Profile", text: "What members see: photos, facilities, hours, publish", icon: "store", href: "/gym/profile", need: "profile.view" },
      { label: "Outlets", text: "Switch branch or add one", icon: "map-pin", href: "/gym/branches" },
    ],
  },
  {
    title: "Attendance",
    rows: [
      { label: "Location & Attendance", text: "Gym location and check-in radius", icon: "locate-fixed", href: "/gym/attendance/settings", need: "attendance.settings" },
      { label: "Attendance QR code", text: "Show, print or regenerate", icon: "qr-code", href: "/gym/attendance/qr", need: "attendance.settings" },
    ],
  },
  {
    title: "Messages",
    rows: [
      { label: "SMS & auto reminders", text: "Credits, reminders and message logs", icon: "message-square-more", action: "sms", need: "sms.view" },
      { label: "Reminder Templates", text: "The wording of your reminders", icon: "message-square-text", href: "/gym/templates", need: "templates.view" },
    ],
  },
  {
    title: "Team",
    rows: [
      { label: "Staff / Admin Login", text: "Who can sign in to your gym", icon: "user-cog", href: "/gym/staff", ownerOnly: true },
      { label: "Role & Permission", text: "What each Staff login can open", icon: "shield-check", href: "/gym/permissions", ownerOnly: true },
      { label: "Activity", text: "Who added, edited or deleted what", icon: "history", href: "/gym/activity", ownerOnly: true },
    ],
  },
];

// ☰ › Settings (2026-11-08, the user's request): one place for the portal's settings, which
// otherwise sit on their own screens. Each row opens the screen that already does the job (SMS
// & auto reminders opens the Bulk SMS sheet here); rows a login can't use are left out, and a
// group with nothing left is hidden. Under them, the account signed in and Sign out.
export default function GymSettings() {
  const colors = useThemeColors();
  const can = useCan();
  const user = useAuthStore((state) => state.user);
  const { result, retry } = useGymData(gymApi.branches);
  const [smsOpen, setSmsOpen] = useState(false);

  const open = (row: SettingRow) => (row.action === "sms" ? setSmsOpen(true) : row.href && router.push(row.href));

  return (
    <GymScreen title="Settings">
      {result.state === "loading" && <GymLoading label="Loading your settings" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          {GROUPS.map((group) => {
            const rows = group.rows.filter((row) => (!row.ownerOnly || result.data.access === "owner") && (!row.need || can(row.need)));
            if (rows.length === 0) return null;
            return (
              <View key={group.title} className="gym-dash-section">
                <Text className="gym-dash-section__title">{group.title}</Text>
                <View className="gym-dash-card">
                  {rows.map((row, index) => (
                    <PressableScale key={row.label} onPress={() => open(row)} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${row.label}, ${row.text}`}>
                      <View className="gym-dash-row__icon bg-gym-primary-soft">
                        <GymIcon name={row.icon} size={18} color={colors.gymPrimary} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="gym-dash-row__title" numberOfLines={1}>{row.label}</Text>
                        <Text className="gym-dash-row__text" numberOfLines={2}>{row.text}</Text>
                      </View>
                      <GymIcon name="chevron-right" size={14} color={colors.gymFaint} />
                    </PressableScale>
                  ))}
                </View>
              </View>
            );
          })}

          <View className="gym-dash-section">
            <Text className="gym-dash-section__title">Account</Text>
            <View className="gym-summary">
              <GradientFill radius={14} />
              <Text className="gym-tx__name" style={{ color: colors.white }} numberOfLines={1}>{user?.fullName?.trim() || "Admin"}</Text>
              {user?.phone ? <Text className="gym-tx__meta" style={{ color: colors.white, opacity: 0.85 }}>{phoneText(user.phone)}</Text> : null}
              <Text className="gym-tx__meta" style={{ color: colors.white, opacity: 0.85 }} numberOfLines={1}>
                {`${result.data.gym} · ${result.data.access === "owner" ? "Gym admin" : "Staff"}`}
              </Text>
            </View>
            <View className="gym-dash-card">
              <PressableScale onPress={() => useAuthStore.getState().signOut()} className="gym-dash-row" accessibilityRole="button" accessibilityLabel="Sign out">
                <View className="gym-dash-row__icon bg-gym-primary-soft">
                  <GymIcon name="log-out" size={18} color={colors.danger} />
                </View>
                <Text className="gym-dash-row__title flex-1" style={{ color: colors.danger }}>Sign out</Text>
              </PressableScale>
            </View>
          </View>
        </>
      )}
      {smsOpen && <BulkSmsSheet onClose={() => setSmsOpen(false)} />}
    </GymScreen>
  );
}
