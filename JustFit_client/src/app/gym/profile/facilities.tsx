import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymScreen } from "@/components/gym/GymScreen";
import { DraftNote, ProfileLoad, useProfileDraft } from "@/components/gym/ProfileParts";
import { SaveButton } from "@/components/gym/SaveButton";
import { gymApi, type GymProfile, type GymProfileFields } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { CUSTOM_MAX, CUSTOM_NAME_MAX, customProblem, FACILITIES, tidyName, type CustomFacility, type FacilityId } from "@/lib/gymProfile";
import { useSwitchColors, useThemeColors } from "@/theme";

// Gym Profile › Facilities (2026-11-09): tick what the gym has from the list, and add up to 10 of
// its own ("Boxing ring"). Each of its own can be switched off (kept, not shown to members), renamed
// or removed. Saved to the draft together.
export default function GymProfileFacilities() {
  const { result, retry, canEdit } = useProfileDraft();
  return (
    <GymScreen title="Facilities">
      <ProfileLoad result={result} retry={retry}>{(profile) => <FacilitiesForm saved={profile} canEdit={canEdit} />}</ProfileLoad>
    </GymScreen>
  );
}

function FacilitiesForm({ saved, canEdit }: { saved: GymProfile; canEdit: boolean }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [current, setCurrent] = useState(saved);
  const [ticked, setTicked] = useState<FacilityId[]>(saved.facilities);
  const [custom, setCustom] = useState<CustomFacility[]>(saved.custom);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [nameError, setNameError] = useState("");
  const { busy, error, save } = useGymSave((data: GymProfile) => {
    setCurrent(data);
    setCustom(data.custom);
  }, "Saved to your draft");

  const toggle = (id: FacilityId) => setTicked((list) => (list.includes(id) ? list.filter((f) => f !== id) : FACILITIES.map((f) => f.id).filter((f) => f === id || list.includes(f))));
  const addOrRename = () => {
    const problem = customProblem(name, custom, editing);
    if (problem) return setNameError(problem);
    setNameError("");
    setCustom((list) => (editing === null ? [...list, { name: tidyName(name), on: true }] : list.map((c, i) => (i === editing ? { ...c, name: tidyName(name) } : c))));
    setName("");
    setEditing(null);
  };

  const changes: GymProfileFields = {};
  if (ticked.join() !== current.facilities.join()) changes.facilities = ticked;
  if (JSON.stringify(custom) !== JSON.stringify(current.custom)) changes.custom = custom;
  const ready = canEdit && Object.keys(changes).length > 0 && editing === null;

  return (
    <>
      <Text className="gym-page-section">From the list</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {FACILITIES.map((f) => {
          const on = ticked.includes(f.id);
          return (
            <PressableScale key={f.id} onPress={() => toggle(f.id)} disabled={!canEdit} haptic="select" className={on ? "gym-choice gym-choice--selected" : "gym-choice"} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !canEdit }} accessibilityLabel={f.label}>
              <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </View>

      <Text className="gym-page-section" style={{ marginTop: 8 }}>{`Your own (${custom.length} of ${CUSTOM_MAX})`}</Text>
      <Text className="gym-tx__meta">Anything not on the list. Switch one off to hide it from members without deleting it.</Text>
      {custom.length > 0 && (
        <View className="gym-dash-card">
          {custom.map((c, index) => (
            <View key={`${c.name}-${index}`} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }}>
              <View className="min-w-0 flex-1">
                <Text className="gym-dash-row__title" numberOfLines={1} style={c.on ? undefined : { color: colors.gymFaint }}>{c.name}</Text>
                <Text className="gym-dash-row__text">{c.on ? "Shown to members" : "Hidden from members"}</Text>
              </View>
              {canEdit && (
                <>
                  <PressableScale onPress={() => { setEditing(index); setName(c.name); setNameError(""); }} className="gym-icon-btn" hitSlop={4} accessibilityRole="button" accessibilityLabel={`Rename ${c.name}`}>
                    <GymIcon name="pencil" size={15} color={colors.gymPrimary} />
                  </PressableScale>
                  <PressableScale onPress={() => { setCustom((list) => list.filter((_, i) => i !== index)); if (editing === index) { setEditing(null); setName(""); } }} className="gym-icon-btn" hitSlop={4} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`}>
                    <GymIcon name="trash-2" size={15} color={colors.gymDanger} />
                  </PressableScale>
                </>
              )}
              <Switch
                value={c.on}
                disabled={!canEdit}
                onValueChange={(on) => setCustom((list) => list.map((x, i) => (i === index ? { ...x, on } : x)))}
                {...switchColors}
                trackColor={{ false: switchColors.trackColor.false, true: colors.gymPrimary }}
                accessibilityLabel={`Show ${c.name} to members`}
              />
            </View>
          ))}
        </View>
      )}
      {canEdit && (custom.length < CUSTOM_MAX || editing !== null) && (
        <View style={{ gap: 8 }}>
          <GymField
            label={editing === null ? "Add a facility" : `Rename ${custom[editing]?.name ?? ""}`}
            icon="square-plus"
            value={name}
            onChangeText={(t) => { setName(t.slice(0, CUSTOM_NAME_MAX)); setNameError(""); }}
            placeholder="Eg. Boxing ring"
            maxLength={CUSTOM_NAME_MAX}
            returnKeyType="done"
            onSubmitEditing={addOrRename}
          />
          {nameError ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{nameError}</Text> : null}
          <View className="flex-row" style={{ gap: 8 }}>
            <PressableScale onPress={addOrRename} disabled={tidyName(name).length === 0} className="gym-choice flex-row items-center" style={{ gap: 6, opacity: tidyName(name).length === 0 ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={editing === null ? "Add this facility" : "Rename"}>
              <GymIcon name={editing === null ? "plus" : "check"} size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">{editing === null ? "Add" : "Rename"}</Text>
            </PressableScale>
            {editing !== null && (
              <PressableScale onPress={() => { setEditing(null); setName(""); setNameError(""); }} className="gym-choice" accessibilityRole="button" accessibilityLabel="Cancel renaming">
                <Text className="gym-choice__label">Cancel</Text>
              </PressableScale>
            )}
          </View>
        </View>
      )}

      {error ? <FormAlert message={error} /> : null}
      {canEdit && <SaveButton label="Save to draft" ready={ready} busy={busy} onPress={() => save((token) => gymApi.updateProfile(token, changes))} />}
      <DraftNote canEdit={canEdit} />
    </>
  );
}
