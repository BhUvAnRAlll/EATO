import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { AuthImage } from "@/components/community/AuthImage";
import { FormAlert } from "@/components/FormAlert";
import { community } from "@/lib/community";
import { hoursText, parseFacilities, parseGuidelines, parseHours, parseTiers, tiersText } from "@/lib/gymRules";
import { gyms, type Gym, type GymProfileChanges } from "@/lib/gyms";
import { pickPhotos } from "@/lib/media";
import { colors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.forestInk } as const;

type Props = { gym: Gym; getToken: () => Promise<string | null>; onSaved: (gym: Gym) => void };

// Manage → Profile: name, tagline, description, area, address, contact, hours, facilities,
// membership tiers, guidelines, logo and cover. Lists are one entry per line (gymRules.ts
// turns them into what the server expects). Saving sends only what changed.
export function GymProfileForm({ gym, getToken, onSaved }: Props) {
  const [values, setValues] = useState({
    name: gym.name,
    tagline: gym.tagline ?? "",
    description: gym.description ?? "",
    location: gym.location ?? "",
    address: gym.address ?? "",
    contactPhone: gym.contact.phone ?? "",
    contactEmail: gym.contact.email ?? "",
    contactWebsite: gym.contact.website ?? "",
    hours: hoursText(gym.hours),
    facilities: gym.facilities.join(", "),
    tiers: tiersText(gym.membershipTiers),
    guidelines: gym.guidelines.join("\n"),
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  // The changed fields only; empty text clears an optional field (null)
  const changes = (): GymProfileChanges => {
    const out: GymProfileChanges = {};
    const text = (value: string) => value.trim() || null;
    if (values.name.trim() !== gym.name) out.name = values.name.trim();
    if (text(values.tagline) !== gym.tagline) out.tagline = text(values.tagline);
    if (text(values.description) !== gym.description) out.description = text(values.description);
    if (text(values.location) !== gym.location) out.location = text(values.location);
    if (text(values.address) !== gym.address) out.address = text(values.address);
    if (text(values.contactPhone) !== gym.contact.phone) out.contactPhone = text(values.contactPhone);
    if (text(values.contactEmail) !== gym.contact.email) out.contactEmail = text(values.contactEmail);
    if (text(values.contactWebsite) !== gym.contact.website) out.contactWebsite = text(values.contactWebsite);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(parseHours(values.hours), gym.hours)) out.hours = parseHours(values.hours);
    if (!same(parseFacilities(values.facilities), gym.facilities)) out.facilities = parseFacilities(values.facilities);
    if (!same(parseTiers(values.tiers), gym.membershipTiers)) out.membershipTiers = parseTiers(values.tiers);
    if (!same(parseGuidelines(values.guidelines), gym.guidelines)) out.guidelines = parseGuidelines(values.guidelines);
    return out;
  };

  const save = async () => {
    const pending = changes();
    if (Object.keys(pending).length === 0) return setSaved(true);
    if (!values.name.trim()) return setError("The gym needs a name.");
    setSaving(true);
    setError(null);
    const result = await gyms.updateProfile(await getToken(), gym.id, pending);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setSaved(true);
    onSaved(result.data.gym);
  };

  // Upload a photo, then point the gym at it (the server checks it is the editor's own upload)
  const pickImage = async (which: "logo" | "cover") => {
    const picked = await pickPhotos("library", 1);
    if (!picked.ok) {
      if (!("cancelled" in picked)) setError(picked.error);
      return;
    }
    setUploading(which);
    setError(null);
    const token = await getToken();
    const photo = picked.photos[0];
    const upload = await community.uploadImage(token, { data: photo.data, mediaType: photo.mediaType });
    if (!upload.ok) {
      setUploading(null);
      return setError(upload.error);
    }
    const result = await gyms.updateProfile(token, gym.id, which === "logo" ? { logoMediaId: upload.data.media.id } : { coverMediaId: upload.data.media.id });
    setUploading(null);
    if (!result.ok) return setError(result.error);
    onSaved(result.data.gym);
  };

  const field = (label: string, key: keyof typeof values, opts: { multiline?: boolean; placeholder?: string; hint?: string; keyboard?: "email-address" | "phone-pad" | "url"; max?: number } = {}) => (
    <View key={key}>
      <Text className="auth__label mb-2">{label}</Text>
      <TextInput
        value={values[key]}
        onChangeText={set(key)}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.faint}
        multiline={opts.multiline}
        keyboardType={opts.keyboard}
        autoCapitalize={opts.keyboard ? "none" : "sentences"}
        maxLength={opts.max}
        accessibilityLabel={label}
        style={{ ...input, minHeight: opts.multiline ? 96 : 48, textAlignVertical: opts.multiline ? "top" : "center" }}
      />
      {opts.hint && <Text className="home__note mt-1">{opts.hint}</Text>}
    </View>
  );

  return (
    <View className="gap-4">
      <View className="flex-row gap-3">
        {(["logo", "cover"] as const).map((which) => {
          const url = which === "logo" ? gym.logoUrl : gym.coverUrl;
          return (
            <Pressable key={which} onPress={() => pickImage(which)} disabled={uploading !== null} className="post__card flex-1 items-center gap-2" accessibilityRole="button" accessibilityLabel={`Change ${which === "logo" ? "logo" : "cover photo"}`}>
              {url ? <AuthImage path={url} style={{ width: which === "logo" ? 56 : "100%", height: 56, borderRadius: 12 }} /> : <View className="bg-forest-soft" style={{ width: which === "logo" ? 56 : "100%", height: 56, borderRadius: 12 }} />}
              {uploading === which ? <ActivityIndicator color={colors.forest} /> : <Text className="admin__action-label">{url ? "Change" : "Add"} {which === "logo" ? "logo" : "cover"}</Text>}
            </Pressable>
          );
        })}
      </View>
      {field("Gym name", "name", { max: 80 })}
      {field("Tagline", "tagline", { placeholder: "Lift heavy, lift often", max: 120 })}
      {field("Description", "description", { multiline: true, max: 1000 })}
      {field("Area", "location", { placeholder: "Indiranagar, Bengaluru", max: 80 })}
      {field("Address", "address", { max: 200 })}
      {field("Phone", "contactPhone", { keyboard: "phone-pad", max: 20 })}
      {field("Email", "contactEmail", { keyboard: "email-address", max: 120 })}
      {field("Website", "contactWebsite", { keyboard: "url", placeholder: "https://", max: 200 })}
      {field("Opening hours", "hours", { multiline: true, placeholder: "Mon–Fri: 5am–11pm\nSat–Sun: 6am–8pm", hint: "One per line, days and hours split by a colon." })}
      {field("Facilities", "facilities", { placeholder: "Free weights, Sauna, Showers", hint: "Separated by commas." })}
      {field("Membership tiers", "tiers", { multiline: true, placeholder: "Basic | ₹1,499/mo | Gym floor and lockers", hint: "One per line: name | price | perks." })}
      {field("Guidelines", "guidelines", { multiline: true, placeholder: "Re-rack your weights", hint: "One per line." })}
      {error && <FormAlert message={error} />}
      {saved && !error && <Text className="home__note">Saved.</Text>}
      <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Save gym profile">
        {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Save changes</Text>}
      </Pressable>
    </View>
  );
}
