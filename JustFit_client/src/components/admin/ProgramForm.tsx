import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useState } from "react";
import { router } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { PROGRAM_ICON } from "@/data/fitness";
import { KIT_TEXT, PLACE_TEXT, type ProgramFields } from "@/lib/adminPrograms";
import { SECTION_ORDER, SECTION_TITLE, type ProgramIcon, type ProgramPalette } from "@/lib/fitness/catalog";
import { LEVEL_TEXT } from "@/lib/fitnessApi";
import { programGradients, useThemeColors } from "@/theme";

// The cover photo's controls on the preview card (the edit screen only: a new program gets its
// cover once it exists). `busy` while an upload or removal is running.
export type CoverControls = { url: string | null; busy: boolean; onPick: () => void; onRemove: () => void };

type ProgramFormProps = {
  value: ProgramFields;
  onChange: (next: ProgramFields) => void;
  disabled?: boolean;
  cover?: CoverControls;
  // The categories to choose from, in order (Admin › Programs › Categories); the built-in six until they load
  sections?: { id: string; title: string }[];
};

const PALETTES = Object.keys(programGradients) as ProgramPalette[];
const ICONS = Object.keys(PROGRAM_ICON) as ProgramIcon[];

// The fields of a Fitness program (Admin › Programs, new and edit): what members read, where it
// sits on the Fitness tab, who it's for, and how its card looks (a preview at the top, where the
// edit screen also adds, replaces or removes the cover photo)
export function ProgramForm({ value, onChange, disabled, cover, sections }: ProgramFormProps) {
  const colors = useThemeColors();
  const [coverMenu, setCoverMenu] = useState(false);
  const set = <K extends keyof ProgramFields>(key: K, v: ProgramFields[K]) => onChange({ ...value, [key]: v });
  return (
    <View className="gap-4">
      <View className="fitness-card" style={{ height: 150 }}>
        <ProgramArt palette={value.palette} icon={value.icon} iconSize={56} id="admin-form" coverUrl={cover?.url} />
        <View className="fitness-card__body">
          <Text className="fitness-card__title" numberOfLines={2}>{value.title || "Program title"}</Text>
          <Text className="fitness-card__meta" numberOfLines={1}>{value.subtitle || "Subtitle"}</Text>
        </View>
        {cover && (
          // Top-left (the program's symbol keeps the top-right): Add cover, or Edit once there is one
          <Pressable
            onPress={() => (cover.url ? setCoverMenu((open) => !open) : cover.onPick())}
            disabled={cover.busy || disabled}
            hitSlop={8}
            className="screen-bar__back absolute left-3 top-3"
            accessibilityRole="button"
            accessibilityLabel={cover.url ? "Edit cover" : "Add cover"}
          >
            {cover.busy ? <ActivityIndicator size="small" color={colors.leaf} /> : (
              <SymbolView name={cover.url ? { ios: "pencil", android: "edit", web: "edit" } : { ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={18} tintColor={colors.ink} />
            )}
          </Pressable>
        )}
      </View>
      {cover?.url && coverMenu && !cover.busy && (
        <View className="flex-row flex-wrap gap-2">
          <Pressable onPress={() => { setCoverMenu(false); cover.onPick(); }} className="setup__chip" accessibilityRole="button" accessibilityLabel="Replace cover photo">
            <Text className="setup__chip-label">Replace photo</Text>
          </Pressable>
          <Pressable onPress={() => { setCoverMenu(false); cover.onRemove(); }} className="setup__chip" accessibilityRole="button" accessibilityLabel="Remove cover">
            <Text className="setup__chip-label">Remove cover</Text>
          </Pressable>
          <Pressable onPress={() => setCoverMenu(false)} className="setup__chip" accessibilityRole="button" accessibilityLabel="Cancel">
            <Text className="setup__chip-label">Cancel</Text>
          </Pressable>
        </View>
      )}
      <AdminField label="Title" value={value.title} onChangeText={(t) => set("title", t)} maxLength={60} editable={!disabled} placeholder="For example: Morning Mobility" />
      <AdminField label="Subtitle" value={value.subtitle} onChangeText={(t) => set("subtitle", t)} maxLength={120} editable={!disabled} placeholder="One line under the title" />
      <AdminField label="Description" value={value.description} onChangeText={(t) => set("description", t)} maxLength={600} multiline editable={!disabled} placeholder="What it is and who it's for" />
      <View className="gap-2">
        <ChoiceChips label="Category" options={(sections ?? SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLE[id] }))).map((s) => ({ value: s.id, label: s.title }))} value={value.section} onChange={(v) => set("section", v)} />
        <Pressable onPress={() => router.push("/admin/categories/new")} disabled={disabled} className="self-start flex-row items-center" style={{ gap: 6 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="New category">
          <SymbolView name={{ ios: "plus.circle", android: "add_circle", web: "add_circle" }} size={16} tintColor={colors.leaf} />
          <Text className="meta-text" style={{ color: colors.leaf }}>New category</Text>
        </Pressable>
      </View>
      <ChoiceChips label="Where" options={(["home", "center", "both"] as const).map((p) => ({ value: p, label: PLACE_TEXT[p] }))} value={value.place} onChange={(v) => set("place", v)} />
      <ChoiceChips label="Level" options={(["beginner", "intermediate", "advanced"] as const).map((l) => ({ value: l, label: LEVEL_TEXT[l] }))} value={value.level} onChange={(v) => set("level", v)} />
      <ChoiceChips label="Equipment" options={(["none", "some", "full_gym"] as const).map((k) => ({ value: k, label: KIT_TEXT[k] }))} value={value.kit} onChange={(v) => set("kit", v)} />
      <View className="gap-1.5">
        <Text className="auth__label">Colour</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {PALETTES.map((p) => (
            <Pressable key={p} onPress={() => set("palette", p)} className="overflow-hidden" style={{ width: 36, height: 36, borderRadius: 18, borderWidth: value.palette === p ? 3 : 0, borderColor: colors.forestInk }} accessibilityRole="radio" accessibilityState={{ checked: value.palette === p }} accessibilityLabel={p}>
              <ProgramArt palette={p} icon="strength" iconSize={0.1} id={`swatch-${p}`} />
            </Pressable>
          ))}
        </View>
      </View>
      <View className="gap-1.5">
        <Text className="auth__label">Picture</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {ICONS.map((i) => (
            <Pressable key={i} onPress={() => set("icon", i)} className={value.icon === i ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="radio" accessibilityState={{ checked: value.icon === i }} accessibilityLabel={i}>
              <SymbolView name={PROGRAM_ICON[i]} size={18} tintColor={colors.forestInk} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
