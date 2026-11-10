import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SkeletonCard } from "@/components/Skeleton";
import { adminPortal } from "@/lib/adminPortal";
import { memberSections, timeText, type MemberProfile } from "@/lib/memberProfileText";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const ACTIVITY_SHOWN = 15;

// Super Admin › a member's page (2026-11-10, the user's request): every field the member has
// filled in, their body scans (each opens its photos and report) and their recent activity.
// Read again whenever the page shows. The server logs an admin's first look in an hour.
export function MemberProfileCard({ userId }: { userId: string }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allActivity, setAllActivity] = useState(false);

  const load = useCallback(async () => {
    const result = await adminPortal.memberProfile(await getToken().catch(() => null), userId);
    if (result.ok) {
      setMember(result.data.member);
      setError(null);
    } else setError(result.error);
  }, [getToken, userId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!member) {
    return error ? (
      <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the profile" text={`${error.replace(/\.$/, "")}. Tap to try again.`} onPress={load} />
    ) : (
      <SkeletonCard />
    );
  }

  const activity = allActivity ? member.activity : member.activity.slice(0, ACTIVITY_SHOWN);

  return (
    <View className="gap-3.5">
      {memberSections(member).map((section) => (
        <View key={section.title} className="gap-2">
          <Text className="setup__section">{section.title}</Text>
          <View className="card py-1">
            {section.rows.map((row, index) => (
              <View key={row.label} className="list-row items-start" style={index === section.rows.length - 1 ? { borderBottomWidth: 0 } : undefined}>
                <Text className="type-body text-muted" style={{ width: 132 }}>{row.label}</Text>
                <Text className="type-body flex-1 text-forest-ink" selectable>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      <View className="gap-2">
        <Text className="setup__section">Body scans</Text>
        <View className="card py-1">
          {member.scans === null ? (
            <Text className="type-body py-3 text-muted">Body scans need the database update migrations/2027-01-25-body-scans.sql.</Text>
          ) : member.scans.length === 0 ? (
            <Text className="type-body py-3 text-muted">No scans yet.</Text>
          ) : (
            member.scans.map((scan, index, list) => (
              <Pressable
                key={scan.id}
                onPress={() => router.push({ pathname: "/admin/body-scans/[id]", params: { id: scan.id } })}
                className="list-row"
                style={index === list.length - 1 ? { borderBottomWidth: 0 } : undefined}
                accessibilityRole="button"
                accessibilityLabel={`Body scan, ${scan.bodyFatPercent}% body fat, ${timeText(scan.at)}`}
              >
                <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={18} tintColor={colors.forestInk} />
                <View className="flex-1">
                  <Text className="list-row__label">{`${scan.bodyFatPercent}% body fat`}</Text>
                  <Text className="type-caption text-muted">{timeText(scan.at)}</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))
          )}
        </View>
      </View>

      <View className="gap-2">
        <Text className="setup__section">Recent activity</Text>
        <View className="card py-1">
          {activity.length === 0 ? (
            <Text className="type-body py-3 text-muted">Nothing yet.</Text>
          ) : (
            activity.map((item, index) => (
              <View key={`${item.kind}-${item.at}-${index}`} className="list-row items-start" style={index === activity.length - 1 ? { borderBottomWidth: 0 } : undefined}>
                <View className="flex-1" style={{ gap: 2 }}>
                  <Text className="type-body text-forest-ink">{item.title}</Text>
                  <Text className="type-caption text-muted">{item.detail ? `${timeText(item.at)} · ${item.detail}` : timeText(item.at)}</Text>
                </View>
              </View>
            ))
          )}
        </View>
        {member.activity.length > ACTIVITY_SHOWN && (
          <Pressable onPress={() => setAllActivity((v) => !v)} className="btn-outline" accessibilityRole="button">
            <Text className="btn-outline__label">{allActivity ? "Show less" : `Show all ${member.activity.length}`}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
