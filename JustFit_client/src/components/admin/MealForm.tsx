import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Image } from "expo-image";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { SymbolView } from "@/components/SymbolView";
import { pickCatalogImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { DIET_LABEL, TAG_LABEL, macrosMismatch, type Diet, type Tag } from "@/lib/mealRules";
import { mealImage, type AdminMeal, type MealInput } from "@/lib/mealsApi";
import { showActions } from "@/lib/nativeSheets";
import { useAuthStore } from "@/store/auth";
import { useSwitchColors, useThemeColors } from "@/theme";

const DIETS: { value: Diet; label: string }[] = (Object.keys(DIET_LABEL) as Diet[]).map((value) => ({ value, label: DIET_LABEL[value] }));
const TAGS = Object.keys(TAG_LABEL) as Tag[];

// A number typed in a field: digits and one dot only; null while empty or not a number
const typed = (text: string) => text.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const valueOf = (text: string) => (text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text));
const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

type MealFormProps = {
  meal?: AdminMeal; // editing this meal; a new one when left out
  busy: boolean;
  error: string;
  saveLabel: string;
  onSave: (input: MealInput) => void;
};

// Super Admin › Meals › Add Meal and a meal's Edit: the photo (camera or gallery), name, serving,
// what's in it and the ingredients, diet, tags, kcal and macros per serving (with a hint when they
// don't add up), the price and an optional original price for a discount, and whether members see it.
export function MealForm({ meal, busy, error, saveLabel, onSave }: MealFormProps) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const token = useAuthStore((state) => state.token);
  const [photo, setPhoto] = useState<MemberPhoto | null>(null);
  const [removed, setRemoved] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [name, setName] = useState(meal?.name ?? "");
  const [servingSize, setServingSize] = useState(meal?.servingSize ?? "");
  const [description, setDescription] = useState(meal?.description ?? "");
  const [ingredients, setIngredients] = useState(meal?.ingredients ?? "");
  const [diet, setDiet] = useState<Diet>(meal?.diet ?? "vegetarian");
  const [tags, setTags] = useState<Tag[]>(meal?.tags ?? []);
  const [calories, setCalories] = useState(asText(meal?.calories));
  const [protein, setProtein] = useState(asText(meal?.proteinG));
  const [carbs, setCarbs] = useState(asText(meal?.carbsG));
  const [fat, setFat] = useState(asText(meal?.fatG));
  const [price, setPrice] = useState(asText(meal?.price));
  const [mrp, setMrp] = useState(asText(meal?.mrp));
  const [available, setAvailable] = useState(meal?.available ?? true);

  const hasPhoto = !!photo || (!!meal?.imageUrl && !removed);
  const choosePhoto = () => {
    const pick = async (source: PhotoSource) => {
      setPhotoError("");
      const picked = await pickCatalogImage(source);
      if (picked.ok) {
        setPhoto(picked.photo);
        setRemoved(false);
      } else if (!("cancelled" in picked)) setPhotoError(picked.error);
    };
    showActions({
      title: "Meal photo",
      actions: [
        ...(Platform.OS === "web" ? [] : [{ label: "Take photo", onPress: () => pick("camera") }]),
        { label: "Choose from gallery", onPress: () => pick("library") },
        ...(hasPhoto ? [{ label: "Remove photo", destructive: true, onPress: () => { setPhoto(null); setRemoved(true); } }] : []),
      ],
    });
  };

  const n = { calories: valueOf(calories), protein: valueOf(protein), carbs: valueOf(carbs), fat: valueOf(fat), price: valueOf(price) };
  const original = valueOf(mrp);
  const mrpProblem = original !== null && n.price !== null && original <= n.price;
  const ready = name.trim().length >= 2 && Object.values(n).every((v) => v !== null) && (n.calories ?? 0) > 0 && (n.price ?? 0) > 0 && !mrpProblem;
  const mismatch = ready && macrosMismatch(n.calories!, n.protein!, n.carbs!, n.fat!);
  const fromMacros = Math.round((n.protein ?? 0) * 4 + (n.carbs ?? 0) * 4 + (n.fat ?? 0) * 9);

  const submit = () => {
    if (!ready || busy) return;
    onSave({
      name: name.trim(),
      servingSize: servingSize.trim(),
      description: description.trim(),
      ingredients: ingredients.trim(),
      diet,
      tags,
      calories: Math.round(n.calories!),
      proteinG: n.protein!,
      carbsG: n.carbs!,
      fatG: n.fat!,
      price: Math.round(n.price!),
      mrp: original === null ? null : Math.round(original),
      available,
      ...(photo ? { photo: { data: photo.data, mediaType: photo.mediaType } } : removed && meal?.imageUrl ? { removePhoto: true as const } : {}),
    });
  };

  const numberField = (label: string, value: string, set: (v: string) => void, placeholder: string, whole = false) => (
    <View className="flex-1">
      <AdminField label={label} value={value} onChangeText={(t) => set(whole ? t.replace(/[^0-9]/g, "") : typed(t))} keyboardType={whole ? "number-pad" : "decimal-pad"} maxLength={6} placeholder={placeholder} />
    </View>
  );

  return (
    <KeyboardAvoider>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <Pressable onPress={choosePhoto} className="meal__card items-center justify-center" style={{ aspectRatio: 4 / 3, backgroundColor: hasPhoto ? colors.surface : colors.creamDeep }} accessibilityRole="button" accessibilityLabel={hasPhoto ? "Change the meal photo" : "Add a meal photo"}>
          {photo ? (
            <Image source={{ uri: photo.previewUri }} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          ) : hasPhoto && meal ? (
            <Image source={mealImage(meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          ) : (
            <View className="items-center" style={{ gap: 6 }}>
              <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={28} tintColor={colors.muted} />
              <Text className="card__title">Add a photo</Text>
              <Text className="meta-text">Camera or gallery · a bright, square-ish food photo</Text>
            </View>
          )}
        </Pressable>
        {photoError ? <FormAlert message={photoError} /> : null}
        <AdminField label="Meal name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Paneer Tikka Bowl" />
        <AdminField label="Serving size (optional)" value={servingSize} onChangeText={setServingSize} maxLength={40} placeholder="For example: 1 bowl · 450 g" />
        <AdminField label="Description (optional)" value={description} onChangeText={setDescription} maxLength={300} multiline placeholder="For example: Tandoori paneer with jeera rice and salad" />
        <AdminField label="Ingredients (optional)" value={ingredients} onChangeText={setIngredients} maxLength={300} multiline placeholder="For example: Paneer, curd, rice, onion, capsicum, spices" hint="Members can search by these." />
        <ChoiceChips label="Diet" options={DIETS} value={diet} onChange={setDiet} />
        <View className="gap-1.5">
          <Text className="auth__label">Tags</Text>
          <View className="flex-row flex-wrap gap-2">
            {TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <Pressable key={t} onPress={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])} className={on ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{TAG_LABEL[t]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Text className="type-headline text-forest-ink">Per serving</Text>
        <View className="flex-row" style={{ gap: 10 }}>
          {numberField("Calories (kcal)", calories, setCalories, "520", true)}
          {numberField("Protein (g)", protein, setProtein, "32")}
        </View>
        <View className="flex-row" style={{ gap: 10 }}>
          {numberField("Carbs (g)", carbs, setCarbs, "48")}
          {numberField("Fat (g)", fat, setFat, "18")}
        </View>
        {mismatch ? <Text className="admin__hint">{`Check the numbers: the macros add up to about ${fromMacros} kcal, not ${Math.round(n.calories!)}.`}</Text> : null}
        <View className="flex-row" style={{ gap: 10 }}>
          {numberField("Price (₹)", price, setPrice, "249", true)}
          {numberField("Original price (₹, optional)", mrp, setMrp, "299", true)}
        </View>
        {mrpProblem ? <Text className="admin__hint" style={{ color: colors.danger }}>The original price must be more than the price (it shows as a discount).</Text> : null}
        <View className="card flex-row items-center" style={{ gap: 12 }}>
          <View className="flex-1">
            <Text className="card__title">Show on the menu</Text>
            <Text className="meta-text">{available ? "Members can see and order it." : "Hidden: members can't see or order it."}</Text>
          </View>
          <Switch value={available} onValueChange={setAvailable} {...switchColors} accessibilityLabel="Show on the menu" />
        </View>
        {error ? <FormAlert message={error} /> : null}
        <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={saveLabel}>
          {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
          <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{saveLabel}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}
