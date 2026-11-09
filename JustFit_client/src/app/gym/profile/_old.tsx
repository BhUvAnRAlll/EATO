import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { OpeningHoursEditor } from "@/components/gym/OpeningHoursEditor";
import { SaveButton } from "@/components/gym/SaveButton";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi, type GymProfile, type GymProfileFields } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickCatalogImage, type PhotoSource } from "@/lib/gymPhoto";
import { ABOUT_MAX, FACILITIES, hoursProblem, sameHours, startingHours, type FacilityId, type OpeningHours } from "@/lib/gymProfile";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Settings › Public profile (Gym Hub phase 2, 2026-11-09): what members will see about this branch
// when they look for a gym in the justFit app. The gym admin adds photos (saved at once, up to 8),
// a short description, the facilities and the opening hours (saved together), and sees what is
// reused from elsewhere: the address and phone from Invoice details, the place on the map from
// Location & Attendance, and the logo. Staff can open it to read; only the gym admin can change it
// (the server refuses anyone else).
export default function GymPublicProfile() {
  const { result, retry } = useGymData(gymApi.profile);
  const branches = useGymData(gymApi.branches);
  const owner = branches.result.state === "ready" && branches.result.data.access === "owner";
  return (
    <GymScreen title="Public profile">
      {(result.state === "loading" || branches.result.state === "loading") && <GymLoading label="Loading your public profile" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && branches.result.state !== "loading" && <ProfileForm saved={result.data} owner={owner} />}
    </GymScreen>
  );
}

