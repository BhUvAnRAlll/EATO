import type { ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { MyGymPlan } from "@/components/owner/MyGymPlan";
import { roleLabels } from "@/lib/gymRules";
import type { Gym, GymMember } from "@/lib/gyms";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type GymAboutTabProps = {
  gym: Gym;
  staff: GymMember[]; // owner, admins and trainers (empty when the viewer can't see members)
  onLeave: (() => void) | null;
};

// A gym's About tab: description, location with Map, opening hours, facilities, trainers and
// staff, membership plans (a label only: no payment exists), contact, guidelines, and Leave.
export function GymAboutTab({ gym, staff, onLeave }: GymAboutTabProps) {
  const contact: { label: string; url: string; icon: Icon }[] = [];
  if (gym.contact.phone) contact.push({ label: gym.contact.phone, url: `tel:${gym.contact.phone.replace(/\s/g, "")}`, icon: { ios: "phone", android: "call", web: "call" } });
  if (gym.contact.email) contact.push({ label: gym.contact.email, url: `mailto:${gym.contact.email}`, icon: { ios: "envelope", android: "mail", web: "mail" } });
  if (gym.contact.website) contact.push({ label: gym.contact.website, url: gym.contact.website, icon: { ios: "globe", android: "public", web: "public" } });
  const empty = !gym.description && !gym.location && !gym.address && gym.hours.length === 0 && gym.facilities.length === 0 && gym.membershipTiers.length === 0 && contact.length === 0 && gym.guidelines.length === 0 && staff.length === 0;
  const mapQuery = gym.address ?? gym.location;

  return (
    <View className="gap-5">
      {gym.membership?.status === "active" && gym.membership.role !== "owner" && <MyGymPlan gymId={gym.id} />}
      {empty && <EmptyState icon={{ ios: "info.circle", android: "info", web: "info" }} title="Nothing here yet" text="The gym hasn't added its details." />}
      {gym.description && (
        <Section title="About">
          <Text className="post__body">{gym.description}</Text>
        </Section>
      )}
      {(gym.location || gym.address) && (
        <Section title="Location">
          <View className="join-card flex-row items-start gap-3">
            <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={18} tintColor={colors.ink} />
            <View className="min-w-0 flex-1">
              {gym.location && <Text className="join-card__title">{gym.location}</Text>}
              {gym.address && <Text className="join-card__hint mt-0.5">{gym.address}</Text>}
            </View>
            {mapQuery && (
              <Pressable onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(mapQuery)}`)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`Open ${mapQuery} in maps`}>
                <Text className="gym-section__link">Map</Text>
              </Pressable>
            )}
          </View>
        </Section>
      )}
      {gym.hours.length > 0 && (
        <Section title="Opening hours">
          <View>
            {gym.hours.map((row, index) => (
              <View key={row.label} className={["about-row", index === 0 ? "friend-row--first" : "", index === gym.hours.length - 1 ? "friend-row--last" : ""].join(" ")}>
                <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={16} tintColor={colors.muted} />
                <Text className="post__body flex-1">{row.label}</Text>
                <Text className="about-row__value">{row.value}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}
      {gym.facilities.length > 0 && (
        <Section title="Facilities">
          <View className="flex-row flex-wrap gap-2">
            {gym.facilities.map((item) => (
              <View key={item} className="friend-chip">
                <Text className="friend-chip__label">{item}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}
      {staff.length > 0 && (
        <Section title={`Trainers & staff (${staff.length})`}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -20 }}>
            <View className="w-2.5" />
            {staff.map((row) => (
              <Pressable key={row.member.id} onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: row.member.id } })} className="staff-card" accessibilityRole="button" accessibilityLabel={`${row.member.name}, ${roleLabels[row.role]}`}>
                <Avatar member={row.member} size={56} />
                <Text className="join-card__title mt-2 text-center" numberOfLines={1}>{row.member.name}</Text>
                <Text className="join-card__hint text-center" numberOfLines={1}>{row.title ?? roleLabels[row.role]}</Text>
                <View className={row.role === "owner" ? "gym-badge gym-badge--staff mt-2" : "gym-badge gym-badge--member mt-2"} style={{ height: 22 }}>
                  <Text className={row.role === "owner" ? "gym-badge__label gym-badge__label--staff" : "gym-badge__label"} style={{ fontSize: 12 }}>{roleLabels[row.role]}</Text>
                </View>
              </Pressable>
            ))}
            <View className="w-2.5" />
          </ScrollView>
        </Section>
      )}
      {gym.membershipTiers.length > 0 && (
        <Section title="Membership">
          <View className="gap-2">
            {gym.membershipTiers.map((tier) => (
              <View key={tier.name} className="join-card">
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="join-card__title flex-1">{tier.name}</Text>
                  <Text className="join-card__title">{tier.price}</Text>
                </View>
                {tier.perks ? <Text className="join-card__hint mt-0.5">{tier.perks}</Text> : null}
              </View>
            ))}
            <Text className="home__note">Plans are set by the gym. Ask the gym to join a plan; payments aren&apos;t made in EATO.</Text>
          </View>
        </Section>
      )}
      {contact.length > 0 && (
        <Section title="Contact">
          <View className="join-card gap-2">
            {contact.map((item) => (
              <Pressable key={item.url} onPress={() => Linking.openURL(item.url)} className="flex-row items-center gap-2 py-0.5" accessibilityRole="link" accessibilityLabel={item.label}>
                <SymbolView name={item.icon} size={15} tintColor={colors.leaf} />
                <Text className="post__body" style={{ color: colors.leaf }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      )}
      {gym.guidelines.length > 0 && (
        <Section title="Guidelines">
          <View className="join-card gap-1">
            {gym.guidelines.map((rule, index) => <Text key={index} className="post__body">{`${index + 1}. ${rule}`}</Text>)}
          </View>
        </Section>
      )}
      {onLeave && (
        <Pressable onPress={onLeave} className="btn-outline" accessibilityRole="button" accessibilityLabel={`Leave ${gym.name}`}>
          <Text className="btn-outline__label" style={{ color: colors.danger }}>Leave gym</Text>
        </Pressable>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="gym-about__title">{title}</Text>
      {children}
    </View>
  );
}
