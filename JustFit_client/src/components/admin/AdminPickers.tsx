import { useState } from "react";
import { Keyboard, Platform, Pressable, Switch, Text, View } from "react-native";
import { Image } from "expo-image";

import { FormAlert } from "@/components/FormAlert";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SymbolView } from "@/components/SymbolView";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { mealImage } from "@/lib/mealsApi";
import { showActions } from "@/lib/nativeSheets";
import { useAuthStore } from "@/store/auth";
import { useSwitchColors, useThemeColors } from "@/theme";

// Small pieces the Super Admin's Meals forms share: a photo box (camera or gallery, remove), a date
// field that can be left empty, and a labelled on/off row.

export type PhotoChoice = { picked: MemberPhoto | null; removed: boolean };

/** The photo to send: a new one, a removal, or nothing (keep) */
export function photoPayload(choice: PhotoChoice, hadPhoto: boolean) {
  if (choice.picked) return { photo: { data: choice.picked.data, mediaType: choice.picked.mediaType } };
  if (choice.removed && hadPhoto) return { removePhoto: true as const };
  return {};
}

export function PhotoBox({ label, hint, aspect, currentUrl, choice, onChange }: { label: string; hint: string; aspect: number; currentUrl: string | null; choice: PhotoChoice; onChange: (c: PhotoChoice) => void }) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const [error, setError] = useState("");
  const showing = choice.picked ? { uri: choice.picked.previewUri } : currentUrl && !choice.removed ? mealImage(currentUrl, token) : null;
  const choose = () => {
    const pick = async (source: PhotoSource) => {
      setError("");
      const picked = await pickCatalogImage(source);
      if (picked.ok) onChange({ picked: picked.photo, removed: false });
      else if (!("cancelled" in picked)) setError(picked.error);
    };
    showActions({
      title: label,
      actions: [
        ...(Platform.OS === "web" ? [] : [{ label: "Take photo", onPress: () => pick("camera") }]),
        { label: "Choose from gallery", onPress: () => pick("library") },
        ...(showing ? [{ label: "Remove photo", destructive: true, onPress: () => onChange({ picked: null, removed: true }) }] : []),
      ],
    });
  };
  return (
    <View className="gap-1.5">
      <Text className="auth__label">{label}</Text>
      <Pressable onPress={choose} className="meal__card items-center justify-center" style={{ aspectRatio: aspect, backgroundColor: showing ? colors.surface : colors.creamDeep }} accessibilityRole="button" accessibilityLabel={showing ? `Change the ${label.toLowerCase()}` : `Add a ${label.toLowerCase()}`}>
        {showing ? (
          <Image source={showing} contentFit="cover" style={{ width: "100%", height: "100%" }} />
        ) : (
          <View className="items-center px-4" style={{ gap: 4 }}>
            <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={24} tintColor={colors.muted} />
            <Text className="card__title">Add a photo</Text>
            <Text className="meta-text text-center">{hint}</Text>
          </View>
        )}
      </Pressable>
      {error ? <FormAlert message={error} /> : null}
    </View>
  );
}

const toDate = (iso: string) => new Date(`${iso}T12:00:00`);
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shown = (iso: string) => toDate(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** A day that may be left empty ("No start date"): Select, then Clear */
export function DateField({ label, value, onChange, emptyText, min, max }: { label: string; value: string | null; onChange: (iso: string | null) => void; emptyText: string; min: string; max: string }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-1.5">
      <Text className="auth__label">{label}</Text>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <Pressable onPress={() => { Keyboard.dismiss(); setOpen(true); }} className="admin-chip flex-row" style={{ gap: 8, paddingHorizontal: 14 }} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? shown(value) : emptyText}. Change`}>
          <SymbolView name={{ ios: "calendar", android: "calendar_today", web: "calendar_today" }} size={15} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">{value ? shown(value) : emptyText}</Text>
        </Pressable>
        {value && (
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`}>
            <Text className="meta-text" style={{ color: colors.danger }}>Clear</Text>
          </Pressable>
        )}
      </View>
      <DatePickerSheet visible={open} title={label} value={toDate(value ?? (min > toIso(new Date()) ? min : toIso(new Date())))} minimumDate={toDate(min)} maximumDate={toDate(max)} onSelect={(d) => onChange(toIso(d))} onClose={() => setOpen(false)} />
    </View>
  );
}

export function OnOffRow({ title, line, value, onChange }: { title: string; line: string; value: boolean; onChange: (v: boolean) => void }) {
  const switchColors = useSwitchColors();
  return (
    <View className="card flex-row items-center" style={{ gap: 12 }}>
      <View className="flex-1">
        <Text className="card__title">{title}</Text>
        <Text className="meta-text">{line}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} {...switchColors} accessibilityLabel={title} />
    </View>
  );
}

/** Today and a day moved by `days`, as YYYY-MM-DD on the phone's calendar */
export const isoToday = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIso(d);
};