function ProfileForm({ saved, owner }: { saved: GymProfile; owner: boolean }) {
  const colors = useThemeColors();
  const [current, setCurrent] = useState(saved);
  const [about, setAbout] = useState(saved.about ?? "");
  const [facilities, setFacilities] = useState<FacilityId[]>(saved.facilities);
  const [hours, setHours] = useState<OpeningHours | null>(saved.hours);
  const { busy, error, save } = useGymSave((data: GymProfile) => setCurrent(data), "Public profile saved");

  // Photos save on their own, as soon as one is picked or removed
  const [photoError, setPhotoError] = useState("");
  const photoSave = useGymSave((data: GymProfile) => setCurrent(data));
  const picking = useRef(false);
  const addPhoto = async (source: PhotoSource) => {
    if (photoSave.busy || picking.current) return;
    picking.current = true;
    setPhotoError("");
    const picked = await pickCatalogImage(source)
      .catch(() => ({ ok: false as const, error: "Couldn't open the camera or gallery. Please try again." }))
      .finally(() => {
        picking.current = false;
      });
    if (!picked.ok) {
      if (!("cancelled" in picked)) setPhotoError(picked.error);
      return;
    }
    photoSave.save((token) => gymApi.addGymPhoto(token, { data: picked.photo.data, mediaType: picked.photo.mediaType }));
  };
  const removePhoto = async (id: number) => {
    if (photoSave.busy) return;
    const ok = await confirmChoice({ title: "Remove this photo?", message: "Members won't see it any more.", confirmLabel: "Remove photo" });
    if (ok) photoSave.save((token) => gymApi.removeGymPhoto(token, id));
  };

  // Only what changed is sent
  const changes: GymProfileFields = {};
  if (about.trim() !== (current.about ?? "")) changes.about = about.trim();
  if (facilities.join() !== current.facilities.join()) changes.facilities = facilities;
  if (!sameHours(hours, current.hours)) changes.hours = hours;
  const problem = hours ? hoursProblem(hours) : null;
  const ready = owner && !problem && Object.keys(changes).length > 0;

  const toggle = (id: FacilityId) => setFacilities((list) => (list.includes(id) ? list.filter((f) => f !== id) : FACILITIES.map((f) => f.id).filter((f) => f === id || list.includes(f))));

  const reused: { label: string; text: string; icon: GymIconName; href: Href; set: boolean }[] = [
    { label: "Address", text: current.contact.address ?? "Not added yet", icon: "map-pin", href: "/gym/details", set: Boolean(current.contact.address) },
    { label: "Phone", text: current.contact.phone ? `+91 ${current.contact.phone}` : "Not added yet", icon: "phone", href: "/gym/details", set: Boolean(current.contact.phone) },
    { label: "Map location", text: current.hasLocation ? "Set" : "Not set yet", icon: "locate-fixed", href: "/gym/attendance/settings", set: current.hasLocation },
    { label: "Logo", text: current.hasLogo ? "Added" : "Not added yet", icon: "image", href: "/gym/details", set: current.hasLogo },
  ];

  return (
    <>
      <Text className="gym-tx__meta">{`What members see about ${current.gym.name} ${current.gym.branch} when they look for a gym on justFit.${owner ? "" : " Only the gym admin can change it."}`}</Text>

      {/* Photos */}
      <Text className="gym-page-section" style={{ marginTop: 8 }}>{`Photos (${current.photos.length} of ${current.maxPhotos})`}</Text>
      <Text className="gym-tx__meta">The first photo is your cover. Show the floor, the equipment and the entrance.</Text>
      <View className="gym-gallery">
        {current.photos.map((photo, index) => (
          <View key={photo.id} className="gym-gallery__tile" accessible accessibilityLabel={index === 0 ? "Cover photo" : `Photo ${index + 1}`}>
            <MemberPhotoImage url={photo.url} />
            {owner && (
              <PressableScale onPress={() => removePhoto(photo.id)} disabled={photoSave.busy} className="gym-gallery__remove" hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${index === 0 ? "the cover photo" : `photo ${index + 1}`}`}>
                <GymIcon name="x" size={14} color={colors.white} />
              </PressableScale>
            )}
          </View>
        ))}
        {current.photos.length === 0 && (
          <View className="gym-gallery__tile gym-gallery__tile--add">
            <GymIcon name="image" size={24} color={colors.gymMuted} />
          </View>
        )}
      </View>
      {owner && current.photos.length < current.maxPhotos && (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => addPhoto("camera")} disabled={photoSave.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Take a photo for the gallery">
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Camera</Text>
          </PressableScale>
          <PressableScale onPress={() => addPhoto("library")} disabled={photoSave.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add a photo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
        </View>
      )}
      {photoSave.busy ? <Text className="gym-tx__meta">Saving the photo…</Text> : null}
      {photoError || photoSave.error ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{photoError || photoSave.error}</Text> : null}

      {/* About */}
      <Text className="gym-page-section" style={{ marginTop: 8 }}>About</Text>
      <GymField
        label="Description"
        icon="file-text"
        value={about}
        onChangeText={(t) => setAbout(t.slice(0, ABOUT_MAX))}
        editable={owner}
        maxLength={ABOUT_MAX}
        multiline
        style={{ minHeight: 96, textAlignVertical: "top" }}
        placeholder="Eg. Two floors of equipment, certified trainers, open since 2012."
        hint={`${about.trim().length} of ${ABOUT_MAX}`}
      />

      {/* Facilities */}
      <Text className="gym-page-section" style={{ marginTop: 8 }}>Facilities</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {FACILITIES.map((f) => {
          const on = facilities.includes(f.id);
          return (
            <PressableScale key={f.id} onPress={() => toggle(f.id)} disabled={!owner} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !owner }} accessibilityLabel={f.label}>
              <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </View>

      {/* Opening hours */}
      <Text className="gym-page-section" style={{ marginTop: 8 }}>Opening hours</Text>
      {hours === null ? (
        <View style={{ gap: 8 }}>
          <Text className="gym-tx__meta">Not added yet. Members will see when you are open.</Text>
          {owner && (
            <PressableScale onPress={() => setHours(startingHours())} className="gym-choice flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add opening hours">
              <GymIcon name="clock" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Add opening hours</Text>
            </PressableScale>
          )}
        </View>
      ) : (
        <View className="gym-dash-card" style={{ paddingHorizontal: 14 }} pointerEvents={owner ? "auto" : "none"}>
          <OpeningHoursEditor hours={hours} onChange={setHours} />
          {owner && (
            <PressableScale onPress={() => setHours(null)} className="self-start" style={{ paddingBottom: 12 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove the opening hours">
              <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>Remove opening hours</Text>
            </PressableScale>
          )}
        </View>
      )}

      {error ? <FormAlert message={error} /> : null}
      {owner && <SaveButton label="Save profile" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateProfile(token, changes))} />}

      {/* Reused from other screens */}
      <Text className="gym-page-section" style={{ marginTop: 8 }}>Also shown to members</Text>
      <View className="gym-dash-card">
        {reused.map((row, index) => (
          <PressableScale key={row.label} onPress={() => router.push(row.href)} disabled={!owner} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${row.label}: ${row.text}`}>
            <View className="gym-dash-row__icon bg-gym-primary-soft">
              <GymIcon name={row.icon} size={18} color={colors.gymPrimary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="gym-dash-row__title" numberOfLines={1}>{row.label}</Text>
              <Text className="gym-dash-row__text" numberOfLines={2} style={row.set ? undefined : { color: colors.gymFaint }}>{row.text}</Text>
            </View>
            {owner && <GymIcon name="chevron-right" size={14} color={colors.gymFaint} />}
          </PressableScale>
        ))}
      </View>
    </>
  );
}
