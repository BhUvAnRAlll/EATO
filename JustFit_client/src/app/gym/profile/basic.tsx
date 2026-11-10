import { useState } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { DraftNote, ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import { SaveButton } from "@/components/gym/SaveButton";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi, type GymProfile, type GymProfileFields } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { ABOUT_MAX, GYM_TYPES, GYM_TYPES_MAX, type GymType } from "@/lib/gymProfile";
import { useThemeColors } from "@/theme";

type Contact = "whatsapp" | "email" | "website" | "instagram" | "facebook";
const FIELDS: { key: Contact; label: string; icon: GymIconName; placeholder: string; keyboard: "phone-pad" | "email-address" | "url" }[] = [
  { key: "whatsapp", label: "WhatsApp number", icon: "message-circle", placeholder: "10-digit mobile number", keyboard: "phone-pad" },
  { key: "email", label: "Email", icon: "mail", placeholder: "Eg. desk@yourgym.in", keyboard: "email-address" },
  { key: "website", label: "Website", icon: "globe", placeholder: "Eg. yourgym.in", keyboard: "url" },
  { key: "instagram", label: "Instagram", icon: "camera", placeholder: "Eg. instagram.com/yourgym", keyboard: "url" },
  { key: "facebook", label: "Facebook", icon: "users", placeholder: "Eg. facebook.com/yourgym", keyboard: "url" },
];

// Gym Profile › Basic info and contact (2026-11-09): the description and the ways members can reach
// the branch, saved to the draft. The name, address and phone come from Branch details and Invoice
// details (they also print on invoices), so they are shown here with a link to change them there.
export default function GymProfileBasic() {
  const { result, retry, canEdit } = useProfileDraft();
  return (
    <GymScreen title="Basic info and contact">
      <ProfileLoad result={result} retry={retry}>{(profile) => <BasicForm saved={profile} canEdit={canEdit} />}</ProfileLoad>
    </GymScreen>
  );
}

function BasicForm({ saved, canEdit }: { saved: GymProfile; canEdit: boolean }) {
  const colors = useThemeColors();
  const [current, setCurrent] = useState(saved);
  const [about, setAbout] = useState(saved.about ?? "");
  const [types, setTypes] = useState<GymType[]>(saved.types ?? []);
  const [fields, setFields] = useState<Record<Contact, string>>({
    whatsapp: saved.contact.whatsapp ?? "",
    email: saved.contact.email ?? "",
    website: saved.contact.website ?? "",
    instagram: saved.contact.instagram ?? "",
    facebook: saved.contact.facebook ?? "",
  });
  const { busy, error, save } = useGymSave((data: GymProfile) => {
    setCurrent(data);
    // The server tidies what was typed (https:// added, the number's 10 digits): show its version
    setFields({ whatsapp: data.contact.whatsapp ?? "", email: data.contact.email ?? "", website: data.contact.website ?? "", instagram: data.contact.instagram ?? "", facebook: data.contact.facebook ?? "" });
  }, "Saved to your draft");

  // Only what changed is sent
  const changes: GymProfileFields = {};
  if (about.trim() !== (current.about ?? "")) changes.about = about.trim();
  // In the list's order, as the server keeps them
  const orderedTypes = GYM_TYPES.filter((t) => types.includes(t.id)).map((t) => t.id);
  if (orderedTypes.join() !== (current.types ?? []).join()) changes.types = orderedTypes;
  for (const f of FIELDS) if (fields[f.key].trim() !== (current.contact[f.key] ?? "")) changes[f.key] = fields[f.key].trim();
  const ready = canEdit && Object.keys(changes).length > 0;

  const fromElsewhere: { label: string; text: string | null; icon: GymIconName; href: Href }[] = [
    { label: "Gym and branch", text: `${current.gym.name} · ${current.gym.branch}, ${current.gym.area}`, icon: "store", href: "/gym/details" },
    { label: "Address", text: current.contact.address, icon: "map-pin", href: "/gym/details" },
    { label: "Phone", text: current.contact.phone ? `+91 ${current.contact.phone}` : null, icon: "phone", href: "/gym/details" },
    { label: "Map location", text: current.hasLocation ? "Set" : null, icon: "locate-fixed", href: "/gym/attendance/settings" },
  ];

  return (
    <>
      <Text className="gym-page-section">About your gym</Text>
      <GymField
        label="Description"
        icon="file-text"
        value={about}
        onChangeText={(t) => setAbout(t.slice(0, ABOUT_MAX))}
        editable={canEdit}
        maxLength={ABOUT_MAX}
        multiline
        style={{ minHeight: 96, textAlignVertical: "top" }}
        placeholder="Eg. Two floors of equipment, certified trainers, open since 2012."
        hint={`${about.trim().length} of ${ABOUT_MAX}`}
      />

      {current.typesReady ? (
        <View style={{ gap: 8 }}>
          <Text className="gym-field__label">{`Kind of gym (up to ${GYM_TYPES_MAX})`}</Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {GYM_TYPES.map((t) => {
              const on = types.includes(t.id);
              const full = !on && types.length >= GYM_TYPES_MAX;
              return (
                <PressableScale
                  key={t.id}
                  onPress={() => setTypes((list) => (on ? list.filter((id) => id !== t.id) : [...list, t.id]))}
                  disabled={!canEdit || full}
                  haptic="select"
                  className={on ? "gym-choice gym-choice--selected" : "gym-choice"}
                  style={{ opacity: full ? 0.5 : 1 }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !canEdit || full }}
                  accessibilityLabel={t.label}
                >
                  <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{t.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text className="gym-tx__meta">Members can filter Discover by it.</Text>
        </View>
      ) : null}

      <Text className="gym-page-section" style={{ marginTop: 8 }}>How members reach you</Text>
      {FIELDS.map((f) => (
        <GymField
          key={f.key}
          label={f.label}
          icon={f.icon}
          value={fields[f.key]}
          onChangeText={(t) => setFields((all) => ({ ...all, [f.key]: t.slice(0, f.key === "whatsapp" ? 16 : 200) }))}
          editable={canEdit}
          keyboardType={f.keyboard}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={f.placeholder}
        />
      ))}

      {error ? <FormAlert message={error} /> : null}
      {canEdit && <SaveButton label="Save to draft" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateProfile(token, changes))} />}
      <DraftNote canEdit={canEdit} />

      <Text className="gym-page-section" style={{ marginTop: 8 }}>From your branch details</Text>
      <View className="gym-dash-card">
        {fromElsewhere.map((row, index) => (
          <PressableScale key={row.label} onPress={() => router.push(row.href)} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${row.label}: ${row.text ?? "not added yet"}. Change it`}>
            <View className="gym-dash-row__icon bg-gym-primary-soft">
              <GymIcon name={row.icon} size={18} color={colors.gymPrimary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="gym-dash-row__title" numberOfLines={1}>{row.label}</Text>
              <Text className="gym-dash-row__text" numberOfLines={2} style={row.text ? undefined : { color: colors.gymFaint }}>{row.text ?? "Not added yet"}</Text>
            </View>
            <GymIcon name="chevron-right" size={14} color={colors.gymFaint} />
          </PressableScale>
        ))}
      </View>
      <Text className="gym-tx__meta">These also print on your invoices. Changes to them reach members when you next publish.</Text>
    </>
  );
}
