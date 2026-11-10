import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { DraftNote, ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import { gymApi, type GymProfile } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickCatalogImage, type PhotoSource } from "@/lib/gymPhoto";
import { FACILITIES, makeCover, movePhoto, type FacilityId } from "@/lib/gymProfile";
import { confirmChoice } from "@/lib/nativeSheets";
import { useThemeColors } from "@/theme";

// Gym Profile › Photos (2026-11-09): the branch's gallery, up to 8. Each change saves at once:
// adding (camera or gallery, checked and shrunk on the phone, then by the server from its bytes),
// moving a photo up or down, making it the cover (the first), and removing it. New photos and a new
// order reach members when the profile is published; a removed photo leaves their view at once.
// The tag button picks the facility a photo shows (G18; members see it at once, no Publish).
export default function GymProfilePhotos() {
  const { result, retry, update, canEdit } = useProfileDraft();
  return (
    <GymScreen title="Photos">
      <ProfileLoad result={result} retry={retry}>{(profile) => <Gallery profile={profile} canEdit={canEdit} onSaved={(next) => update(() => next)} />}</ProfileLoad>
    </GymScreen>
  );
}

function Gallery({ profile, canEdit, onSaved }: { profile: GymProfile; canEdit: boolean; onSaved: (profile: GymProfile) => void }) {
  const colors = useThemeColors();
  const [pickError, setPickError] = useState("");
  const { busy, error, save } = useGymSave(onSaved);
  const picking = useRef(false);
  // The photo whose facility list is open (G18)
  const [tagging, setTagging] = useState<number | null>(null);
  const ids = profile.photos.map((p) => p.id);

  const add = async (source: PhotoSource) => {
    if (busy || picking.current) return;
    picking.current = true;
    setPickError("");
    const picked = await pickCatalogImage(source)
      .catch(() => ({ ok: false as const, error: "Couldn't open the camera or gallery. Please try again." }))
      .finally(() => {
        picking.current = false;
      });
    if (!picked.ok) {
      if (!("cancelled" in picked)) setPickError(picked.error);
      return;
    }
    save((token) => gymApi.addGymPhoto(token, { data: picked.photo.data, mediaType: picked.photo.mediaType }));
  };
  const reorder = (next: number[]) => {
    if (busy || next.join() === ids.join()) return;
    save((token) => gymApi.orderGymPhotos(token, next));
  };
  const remove = async (id: number, name: string) => {
    if (busy) return;
    const ok = await confirmChoice({ title: `Remove ${name}?`, message: "It's deleted, and members stop seeing it straight away.", confirmLabel: "Remove photo", destructive: true });
    if (ok) save((token) => gymApi.removeGymPhoto(token, id));
  };

  const tag = (id: number, facility: FacilityId | null) => {
    if (busy) return;
    setTagging(null);
    save((token) => gymApi.tagGymPhoto(token, id, facility));
  };

  const small = (icon: "arrow-up" | "arrow-down" | "star" | "trash-2" | "tag", label: string, onPress: () => void, disabled = false, danger = false) => (
    <PressableScale onPress={onPress} disabled={disabled || busy} className="gym-icon-btn" style={{ opacity: disabled ? 0.35 : 1 }} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy }}>
      <GymIcon name={icon} size={16} color={danger ? colors.gymDanger : colors.gymPrimary} />
    </PressableScale>
  );

  return (
    <>
      <Text className="gym-tx__meta">{`${profile.photos.length} of ${profile.maxPhotos} photos. The first one is your cover. Show the floor, the equipment and the entrance.`}</Text>
      {profile.photos.length === 0 ? (
        <View className="gym-dash-card items-center" style={{ padding: 24, gap: 8 }}>
          <GymIcon name="image" size={28} color={colors.gymMuted} />
          <Text className="gym-dash-row__title">No photos yet</Text>
          <Text className="gym-tx__meta" style={{ textAlign: "center" }}>Members choose a gym by its photos. Add a few of your best.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {profile.photos.map((photo, index) => {
            const name = index === 0 ? "the cover photo" : `photo ${index + 1}`;
            return (
              <View key={photo.id} className="gym-dash-card flex-row items-center" style={{ padding: 10, gap: 12 }}>
                <View style={{ width: 96, height: 72, borderRadius: 10, overflow: "hidden" }} accessible accessibilityLabel={index === 0 ? "Cover photo" : `Photo ${index + 1}`}>
                  <MemberPhotoImage url={photo.url} />
                </View>
                <View className="min-w-0 flex-1" style={{ gap: 4 }}>
                  <Text className="gym-dash-row__title">{index === 0 ? "Cover" : `Photo ${index + 1}`}</Text>
                  {photo.facility ? <Text className="gym-tx__meta">{`Shows: ${FACILITIES.find((f) => f.id === photo.facility)?.label ?? photo.facility}`}</Text> : null}
                  {canEdit && (
                    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                      {small("arrow-up", `Move ${name} up`, () => reorder(movePhoto(ids, photo.id, -1)), index === 0)}
                      {small("arrow-down", `Move ${name} down`, () => reorder(movePhoto(ids, photo.id, 1)), index === ids.length - 1)}
                      {index > 0 && small("star", `Make photo ${index + 1} the cover`, () => reorder(makeCover(ids, photo.id)))}
                      {photo.facility !== undefined && small("tag", `Choose the facility ${name} shows`, () => setTagging(tagging === photo.id ? null : photo.id))}
                      {small("trash-2", `Remove ${name}`, () => remove(photo.id, name), false, true)}
                    </View>
                  )}
                  {tagging === photo.id && (
                    <View className="flex-row flex-wrap" style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="The facility this photo shows">
                      {[{ id: null, label: "None" }, ...FACILITIES].map((f) => {
                        const on = (photo.facility ?? null) === f.id;
                        return (
                          <PressableScale key={f.id ?? "none"} onPress={() => tag(photo.id, f.id)} disabled={busy} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={f.label}>
                            <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{f.label}</Text>
                          </PressableScale>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
      {canEdit && profile.photos.length < profile.maxPhotos && (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => add("camera")} disabled={busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Take a photo for the gallery">
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Camera</Text>
          </PressableScale>
          <PressableScale onPress={() => add("library")} disabled={busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add a photo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
        </View>
      )}
      {busy ? <Text className="gym-tx__meta">Saving…</Text> : null}
      {pickError || error ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{pickError || error}</Text> : null}
      <DraftNote canEdit={canEdit} />
    </>
  );
}
