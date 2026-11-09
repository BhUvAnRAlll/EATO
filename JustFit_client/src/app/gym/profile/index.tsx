import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi, type GymProfile } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { publishStateText, SECTIONS, stampText } from "@/lib/gymProfile";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// ☰ › Gym Profile (Gym Profile Management phase 1, 2026-11-09; it grew from Settings › Public
// profile): what members see about this branch in the justFit app. The gym admin (or Staff given
// the Gym Profile options) edits a draft section by section, previews it and publishes it; members
// only ever see the last published version. The card on top says where the profile stands (Draft,
// Published, Changes not published) and when it was published and edited; the checklist says what
// Publish still needs. Plans and the team are managed on their own screens, linked from here.
export default function GymProfileHub() {
  const { result, retry, update, canEdit, canPublish } = useProfileDraft();
  return (
    <GymScreen title="Gym Profile">
      <ProfileLoad result={result} retry={retry}>
        {(profile) => <Hub profile={profile} canEdit={canEdit} canPublish={canPublish} onPublished={(next) => update(() => next)} />}
      </ProfileLoad>
    </GymScreen>
  );
}

function Hub({ profile, canEdit, canPublish, onPublished }: { profile: GymProfile; canEdit: boolean; canPublish: boolean; onPublished: (profile: GymProfile) => void }) {
  const colors = useThemeColors();
  const can = useCan();
  // The team is the gym admin's alone (Staff / Admin Login)
  const branches = useGymData(gymApi.branches);
  const owner = branches.result.state === "ready" && branches.result.data.access === "owner";
  const p = profile.publishing;
  const words = publishStateText(p.state);
  const tone = { draft: [colors.gymWarningSoft, colors.gymWarningInk], live: [colors.gymSuccessSoft, colors.gymSuccess], changed: [colors.gymPrimarySoft, colors.gymPrimaryText] }[words.tone];
  const { busy, error, save } = useGymSave(onPublished, "Published. Members see it now");

  const publish = async () => {
    const ok = await confirmChoice({ title: "Publish your gym profile?", message: "Members in the justFit app will see this version of your profile.", confirmLabel: "Publish" });
    if (ok) save((token) => gymApi.publishProfile(token));
  };

  const shown = SECTIONS.filter((s) => profile.show[s.id]).length;
  const custom = profile.custom.filter((c) => c.on).length;
  const contacts = [profile.contact.phone, profile.contact.whatsapp, profile.contact.email, profile.contact.website, profile.contact.instagram, profile.contact.facebook].filter(Boolean).length;
  const rows: { label: string; text: string; icon: GymIconName; href: Href; hidden?: boolean }[] = [
    { label: "Basic info and contact", text: profile.about ? `Description added · ${contacts} contact${contacts === 1 ? "" : "s"}` : "Add a description and how to reach you", icon: "store", href: "/gym/profile/basic" },
    { label: "Photos", text: profile.photos.length ? `${profile.photos.length} of ${profile.maxPhotos} · the first is the cover` : "Add photos of your gym", icon: "image", href: "/gym/profile/photos" },
    { label: "Facilities", text: profile.facilities.length + custom ? `${profile.facilities.length + custom} ticked` : "Tick what your gym has", icon: "dumbbell", href: "/gym/profile/facilities" },
    { label: "Opening hours and closures", text: profile.hours ? `Hours added${profile.closures.length ? ` · ${profile.closures.length} closure${profile.closures.length === 1 ? "" : "s"}` : ""}` : "Add when you're open", icon: "clock", href: "/gym/profile/hours" },
    { label: "What members see", text: shown === SECTIONS.length ? "Every section is on" : `${shown} of ${SECTIONS.length} sections on`, icon: "eye", href: "/gym/profile/visibility" },
    { label: "Trainers", text: "Profiles members see: photo, skills, experience", icon: "users", href: "/gym/profile/trainers" },
    { label: "Membership plans and PT", text: "Add, edit or delete plans and prices", icon: "clipboard-list", href: "/gym/catalog", hidden: !can("catalog.view") },
    { label: "Staff and trainers", text: "Add or remove staff and trainers", icon: "user-cog", href: "/gym/staff", hidden: !owner },
  ];

  return (
    <>
      <View className="gym-dash-card" style={{ padding: 16, gap: 10 }}>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="gym-page-section" numberOfLines={1} style={{ flexShrink: 1 }}>{`${profile.gym.name} · ${profile.gym.branch}`}</Text>
          <View className="gym-tag" style={{ backgroundColor: tone[0] }} accessibilityLabel={`Status: ${words.label}`}>
            <Text className="gym-tag__label" style={{ color: tone[1] }}>{words.label}</Text>
          </View>
        </View>
        <Text className="gym-tx__meta">{words.line}</Text>
        <View style={{ gap: 2 }}>
          <Text className="gym-tx__meta">{p.publishedAt ? `Published: ${stampText(p.publishedAt)}` : "Not published yet"}</Text>
          {p.editedAt ? <Text className="gym-tx__meta">{`Last edited: ${stampText(p.editedAt)}`}</Text> : null}
        </View>
      </View>

      {p.checklist.some((item) => !item.done) && (
        <>
          <Text className="gym-page-section" style={{ marginTop: 4 }}>Before you publish</Text>
          <View className="gym-dash-card" style={{ padding: 14, gap: 8 }}>
            {p.checklist.map((item) => (
              <View key={item.id} className="flex-row items-center" style={{ gap: 8 }} accessible accessibilityLabel={`${item.label}: ${item.done ? "done" : item.required ? "needed" : "optional"}`}>
                <GymIcon name={item.done ? "circle-check" : "circle-plus"} size={16} color={item.done ? colors.gymSuccess : item.required ? colors.gymWarningInk : colors.gymFaint} />
                <Text className="gym-tx__meta" style={{ color: item.done ? colors.gymMuted : colors.gymInk, flex: 1 }}>{item.label}</Text>
                {!item.required && !item.done ? <Text className="gym-tx__meta">Optional</Text> : null}
              </View>
            ))}
          </View>
        </>
      )}

      <Text className="gym-page-section" style={{ marginTop: 4 }}>Sections</Text>
      <View className="gym-dash-card">
        {rows.filter((r) => !r.hidden).map((row, index) => (
          <PressableScale key={row.label} onPress={() => router.push(row.href)} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${row.label}: ${row.text}`}>
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
      {!canEdit ? <Text className="gym-tx__meta">Your login can read the gym profile but not change it.</Text> : null}

      <PressableScale onPress={() => router.push("/gym/profile/preview")} className="gym-choice flex-row items-center justify-center" style={{ gap: 6, marginTop: 4 }} accessibilityRole="button" accessibilityLabel="Preview what members will see">
        <GymIcon name="eye" size={16} color={colors.gymPrimary} />
        <Text className="gym-choice__label">Preview what members will see</Text>
      </PressableScale>
      {error ? <FormAlert message={error} /> : null}
      {canPublish && (
        <>
          <GymPrimaryButton label={p.state === "published" ? "Published" : "Publish"} icon="send" ready={p.state !== "published" && !p.problem} busy={busy} onPress={publish} />
          {p.problem && p.state !== "published" ? <Text className="gym-tx__meta" style={{ textAlign: "center" }}>{p.problem}</Text> : null}
        </>
      )}
    </>
  );
}
