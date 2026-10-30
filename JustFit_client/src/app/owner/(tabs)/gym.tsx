import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { useOwnerStore } from "@/store/owner";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Link = { label: string; note: string; icon: Icon; to: Href };

// Gym: every gym-level screen. Most are the member app's Manage gym screens, which the gym's
// own owner and admins open (the server checks their role on every change).
export default function OwnerGym() {
  const summary = useOwnerStore((state) => state.summary);
  const gymId = useOwnerStore((state) => state.gymId) ?? "";
  const platform = summary?.gym.as === "platform";

  const params = { id: gymId };
  const links: Link[] = [
    { label: "Gym profile", note: "Name, photos, hours, contact and more", icon: { ios: "pencil", android: "edit", web: "edit" }, to: { pathname: "/community/gyms/[id]/manage/profile", params } },
    { label: "Subscription", note: "Your justFit plan (no payment is taken)", icon: { ios: "creditcard", android: "credit_card", web: "credit_card" }, to: { pathname: "/community/gyms/[id]/manage/plan", params } },
    { label: "Members", note: "Requests, roles and removals", icon: { ios: "person.2", android: "group", web: "group" }, to: "/owner/members" },
    { label: "Renewals", note: "Packages ending soon", icon: { ios: "calendar.badge.clock", android: "event_repeat", web: "event_repeat" }, to: "/owner/renewals" },
    { label: "Invite & invitations", note: "Link, QR code, and who you've invited", icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" }, to: { pathname: "/community/gyms/[id]/invite", params: { id: gymId } } },
    { label: "Gym assistant", note: "Questions for the team and custom answers", icon: { ios: "bubble.left.and.text.bubble.right", android: "smart_toy", web: "smart_toy" }, to: "/owner/assistant" },
    { label: "Check-out QR", note: "The code members scan on the way out", icon: { ios: "qrcode", android: "qr_code_2", web: "qr_code_2" }, to: "/owner/checkout-qr" },
    { label: "Notify members", note: "Send an update to everyone or a group", icon: { ios: "bell", android: "notifications", web: "notifications" }, to: "/owner/notify" },
    { label: "Events", note: "Upcoming and past events", icon: { ios: "calendar", android: "event", web: "event" }, to: "/owner/events" },
    { label: "Announcements", note: "Pinned news at the top of the gym feed", icon: { ios: "megaphone", android: "campaign", web: "campaign" }, to: { pathname: "/community/gyms/[id]/manage/announcements", params } },
    { label: "Community settings", note: "Who can post, comment and create events", icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" }, to: { pathname: "/community/gyms/[id]/manage/settings", params } },
    { label: "Gym page", note: "What members see", icon: { ios: "building.2", android: "apartment", web: "apartment" }, to: { pathname: "/community/gyms/[id]", params: { id: gymId } } },
  ];
  // An justFit admin helping out reaches the portal's own screens; the member app's are the gym's
  const shown = platform ? links.filter((link) => typeof link.to === "string" || String((link.to as { pathname: string }).pathname).startsWith("/owner")) : links;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <OwnerHeader title="Gym" subtitle="Your gym's profile, plan, team and community settings." />
        <View className="mx-5 mt-4">
          {shown.map((link, index) => (
            <Pressable
              key={link.label}
              onPress={() => router.push(link.to)}
              className={`friend-row ${index === 0 ? "friend-row--first" : ""} ${index === shown.length - 1 ? "friend-row--last" : ""}`}
              accessibilityRole="button"
              accessibilityLabel={link.label}
            >
              <View className="owner-icon owner-icon--neutral">
                <SymbolView name={link.icon} size={18} tintColor={colors.ink} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name">{link.label}</Text>
                <Text className="friend-row__note" numberOfLines={1}>{link.note}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
          ))}
        </View>
        {platform && (
          <Text className="friend-row__note mx-5 mt-3">The gym&apos;s profile, settings, invitations and announcements are managed by its owner and admins.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
