import { Switch, Text, View } from "react-native";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { LAYOUT_TEXT, type SectionFields } from "@/lib/adminPrograms";
import type { SectionLayout } from "@/lib/fitness/catalog";
import { useSwitchColors } from "@/theme";

type CategoryFormProps = {
  value: SectionFields;
  onChange: (next: SectionFields) => void;
  disabled?: boolean;
};

const LAYOUTS: SectionLayout[] = ["poster", "tile", "wide"];

// The fields of a Fitness category (Admin › Programs › Categories, new and edit): its name and the
// line under it on the Fitness tab, how its program cards look, and whether members see it
export function CategoryForm({ value, onChange, disabled }: CategoryFormProps) {
  const switchColors = useSwitchColors();
  const set = <K extends keyof SectionFields>(key: K, v: SectionFields[K]) => onChange({ ...value, [key]: v });
  return (
    <View className="gap-4">
      <AdminField label="Name" value={value.title} onChangeText={(t) => set("title", t)} maxLength={40} editable={!disabled} placeholder="For example: Yoga & Mobility" />
      <AdminField label="Line under the name" value={value.note} onChangeText={(t) => set("note", t)} maxLength={120} editable={!disabled} placeholder="For example: Stretch, breathe and move better" />
      <ChoiceChips label="Cards" options={LAYOUTS.map((l) => ({ value: l, label: LAYOUT_TEXT[l] }))} value={value.layout} onChange={(v) => set("layout", v)} />
      <Text className="admin__hint">Posters are tall, tiles are small squares, wide cards fill the width.</Text>
      <View className="admin-list">
        <View className="admin-row">
          <View className="min-w-0 flex-1">
            <Text className="card__title">Shown to members</Text>
            <Text className="meta-text">{value.published ? "On the Fitness tab" : "Hidden, with its programs"}</Text>
          </View>
          <Switch value={value.published} disabled={disabled} onValueChange={(v) => set("published", v)} {...switchColors} accessibilityLabel="Category shown to members" />
        </View>
      </View>
    </View>
  );
}
