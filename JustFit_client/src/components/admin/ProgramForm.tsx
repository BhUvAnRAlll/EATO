import { Pressable, Text, View } from "react-native";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { PROGRAM_ICON } from "@/data/fitness";
import { KIT_TEXT, PLACE_TEXT, type ProgramFields } from "@/lib/adminPrograms";
import { SECTION_ORDER, SECTION_TITLE, type ProgramIcon, type ProgramPalette } from "@/lib/fitness/catalog";
import { LEVEL_TEXT } from "@/lib/fitnessApi";
import { programGradients, useThemeColors } from "@/theme";

type ProgramFormProps = {
  value: ProgramFields;
  onChange: (next: ProgramFields) => void;
  disabled?: boolean;
};

const PALETTES = Object.keys(programGradients) as ProgramPalette[];
const ICONS = Object.keys(PROGRAM_ICON) as ProgramIcon[];

// The fields of a Fitness program (Admin › Programs, new and edit): what members read, where it
// sits on the Fitness tab, who it's for, and how its card looks (a preview at the top)
export function ProgramForm({ value, onChange, disabled }: ProgramFormProps) {
  const colors = useThemeColors();
  const set = <K extends keyof ProgramFields>(key: K, v: ProgramFields[K]) => onChange({ ...value, [key]: v });
  return (
    <View className="gap-4">
      <View className="fitness-card" style={{ height: 150 }}>
        <ProgramArt palette={value.palette} icon={value.icon} iconSize={56} id="admin-form" />
        <View className="fitness-card__body">
          <Text className="fitness-card__title" numberOfLines={2}>{value.title || "Program title"}</Text>
          <Text className="fitness-card__meta" numberOfLines={1}>{value.subtitle || "Subtitle"}</Text>
        </View>
      </View>
      <AdminField label="Title" value={value.title} onChangeText={(t) => set("title", t)} maxLength={60} editable={!disabled} placeholder="For example: Morning Mobility" />
      <AdminField label="Subtitle" value={value.subtitle} onChangeText={(t) => set("subtitle", t)} maxLength={120} editable={!disabled} placeholder="One line under the title" />
      <AdminField label="Description" value={value.description} onChangeText={(t) => set("description", t)} maxLength={600} multiline editable={!disabled} placeholder="What it is and who it's for" />
      <ChoiceChips label="Section" options={SECTION_ORDER.map((s) => ({ value: s, label: SECTION_TITLE[s] }))} value={value.section} onChange={(v) => set("section", v)} />
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
