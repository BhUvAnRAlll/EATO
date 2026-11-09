import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useState } from "react";
import { router } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { KIT_TEXT, PLACE_TEXT, type ProgramFields } from "@/lib/adminPrograms";
import { SECTION_ORDER, SECTION_TITLE } from "@/lib/fitness/catalog";
import { LEVEL_TEXT } from "@/lib/fitnessApi";
import { useThemeColors } from "@/theme";

// The cover photo's controls on the preview card (the edit screen only: a new program gets its
// cover once it exists), shown as a row under the preview. `busy` while an upload or removal runs.
export type CoverControls = { url: string | null; busy: boolean; onPick: () => void; onRemove: () => void };

type ProgramFormProps = {
  value: ProgramFields;
  onChange: (next: ProgramFields) => void;
  disabled?: boolean;
  cover?: CoverControls;
  // The program page's photo (the top of the program's screen, not the card), the same controls
  hero?: CoverControls;
  // The categories to choose from, in order (Admin › Programs › Categories); the built-in six until they load
  sections?: { id: string; title: string }[];
};


// The fields of a Fitness program (Admin › Programs, new and edit): what members read, where it
// sits on the Fitness tab, who it's for (its colour and symbol aren't chosen any more: the cover
// photo is its picture), and how its card looks (a preview at the top, as members
// see it: a cover photo alone, else the colours with the title; the edit screen adds, replaces or
// removes the cover photo in a row under it)
export function ProgramForm({ value, onChange, disabled, cover, hero, sections }: ProgramFormProps) {
  const colors = useThemeColors();
  const set = <K extends keyof ProgramFields>(key: K, v: ProgramFields[K]) => onChange({ ...value, [key]: v });
  return (
    <View className="gap-4">
      <View className="fitness-card" style={{ height: 150 }}>
        <ProgramArt palette={value.palette} icon={value.icon} iconSize={56} id="admin-form" coverUrl={cover?.url} shade={!cover?.url} />
        {!cover?.url && (
          <View className="fitness-card__body">
            <Text className="fitness-card__title" numberOfLines={2}>{value.title || "Program title"}</Text>
            <Text className="fitness-card__meta" numberOfLines={1}>{value.subtitle || "Subtitle"}</Text>
          </View>
        )}
      </View>
      {cover && <PhotoRow photo={cover} disabled={disabled} title="Cover photo" setText="Shown on the card instead of the colours" emptyText="Optional: a photo for the card" noun="cover" />}
      {hero && (
        <>
          {hero.url && (
            <View className="fitness-card" style={{ height: 120 }}>
              <ProgramArt palette={value.palette} icon={value.icon} iconSize={40} id="admin-hero" coverUrl={hero.url} shade={false} />
            </View>
          )}
          <PhotoRow photo={hero} disabled={disabled} title="Program page photo" setText="Shown at the top of the program's page" emptyText="Optional: the top of the program's page shows the colours without one" noun="page photo" />
        </>
      )}
      <AdminField label="Title" value={value.title} onChangeText={(t) => set("title", t)} maxLength={60} editable={!disabled} placeholder="For example: Morning Mobility" />
      <AdminField label="Subtitle" value={value.subtitle} onChangeText={(t) => set("subtitle", t)} maxLength={120} editable={!disabled} placeholder="One line under the title" />
      <AdminField label="Description" value={value.description} onChangeText={(t) => set("description", t)} maxLength={600} multiline editable={!disabled} placeholder="What it is and who it's for" />
      <View className="gap-2">
        <ChoiceChips label="Category" options={(sections ?? SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLE[id] }))).map((s) => ({ value: s.id, label: s.title }))} value={value.section} onChange={(v) => set("section", v)} />
        <Pressable onPress={() => router.push("/admin/categories/new")} disabled={disabled} className="self-start flex-row items-center" style={{ gap: 6 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="New category">
          <SymbolView name={{ ios: "plus.circle", android: "add_circle", web: "add_circle" }} size={16} tintColor={colors.leaf} />
          <Text className="meta-text" style={{ color: colors.primaryText }}>New category</Text>
        </Pressable>
      </View>
      <ChoiceChips label="Where" options={(["home", "center", "both"] as const).map((p) => ({ value: p, label: PLACE_TEXT[p] }))} value={value.place} onChange={(v) => set("place", v)} />
      <ChoiceChips label="Level" options={(["beginner", "intermediate", "advanced"] as const).map((l) => ({ value: l, label: LEVEL_TEXT[l] }))} value={value.level} onChange={(v) => set("level", v)} />
      <ChoiceChips label="Equipment" options={(["none", "some", "full_gym"] as const).map((k) => ({ value: k, label: KIT_TEXT[k] }))} value={value.kit} onChange={(v) => set("kit", v)} />
    </View>
  );
}

// One photo's row under the preview: Add, or Change once there is one (Replace / Remove)
function PhotoRow({ photo, disabled, title, setText, emptyText, noun }: { photo: CoverControls; disabled?: boolean; title: string; setText: string; emptyText: string; noun: string }) {
  const colors = useThemeColors();
  const [menu, setMenu] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => (photo.url ? setMenu((open) => !open) : photo.onPick())}
        disabled={photo.busy || disabled}
        className="admin-list"
        accessibilityRole="button"
        accessibilityLabel={photo.url ? `Change ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}
      >
        <View className="admin-row">
          <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={20} tintColor={colors.leaf} />
          <View className="min-w-0 flex-1">
            <Text className="card__title">{title}</Text>
            <Text className="meta-text">{photo.url ? setText : emptyText}</Text>
          </View>
          {photo.busy ? <ActivityIndicator size="small" color={colors.leaf} /> : (
            <View className="flex-row items-center" style={{ gap: 2 }}>
              <Text className="meta-text" style={{ color: colors.primaryText }}>{photo.url ? "Change" : "Add"}</Text>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.leaf} />
            </View>
          )}
        </View>
      </Pressable>
      {photo.url && menu && !photo.busy && (
        <View className="flex-row flex-wrap gap-2">
          <Pressable onPress={() => { setMenu(false); photo.onPick(); }} className="setup__chip" accessibilityRole="button" accessibilityLabel={`Replace ${title.toLowerCase()}`}>
            <Text className="setup__chip-label">Replace photo</Text>
          </Pressable>
          <Pressable onPress={() => { setMenu(false); photo.onRemove(); }} className="setup__chip" accessibilityRole="button" accessibilityLabel={`Remove ${noun}`}>
            <Text className="setup__chip-label">{`Remove ${noun}`}</Text>
          </Pressable>
          <Pressable onPress={() => setMenu(false)} className="setup__chip" accessibilityRole="button" accessibilityLabel="Cancel">
            <Text className="setup__chip-label">Cancel</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}
