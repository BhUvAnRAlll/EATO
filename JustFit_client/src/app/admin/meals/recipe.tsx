import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminField } from "@/components/admin/AdminField";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { IngredientPickerSheet } from "@/components/admin/IngredientPickerSheet";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { kitchensApi, type Recipe } from "@/lib/kitchensApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

type Row = { ingredientId: number; name: string; unit: string; quantity: string };
const typed = (text: string) => text.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));

// Super Admin › Meals › a meal › Recipe and prep time (Meal Operations phase 2): how long one
// serving takes and what it uses, in each ingredient's own unit. From phase 3 a kitchen's stock is
// taken by this recipe when it starts cooking an order.
export default function MealRecipe() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string | null) => kitchensApi.recipe(token, String(id)), [id]);
  const { result, retry } = useGymData(load);
  return (
    <AdminScreen title="Recipe and prep time" subtitle={result.state === "ready" ? result.data.recipe.mealName : undefined}>
      {result.state === "loading" && <ScreenSkeleton label="Loading the recipe" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the recipe" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {result.state === "ready" && <RecipeForm recipe={result.data.recipe} tint={colors.danger} />}
    </AdminScreen>
  );
}

function RecipeForm({ recipe, tint }: { recipe: Recipe; tint: string }) {
  const colors = useThemeColors();
  const [prep, setPrep] = useState(recipe.prepMinutes === null ? "" : String(recipe.prepMinutes));
  const [rows, setRows] = useState<Row[]>(recipe.items.map((i) => ({ ingredientId: i.ingredientId, name: i.name, unit: i.unit, quantity: String(i.quantity) })));
  const [picking, setPicking] = useState(false);
  const { busy, error, save } = useGymSave(() => back(), "Recipe saved");
  const prepNumber = prep === "" ? null : Number(prep);
  const badRow = rows.find((r) => !(Number(r.quantity) > 0));
  const ready = (prepNumber === null || (Number.isInteger(prepNumber) && prepNumber >= 1 && prepNumber <= 600)) && !badRow;

  const submit = () => {
    if (!ready || busy) return;
    save((token) => kitchensApi.saveRecipe(token, recipe.mealId, prepNumber, rows.map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity) }))));
  };

  return (
    <View style={{ gap: 14 }}>
      <AdminField label="Preparation time (minutes, optional)" value={prep} onChangeText={(t) => setPrep(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={3} placeholder="20" hint="How long one order of it takes to cook and pack." />
      <Text className="setup__section">{`One serving uses (${rows.length})`}</Text>
      {rows.length === 0 ? (
        <DashedBlock icon={{ ios: "carrot", android: "nutrition", web: "nutrition" }} title="No ingredients yet" text="Add what one serving uses, so kitchens can see what they'll need." onPress={() => setPicking(true)} />
      ) : (
        <View className="admin-list">
          {rows.map((r, i) => (
            <View key={r.ingredientId} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}>
              <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{r.name}</Text>
              <TextInput
                className="admin__input"
                style={{ width: 84, textAlign: "right" }}
                value={r.quantity}
                onChangeText={(t) => setRows(rows.map((x) => (x.ingredientId === r.ingredientId ? { ...x, quantity: typed(t) } : x)))}
                keyboardType="decimal-pad"
                maxLength={8}
                placeholder="0.15"
                placeholderTextColor={colors.faint}
                accessibilityLabel={`${r.name} per serving, in ${r.unit}`}
              />
              <Text className="meta-text" style={{ width: 28 }}>{r.unit}</Text>
              <Pressable onPress={() => setRows(rows.filter((x) => x.ingredientId !== r.ingredientId))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${r.name}`}>
                <SymbolView name={{ ios: "minus.circle", android: "remove_circle_outline", web: "remove_circle_outline" }} size={20} tintColor={tint} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Pressable onPress={() => setPicking(true)} className="admin-chip admin-chip--on flex-row self-start" style={{ gap: 4 }} accessibilityRole="button">
        <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
        <Text className="admin-segment__label admin-segment__label--on">Add ingredient</Text>
      </Pressable>
      {badRow ? <Text className="admin__hint" style={{ color: colors.danger }}>{`Give ${badRow.name} a quantity above 0.`}</Text> : null}
      {error ? <FormAlert message={error} /> : null}
      <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
        {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
        <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>Save recipe</Text>
      </Pressable>
      {picking && (
        <IngredientPickerSheet
          taken={rows.map((r) => r.ingredientId)}
          onPick={(ing) => setRows((now) => [...now, { ingredientId: ing.id, name: ing.name, unit: ing.unit, quantity: "" }])}
          onClose={() => setPicking(false)}
        />
      )}
    </View>
  );
}
