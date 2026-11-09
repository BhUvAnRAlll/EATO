import { useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { OpeningHoursEditor } from "@/components/gym/OpeningHoursEditor";
import { SaveButton } from "@/components/gym/SaveButton";
import { gymApi, type TrainerProfile, type TrainerProfileFields } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickMemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { BIO_MAX, CERTIFICATION_MAX, SPECIALIZATION_MAX, SPECIALIZATION_PRESETS, TRAINER_LIST_MAX, hoursProblem, sameHours, startingHours, type OpeningHours } from "@/lib/gymProfile";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useSwitchColors, useThemeColors } from "@/theme";

// Gym Profile › Trainers › a trainer (Gym Profile phase 3, 2026-11-09): what members see about one
// trainer login. The photo saves at once (camera or gallery, shrunk on the phone); the rest saves
// together: specialisations (quick picks or typed, up to 8), years of experience, certifications
// (up to 8), a short bio, when they're available (a week like the opening hours) and Show to members.
// The name is the trainer's own, from their justFit account. Staff without Gym Profile › Trainer
// profiles read it only (the server refuses their changes regardless).
export default function GymTrainerProfile() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { result, retry, update } = useGymData(gymApi.trainerProfiles);
  const canEdit = useCan()("profile.trainers");
  const trainer = result.state === "ready" ? result.data.trainers.find((t) => t.userId === userId) ?? null : null;
  return (
    <GymScreen title={trainer?.name ?? "Trainer"}>
      {result.state === "loading" && <GymLoading label="Loading the trainer" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && !trainer && <GymError error="That trainer doesn't work at this branch any more." onRetry={retry} />}
      {trainer && <TrainerForm key={trainer.userId} saved={trainer} canEdit={canEdit} onList={(trainers) => update(() => ({ trainers }))} />}
    </GymScreen>
  );
}

