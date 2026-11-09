import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { SymbolView } from "@/components/SymbolView";
import { INGREDIENT_CATEGORY_LABEL, UNITS } from "@/data/kitchens";
import { kitchensApi, type Ingredient, type IngredientCategory, type IngredientUnit } from "@/lib/kitchensApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const CATEGORIES = (Object.keys(INGREDIENT_CATEGORY_LABEL) as IngredientCategory[]).map((value) => ({ value, label: INGREDIENT_CATEGORY_LABEL[value] }));
const UNIT_OPTIONS = UNITS.map((value) => ({ value, label: value }));

// Pick an ingredient from justFit's one list (search as you type), or add a new one: its name,
// category and unit. Ingredients already picked (`taken`) are left out. Used by a kitchen's
// Inventory and a meal's Recipe.
export function IngredientPickerSheet({ taken, onPick, onClose }: { taken: number[]; onPick: (ingredient: Ingredient) => void; onClose: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Ingredient[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<IngredientCategory>("vegetables");
  const [unit, setUnit] = useState<IngredientUnit>("kg");
  const [busy, setBusy] = useState(false);

  // The ids as text, so a new array with the same ids doesn't search again
  const takenKey = taken.join(",");
  useEffect(() => {
    const skip = new Set(takenKey ? takenKey.split(",").map(Number) : []);
    let live = true;
    const timer = setTimeout(async () => {
      const answer = await kitchensApi.ingredients(await getToken(), search);
      if (!live) return;
      if (answer.ok) setFound(answer.data.ingredients.filter((i) => !skip.has(i.id)));
      else setError(answer.error);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, takenKey, getToken]);

  const create = async (dismiss: () => void) => {
    if (busy || search.trim().length < 2) return;
    setBusy(true);
    setError("");
    const answer = await kitchensApi.addIngredient(await getToken(), { name: search.trim(), category, unit });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    onPick(answer.data.ingredient);
    dismiss();
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="type-headline text-forest-ink">{adding ? "New ingredient" : "Pick an ingredient"}</Text>
            {adding ? (
              <>
                <AdminField label="Name" value={search} onChangeText={setSearch} maxLength={60} placeholder="For example: Paneer" />
                <ChoiceChips label="Category" options={CATEGORIES} value={category} onChange={setCategory} />
                <ChoiceChips label="Unit" options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
                {error ? <FormAlert message={error} /> : null}
                <Pressable onPress={() => create(dismiss)} disabled={busy || search.trim().length < 2} className={search.trim().length >= 2 ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
                  {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
                  <Text className={search.trim().length >= 2 ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>Add ingredient</Text>
                </Pressable>
                <Pressable onPress={() => setAdding(false)} className="self-center" hitSlop={10} accessibilityRole="button">
                  <Text className="meal-link">Back to the list</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View className="search search--pill">
                  <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
                  <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search ingredients" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search ingredients" />
                </View>
                {error ? <FormAlert message={error} /> : null}
                {found === null ? (
                  <ActivityIndicator color={colors.leaf} />
                ) : found.length === 0 ? (
                  <Text className="meta-text">{search.trim() ? `Nothing called “${search.trim()}” yet.` : "No ingredients yet."}</Text>
                ) : (
                  <View className="admin-list">
                    {found.slice(0, 30).map((i, n) => (
                      <Pressable key={i.id} onPress={() => { onPick(i); dismiss(); }} className={n === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button" accessibilityLabel={`Pick ${i.name}`}>
                        <View className="min-w-0 flex-1">
                          <Text className="card__title" numberOfLines={1}>{i.name}</Text>
                          <Text className="meta-text">{`${INGREDIENT_CATEGORY_LABEL[i.category]} · in ${i.unit}`}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Pressable onPress={() => setAdding(true)} className="admin-chip admin-chip--on flex-row self-start" style={{ gap: 4 }} accessibilityRole="button">
                  <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
                  <Text className="admin-segment__label admin-segment__label--on">{search.trim() ? `New: ${search.trim()}` : "New ingredient"}</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
