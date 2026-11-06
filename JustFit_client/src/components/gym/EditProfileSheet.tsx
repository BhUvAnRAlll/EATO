import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { DateSelect } from "@/components/gym/DateSelect";
import { ChipRow } from "@/components/gym/GymChoice";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { GENDER_LABEL, daysFromToday, initialsOf, phoneInput } from "@/data/gymDashboard";
import { pickMemberPhoto, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { notice } from "@/lib/gymPortal";
import { gymApi, type Gender, type GymMember, type GymMemberDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

const numberOrBlank = (text: string) => (text.trim() === "" ? "" : Number(text));

// A member's ⋯ › Edit Profile (and Edit on their page): the same profile as Add New Member, filled
// in and in one sheet: the photo (replace, or remove), the Member ID (never changes), name, mobile,
// gender, email, height, weight, address, notes and date of birth, then Save Changes. The server
// checks every field again (PATCH /api/gym/members/:id); the photo goes separately after the
// fields are saved, and if only the photo fails the gym admin is told and the fields stay saved.
export function EditProfileSheet({ member, onClose, onSaved }: { member: GymMember; onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const colors = useThemeColors();
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone?.replace(/^\+91/, "") ?? "");
  const [gender, setGender] = useState<Gender | "">(member.gender ?? "");
  // null: the photo as it is; "remove": take the saved one off; a MemberPhoto: a new one to upload
  const [photo, setPhoto] = useState<MemberPhoto | "remove" | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [email, setEmail] = useState(member.email ?? "");
  const [height, setHeight] = useState(member.heightCm ? String(member.heightCm) : "");
  const [weight, setWeight] = useState(member.weightKg ? String(member.weightKg) : "");
  const [address, setAddress] = useState(member.address ?? "");
  const [notes, setNotes] = useState(member.notes ?? "");
  const [dob, setDob] = useState<string | null>(member.dob);
  const { busy, error, save } = useGymSave(onSaved);

  const phoneOk = phone.length === 0 || /^[6-9]\d{9}$/.test(phone);
  const emailOk = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email.trim());
  const heightNum = numberOrBlank(height);
  const weightNum = numberOrBlank(weight);
  const heightOk = heightNum === "" || (Number.isInteger(heightNum) && heightNum >= 50 && heightNum <= 250);
  const weightOk = weightNum === "" || (Number.isFinite(weightNum) && weightNum >= 10 && weightNum <= 300);
  const ready = name.trim().length >= 2 && phoneOk && emailOk && heightOk && weightOk;
  const hasPhoto = photo === "remove" ? false : photo !== null || member.photoUrl !== null;

  const choosePhoto = async (source: PhotoSource) => {
    setPhotoError("");
    const picked = await pickMemberPhoto(source).catch(() => ({ ok: false as const, error: "That photo couldn't be read. Please try another." }));
    if (picked.ok) {
      haptic.select();
      setPhoto(picked.photo);
    } else if ("error" in picked) setPhotoError(picked.error);
  };

  const submit = () =>
    save(async (token) => {
      const edited = await gymApi.editMember(token, member.id, {
        name: name.trim(), phone, dob: dob ?? "", gender,
        email: email.trim(), heightCm: heightNum === "" ? "" : heightNum, weightKg: weightNum === "" ? "" : weightNum, address: address.trim(), notes: notes.trim(),
      });
      if (!edited.ok || photo === null) return edited;
      const withPhoto = photo === "remove" ? await gymApi.removePhoto(token, member.id) : await gymApi.setPhoto(token, member.id, photo);
      if (withPhoto.ok) return withPhoto;
      notice("Profile saved", `${edited.data.member.name}'s details were saved, but the photo couldn't be ${photo === "remove" ? "removed" : "saved"}: ${withPhoto.error}`);
      return edited;
    });

  return (
    <GymSheet title="Edit Profile" subtitle="Update member profile." onClose={onClose}>
      <View className="items-center" style={{ gap: 10 }}>
        <View className="gym-member-photo" accessible accessibilityLabel={hasPhoto ? "Member photo" : "Member photo, none"}>
          {name.trim() ? <Text className="gym-member-photo__initials">{initialsOf(name)}</Text> : <GymIcon name="user" size={44} color={colors.white} />}
          {photo === "remove" ? null : photo ? <MemberPhotoImage uri={photo.previewUri} /> : <MemberPhotoImage url={member.photoUrl} />}
        </View>
        <View className="flex-row flex-wrap justify-center" style={{ gap: 8 }}>
          <PressableScale onPress={() => choosePhoto("camera")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={hasPhoto ? "Retake the photo" : "Take a photo"}>
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">{hasPhoto ? "Retake" : "Camera"}</Text>
          </PressableScale>
          <PressableScale onPress={() => choosePhoto("library")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Choose a photo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
          {hasPhoto && (
            <PressableScale onPress={() => { setPhoto(member.photoUrl ? "remove" : null); setPhotoError(""); }} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the photo">
              <GymIcon name="x" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Remove</Text>
            </PressableScale>
          )}
        </View>
        {photoError ? <Text className="gym-tx__meta text-center" style={{ color: colors.gymDanger }}>{photoError}</Text> : null}
      </View>
      <GymField label="Member ID" icon="id-card" value={member.code} editable={false} />
      <GymField label="Name" icon="user" value={name} onChangeText={setName} maxLength={80} placeholder="Name" autoCapitalize="words" />
      <View className="flex-row items-start" style={{ gap: 10 }}>
        <View className="gym-field--icon" style={{ paddingHorizontal: 14 }} accessible accessibilityLabel="India, plus 91">
          <Text style={{ fontSize: 18 }}>🇮🇳</Text>
          <Text className="gym-tx__name">+91</Text>
        </View>
        <View className="min-w-0 flex-1">
          <GymField label="Mobile number" icon="phone" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} maxLength={16} keyboardType="phone-pad" placeholder="Mobile Number" hint={phoneOk ? "Leave empty to remove it." : "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."} />
        </View>
      </View>
      <ChipRow label="Gender" options={GENDER_LABEL} value={gender} onChange={(g) => setGender(g)} clearable />
      <GymField label="Email" icon="mail" value={email} onChangeText={setEmail} maxLength={120} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} hint={emailOk ? undefined : "Enter a valid email address."} />
      <View className="flex-row" style={{ gap: 10 }}>
        <View className="min-w-0 flex-1">
          <GymField label="Height in cm" icon="ruler" value={height} onChangeText={(t) => setHeight(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="Height (cm)" hint={heightOk ? undefined : "50 to 250 cm"} />
        </View>
        <View className="min-w-0 flex-1">
          <GymField label="Weight in kg" icon="weight" value={weight} onChangeText={(t) => setWeight(t.replace(/[^0-9.]/g, "").slice(0, 5))} keyboardType="decimal-pad" placeholder="Weight (kg)" hint={weightOk ? undefined : "10 to 300 kg"} />
        </View>
      </View>
      <GymField label="Address" icon="map-pin" value={address} onChangeText={setAddress} maxLength={200} placeholder="Address" />
      <GymField label="Notes" icon="notebook-pen" value={notes} onChangeText={setNotes} maxLength={300} placeholder="Notes" />
      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
        <DateSelect label="Date of Birth" value={dob} onChange={setDob} min="1920-01-01" max={daysFromToday(0)} />
        {dob && (
          <PressableScale onPress={() => setDob(null)} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the date of birth">
            <GymIcon name="x" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Remove</Text>
          </PressableScale>
        )}
      </View>
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save Changes" ready={ready} busy={busy} onPress={submit} />
    </GymSheet>
  );
}
