import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type AdminLinkRowProps = {
  icon: Icon;
  label: string;
  line?: string;
  // A count on the right (Needs attention); "warning" tints it when something is waiting
  badge?: number | string | null;
  tone?: "plain" | "warning" | "danger";
  divided?: boolean;
  onPress: () => void;
};

// One row of an admin-list card: the icon square, a title with a line under it, a count, the chevron.
// The Overview's Needs attention, the More tab and Profile all use it, so every list looks the same.
export function AdminLinkRow({ icon, label, line, badge, tone = "plain", divided = false, onPress }: AdminLinkRowProps) {
  const colors = useThemeColors();
  const tint = tone === "danger" ? colors.danger : tone === "warning" ? colors.warning : colors.forestInk;
  const showBadge = badge !== undefined && badge !== null;
  return (
    <Pressable
      onPress={onPress}
      className={divided ? "admin-row admin-row--divided" : "admin-row"}
      accessibilityRole="button"
      accessibilityLabel={[label, showBadge ? String(badge) : null, line].filter(Boolean).join(". ")}
    >
      <View className={tone === "danger" ? "admin-row__icon admin-row__icon--danger" : tone === "warning" ? "admin-row__icon admin-row__icon--warning" : "admin-row__icon"}>
        <SymbolView name={icon} size={18} tintColor={tint} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="card__title" numberOfLines={1}>{label}</Text>
        {line ? <Text className="meta-text" numberOfLines={2}>{line}</Text> : null}
      </View>
      {showBadge ? <Text className={tone === "plain" ? "admin-count" : "admin-count admin-count--alert"}>{badge}</Text> : null}
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
    </Pressable>
  );
}
