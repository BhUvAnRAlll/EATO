import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { OnOffRow, PhotoBox, photoPayload, type PhotoChoice } from "@/components/admin/AdminPickers";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { DietMark } from "@/components/meals/DietMark";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { hud } from "@/lib/hud";
import { TAG_LABEL, rupees, type Tag } from "@/lib/mealRules";
import { kitchenApi, type AdminCategory, type AdminMeal } from "@/lib/mealsApi";
import { confirmChoice } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Mode = "pick" | "tag" | "price";
const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals/categories"));

// Super Admin › Meals › Categories › New or a category: a tile or a food category, its picture,
// name, subtitle and label, which meals it lists (picked, every meal with a tag, or every meal up to
// a price), whether it also shows as a row of cards, whether members see it, and its order.
export default function AdminCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const load = useCallback(async (token: string | null) => {
    const [cats, meals] = await Promise.all([kitchenApi.categories(token), kitchenApi.meals(token)]);
    if (!cats.ok) return cats;
    if (!meals.ok) return meals;
    const category = isNew ? null : cats.data.categories.find((c) => String(c.id) === id) ?? undefined;
    if (category === undefined) return { ok: false as const, error: "That category was deleted.", status: 404 };
    return { ok: true as const, data: { category, meals: meals.data.meals } };
  }, [id, isNew]);
  const { result, retry } = useGymData(load);
  return (
    <AdminScreen title={isNew ? "New category" : "Edit category"}>
      {result.state === "loading" && <ScreenSkeleton label="Loading" />}
      {result.state === "failed" && <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />}
      {result.state === "ready" && <CategoryForm category={result.data.category} meals={result.data.meals} />}
    </AdminScreen>
  );
}

function CategoryForm({ category, meals }: { category: AdminCategory | null; meals: AdminMeal[] }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [kind, setKind] = useState<"tile" | "food">(category?.kind ?? "tile");
  const [name, setName] = useState(category?.name ?? "");
  const [subtitle, setSubtitle] = useState(category?.subtitle ?? "");
  const [badge, setBadge] = useState(category?.badge ?? "");
  const [mode, setMode] = useState<Mode>(category?.matchTag ? "tag" : category?.maxPrice ? "price" : "pick");
  const [tag, setTag] = useState<Tag>(category?.matchTag ?? "high_protein");
  const [maxPrice, setMaxPrice] = useState(category?.maxPrice ? String(category.maxPrice) : "");
  const [picked, setPicked] = useState<string[]>(category?.mealIds ?? []);
  const [featured, setFeatured] = useState(category?.featured ?? false);
  const [active, setActive] = useState(category?.active ?? true);
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [photo, setPhoto] = useState<PhotoChoice>({ picked: null, removed: false });
  const [deleting, setDeleting] = useState(false);
  const { busy, error, save } = useGymSave(() => back(), category ? "Category saved" : "Category added");

  const price = Number(maxPrice);
  const ready = name.trim().length >= 2 && (mode === "pick" ? picked.length > 0 : mode === "price" ? Number.isInteger(price) && price >= 1 : true);
  const submit = () => {
    if (!ready || busy) return;
    save((token) =>
      kitchenApi.saveCategory(token, category?.id ?? null, {
        kind,
        name: name.trim(),
        subtitle: subtitle.trim(),
        badge: badge.trim(),
        matchTag: mode === "tag" ? tag : null,
        maxPrice: mode === "price" ? price : null,
        mealIds: mode === "pick" ? picked : [],
        featured: kind === "food" && featured,
        active,
        sortOrder: Math.min(999, Number(sortOrder) || 0),
        ...photoPayload(photo, !!category?.imageUrl),
      }),
    );
  };
  const remove = async () => {
    if (!category || deleting) return;
    if (!(await confirmChoice({ title: `Delete ${category.name}?`, message: "It leaves the Meals tab now. The meals in it stay on the menu.", confirmLabel: "Delete category", destructive: true }))) return;
    setDeleting(true);
    const answer = await kitchenApi.remove(await getToken(), "categories", category.id);
    setDeleting(false);
    if (!answer.ok) return hud.error(answer.error);
    hud.success("Category deleted");
    back();
  };

  return (
    <View style={{ gap: 16 }}>
      <ChoiceChips label="Shows as" options={[{ value: "tile", label: "Tile" }, { value: "food", label: "Food category" }]} value={kind} onChange={setKind} />
      <PhotoBox label="Picture" hint={kind === "tile" ? "Square works best" : "A round crop of a dish works best"} aspect={1} currentUrl={category?.imageUrl ?? null} choice={photo} onChange={setPhoto} />
      <AdminField label="Name" value={name} onChangeText={setName} maxLength={40} placeholder={kind === "tile" ? "For example: Under ₹99" : "For example: Biryani & Rice Bowls"} />
      <AdminField label="Subtitle (optional)" value={subtitle} onChangeText={setSubtitle} maxLength={80} placeholder="For example: Nutritious, chef-crafted bowls" />
      <AdminField label="Label on the picture (optional)" value={badge} onChangeText={setBadge} maxLength={16} placeholder="For example: NEW or 20% OFF" />
      <ChoiceChips label="Which meals it lists" options={[{ value: "pick", label: "Pick meals" }, { value: "tag", label: "By tag" }, { value: "price", label: "Up to a price" }]} value={mode} onChange={setMode} />
      {mode === "tag" && <ChoiceChips label="Every meal tagged" options={(Object.keys(TAG_LABEL) as Tag[]).map((t) => ({ value: t, label: TAG_LABEL[t] }))} value={tag} onChange={setTag} />}
      {mode === "price" && <AdminField label="Every meal up to (₹)" value={maxPrice} onChangeText={(t) => setMaxPrice(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={4} placeholder="99" />}
      {mode === "pick" && (
        <View className="gap-1.5">
          <Text className="auth__label">{`Meals in it (${picked.length})`}</Text>
          {meals.length === 0 ? (
            <Text className="meta-text">Add meals first.</Text>
          ) : (
            <View className="admin-list">
              {meals.map((m, i) => {
                const on = picked.includes(m.id);
                return (
                  <Pressable key={m.id} onPress={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <SymbolView name={on ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "circle", android: "radio_button_unchecked", web: "radio_button_unchecked" }} size={20} tintColor={on ? colors.primary : colors.faint} />
                    <DietMark diet={m.diet} />
                    <Text className="card__title flex-1" numberOfLines={1}>{m.name}</Text>
                    <Text className="meta-text">{rupees(m.price)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
      {kind === "food" && <OnOffRow title="Also a row of cards" line="Shows its meals as a row on the Meals tab, like “Meal Bowls”." value={featured} onChange={setFeatured} />}
      <OnOffRow title="Members see it" line={active ? "On the Meals tab (when it has meals)." : "Off: hidden from members."} value={active} onChange={setActive} />
      <AdminField label="Order (lower comes first)" value={sortOrder} onChangeText={(t) => setSortOrder(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" maxLength={3} placeholder="0" />
      {error ? <FormAlert message={error} /> : null}
      <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button">
        {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
        <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{category ? "Save changes" : "Add category"}</Text>
      </Pressable>
      {category && (
        <Pressable onPress={remove} disabled={deleting} className="admin-chip self-center" style={{ paddingHorizontal: 20 }} accessibilityRole="button">
          <Text className="admin-segment__label" style={{ color: colors.danger }}>{deleting ? "Deleting…" : "Delete category"}</Text>
        </Pressable>
      )}
    </View>
  );
}