function TrainerForm({ saved, canEdit, onList }: { saved: TrainerProfile; canEdit: boolean; onList: (trainers: TrainerProfile[]) => void }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [current, setCurrent] = useState(saved);
  const [specs, setSpecs] = useState<string[]>(saved.specializations);
  const [spec, setSpec] = useState("");
  const [years, setYears] = useState(saved.years === null ? "" : String(saved.years));
  const [certs, setCerts] = useState<string[]>(saved.certifications);
  const [cert, setCert] = useState("");
  const [bio, setBio] = useState(saved.bio ?? "");
  const [availability, setAvailability] = useState<OpeningHours | null>(saved.availability);
  const [active, setActive] = useState(saved.active);
  const fresh = (list: { trainers: TrainerProfile[] }) => list.trainers.find((t) => t.userId === saved.userId);
  const { busy, error, save } = useGymSave((data: { trainers: TrainerProfile[] }) => {
    onList(data.trainers);
    const t = fresh(data);
    if (t) setCurrent(t);
  }, "Trainer profile saved");

  // The photo saves on its own
  const [photoError, setPhotoError] = useState("");
  const photo = useGymSave((data: { trainers: TrainerProfile[] }) => {
    onList(data.trainers);
    const t = fresh(data);
    if (t) setCurrent((c) => ({ ...c, photoUrl: t.photoUrl }));
  });
  const picking = useRef(false);
  const addPhoto = async (source: PhotoSource) => {
    if (photo.busy || picking.current) return;
    picking.current = true;
    setPhotoError("");
    const picked = await pickMemberPhoto(source)
      .catch(() => ({ ok: false as const, error: "Couldn't open the camera or gallery. Please try again." }))
      .finally(() => {
        picking.current = false;
      });
    if (!picked.ok) {
      if (!("cancelled" in picked)) setPhotoError(picked.error);
      return;
    }
    photo.save((token) => gymApi.setTrainerPhoto(token, saved.userId, { data: picked.photo.data, mediaType: picked.photo.mediaType }));
  };
  const removePhoto = async () => {
    const ok = await confirmChoice({ title: "Remove the photo?", message: "Members see the trainer's initials instead.", confirmLabel: "Remove photo", destructive: true });
    if (ok) photo.save((token) => gymApi.removeTrainerPhoto(token, saved.userId));
  };

  const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
  const addTo = (list: string[], setList: (l: string[]) => void, text: string, clear: () => void) => {
    const t = tidy(text);
    if (t.length < 2 || list.length >= TRAINER_LIST_MAX || list.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setList([...list, t]);
    clear();
  };
  const toggleSpec = (name: string) => setSpecs((list) => (list.includes(name) ? list.filter((x) => x !== name) : list.length < TRAINER_LIST_MAX ? [...list, name] : list));

  const yearsValue = years === "" ? null : Number(years);
  const yearsOk = yearsValue === null || (Number.isInteger(yearsValue) && yearsValue <= 60);
  const changes: TrainerProfileFields = {};
  if (specs.join("\n") !== current.specializations.join("\n")) changes.specializations = specs;
  if (certs.join("\n") !== current.certifications.join("\n")) changes.certifications = certs;
  if (yearsOk && yearsValue !== current.years) changes.years = yearsValue;
  if (bio.trim() !== (current.bio ?? "")) changes.bio = bio.trim();
  if (!sameHours(availability, current.availability)) changes.availability = availability;
  if (active !== current.active) changes.active = active;
  const problem = availability ? hoursProblem(availability) : null;
  const ready = canEdit && yearsOk && !problem && Object.keys(changes).length > 0;

  const chip = (label: string, on: boolean, onPress: () => void, a11y: string) => (
    <PressableScale key={label} onPress={onPress} disabled={!canEdit} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !canEdit }} accessibilityLabel={a11y}>
      <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{label}</Text>
    </PressableScale>
  );

  return (
    <>
      <View className="gym-dash-card flex-row items-center" style={{ padding: 14, gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, overflow: "hidden", backgroundColor: colors.gymPrimarySoft, alignItems: "center", justifyContent: "center" }} accessible accessibilityLabel={current.photoUrl ? "The trainer's photo" : "No photo yet"}>
          {current.photoUrl ? <MemberPhotoImage url={current.photoUrl} /> : <GymIcon name="user" size={30} color={colors.gymPrimary} />}
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Text className="gym-dash-row__title" numberOfLines={2}>{current.name ?? "Name not added yet"}</Text>
          <Text className="gym-dash-row__text">{current.name ? "Their name from the justFit app" : "They add it in the justFit app; until then members can't see them"}</Text>
          {current.phone ? <Text className="gym-dash-row__text">{current.phone}</Text> : null}
        </View>
      </View>
      {canEdit && (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => addPhoto("camera")} disabled={photo.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Take the trainer's photo">
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Camera</Text>
          </PressableScale>
          <PressableScale onPress={() => addPhoto("library")} disabled={photo.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Choose the trainer's photo from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
          {current.photoUrl && (
            <PressableScale onPress={removePhoto} disabled={photo.busy} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the trainer's photo">
              <GymIcon name="x" size={16} color={colors.gymDanger} />
              <Text className="gym-choice__label">Remove</Text>
            </PressableScale>
          )}
        </View>
      )}
      {photo.busy ? <Text className="gym-tx__meta">Saving the photo…</Text> : null}
      {photoError || photo.error ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{photoError || photo.error}</Text> : null}

      <View className="gym-dash-card flex-row items-center" style={{ padding: 14, gap: 10 }}>
        <View className="min-w-0 flex-1">
          <Text className="gym-dash-row__title">Show to members</Text>
          <Text className="gym-dash-row__text">{active ? "Members see this trainer on your gym's page" : "Hidden from members"}</Text>
        </View>
        <Switch value={active} disabled={!canEdit} onValueChange={setActive} {...switchColors} trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }} accessibilityLabel="Show this trainer to members" />
      </View>

      <Text className="gym-page-section">{`Specialisations (${specs.length} of ${TRAINER_LIST_MAX})`}</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {[...SPECIALIZATION_PRESETS, ...specs.filter((s) => !SPECIALIZATION_PRESETS.includes(s))].map((name) => chip(name, specs.includes(name), () => toggleSpec(name), name))}
      </View>
      {canEdit && specs.length < TRAINER_LIST_MAX && (
        <GymField label="Another specialisation" icon="square-plus" value={spec} onChangeText={(t) => setSpec(t.slice(0, SPECIALIZATION_MAX))} maxLength={SPECIALIZATION_MAX} placeholder="Eg. Powerlifting" returnKeyType="done" onSubmitEditing={() => addTo(specs, setSpecs, spec, () => setSpec(""))} hint="Press done to add it" />
      )}

      <GymField label="Years of experience" icon="timer" value={years} onChangeText={(t) => setYears(t.replace(/\D/g, "").slice(0, 2))} editable={canEdit} keyboardType="number-pad" placeholder="Eg. 6" hint={yearsOk ? "0 for a new trainer, up to 60" : "Up to 60 years."} />

      <Text className="gym-page-section">{`Certifications (${certs.length} of ${TRAINER_LIST_MAX})`}</Text>
      {certs.map((c, i) => (
        <View key={c} className="flex-row items-center" style={{ gap: 8 }}>
          <GymIcon name="badge-check" size={16} color={colors.gymSuccess} />
          <Text className="gym-tx__meta min-w-0 flex-1" style={{ color: colors.gymInk }}>{c}</Text>
          {canEdit && (
            <PressableScale onPress={() => setCerts((list) => list.filter((_, k) => k !== i))} className="gym-icon-btn" hitSlop={4} accessibilityRole="button" accessibilityLabel={`Remove the certification ${c}`}>
              <GymIcon name="x" size={14} color={colors.gymDanger} />
            </PressableScale>
          )}
        </View>
      ))}
      {canEdit && certs.length < TRAINER_LIST_MAX && (
        <GymField label="Add a certification" icon="badge-check" value={cert} onChangeText={(t) => setCert(t.slice(0, CERTIFICATION_MAX))} maxLength={CERTIFICATION_MAX} placeholder="Eg. ACE Certified Personal Trainer" returnKeyType="done" onSubmitEditing={() => addTo(certs, setCerts, cert, () => setCert(""))} hint="Press done to add it" />
      )}

      <GymField label="About the trainer" icon="file-text" value={bio} onChangeText={(t) => setBio(t.slice(0, BIO_MAX))} editable={canEdit} maxLength={BIO_MAX} multiline style={{ minHeight: 96, textAlignVertical: "top" }} placeholder="Eg. Helps beginners lift safely. Speaks Kannada, Hindi and English." hint={`${bio.trim().length} of ${BIO_MAX}`} />

      <Text className="gym-page-section">Available</Text>
      {availability === null ? (
        <View style={{ gap: 8 }}>
          <Text className="gym-tx__meta">Not added yet. Members see when this trainer is at the gym.</Text>
          {canEdit && (
            <PressableScale onPress={() => setAvailability(startingHours())} className="gym-choice flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add when the trainer is available">
              <GymIcon name="clock" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Add availability</Text>
            </PressableScale>
          )}
        </View>
      ) : (
        <View className="gym-dash-card" style={{ paddingHorizontal: 14 }} pointerEvents={canEdit ? "auto" : "none"}>
          <OpeningHoursEditor hours={availability} onChange={setAvailability} />
          {canEdit && (
            <PressableScale onPress={() => setAvailability(null)} className="self-start" style={{ paddingBottom: 12 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove the availability">
              <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>Remove availability</Text>
            </PressableScale>
          )}
        </View>
      )}
      {problem ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{problem}</Text> : null}

      {error ? <FormAlert message={error} /> : null}
      {canEdit && <SaveButton label="Save profile" ready={ready} busy={busy} onPress={() => save((token) => gymApi.saveTrainerProfile(token, saved.userId, changes))} />}
      {!canEdit ? <Text className="gym-tx__meta">Your login can read trainer profiles but not change them. Ask your gym admin.</Text> : null}
    </>
  );
}
