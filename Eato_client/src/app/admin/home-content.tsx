import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { destinations, quickActionIconKeys, type Meal, type QuickAction } from "@/data/home";
import { adminHome, resolveImage, type HomeContentInput } from "@/lib/home";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const MAX_QUICK_ACTIONS = 6;
const MAX_POPULAR = 10;
const destinationOptions = destinations.map((destination) => ({ value: destination, label: destination }));
const iconOptions = quickActionIconKeys.map((key) => ({ value: key, label: key }));

// The editable parts of the home screen around the carousel. Labels and layout only:
// members' nutrition numbers and orders never pass through here.
export default function AdminHomeContent() {
  const getToken = useSessionToken();
  const [content, setContent] = useState<HomeContentInput | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const [contentResult, mealsResult] = await Promise.all([adminHome.getHomeContent(token), adminHome.listMeals(token)]);
      if (cancelled) return;
      if (!contentResult.ok) return setError(contentResult.error);
      if (!mealsResult.ok) return setError(mealsResult.error);
      const { popularMeals: _shown, updatedAt: _updated, ...editable } = contentResult.data.content;
      setContent(editable);
      setMeals(mealsResult.data.meals);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const update = (changes: Partial<HomeContentInput>) => {
    setSaved(false);
    setContent((current) => (current ? { ...current, ...changes } : current));
  };

  const updateQuickAction = (index: number, changes: Partial<QuickAction>) => {
    if (!content) return;
    const quickActions = content.quickActions.map((action, actionIndex) => (actionIndex === index ? { ...action, ...changes } : action));
    update({ quickActions });
  };

  const moveQuickAction = (index: number, direction: -1 | 1) => {
    if (!content) return;
    const quickActions = [...content.quickActions];
    const target = index + direction;
    if (target < 0 || target >= quickActions.length) return;
    [quickActions[index], quickActions[target]] = [quickActions[target], quickActions[index]];
    update({ quickActions });
  };

  const addQuickAction = () => {
    if (!content || content.quickActions.length >= MAX_QUICK_ACTIONS) return;
    const id = `action-${Date.now().toString(36)}`;
    update({ quickActions: [...content.quickActions, { id, title: "New card", subtitle: "What it opens", icon: "meals", destination: "explore" }] });
  };

  const togglePopular = (mealId: string) => {
    if (!content) return;
    const listed = content.popularMealIds.includes(mealId);
    if (!listed && content.popularMealIds.length >= MAX_POPULAR) return;
    update({ popularMealIds: listed ? content.popularMealIds.filter((id) => id !== mealId) : [...content.popularMealIds, mealId] });
  };

  const movePopular = (index: number, direction: -1 | 1) => {
    if (!content) return;
    const ids = [...content.popularMealIds];
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    update({ popularMealIds: ids });
  };

  const save = async () => {
    if (!content) return;
    setSaving(true);
    setError(null);
    const result = await adminHome.saveHomeContent(await getToken(), content);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setSaved(true);
  };

  const mealById = new Map(meals.map((meal) => [meal.id, meal]));

  return (
    <AdminScreen title="Home screen settings" headerRight={<AdminButton label={saving ? "Saving…" : "Save"} variant="primary" onPress={save} disabled={saving || !content} />}>
      {!content ? (
        error ? <FormAlert message={error} /> : <ActivityIndicator color={colors.forest} className="mt-6" />
      ) : (
        <View className="gap-5">
          {error && <FormAlert message={error} />}
          {saved && <Text className="admin__success">Saved. Members see it on their next refresh.</Text>}

          <Text className="setup__section">Section labels</Text>
          <AdminField label="Nutrition heading" value={content.nutritionHeading} onChangeText={(nutritionHeading) => update({ nutritionHeading })} maxLength={40} />
          <AdminField label="Nutrition action" value={content.nutritionActionLabel} onChangeText={(nutritionActionLabel) => update({ nutritionActionLabel })} maxLength={30} />
          <AdminField label="Popular meals heading" value={content.popularHeading} onChangeText={(popularHeading) => update({ popularHeading })} maxLength={40} />
          <AdminField label="Popular meals action" value={content.popularActionLabel} onChangeText={(popularActionLabel) => update({ popularActionLabel })} maxLength={30} />
          <AdminField label="Today heading" value={content.todayHeading} onChangeText={(todayHeading) => update({ todayHeading })} maxLength={40} />
          <AdminField label="Today action" value={content.todayActionLabel} onChangeText={(todayActionLabel) => update({ todayActionLabel })} maxLength={30} />
          <View className="flex-row items-center justify-between">
            <Text className="auth__label">Show the Today section</Text>
            <Switch value={content.showTodaySection} onValueChange={(showTodaySection) => update({ showTodaySection })} trackColor={{ true: colors.forest }} />
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="setup__section">Quick actions</Text>
            <AdminButton label="Add card" onPress={addQuickAction} disabled={content.quickActions.length >= MAX_QUICK_ACTIONS} />
          </View>
          {content.quickActions.map((action, index) => (
            <View key={action.id} className="admin__row gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="card__title">Card {index + 1}</Text>
                <View className="flex-row items-center gap-3">
                  <Pressable onPress={() => moveQuickAction(index, -1)} hitSlop={6} disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Move up">
                    <SymbolView name={{ ios: "chevron.up", android: "arrow_upward", web: "arrow_upward" }} size={18} tintColor={colors.forestInk} />
                  </Pressable>
                  <Pressable onPress={() => moveQuickAction(index, 1)} hitSlop={6} disabled={index === content.quickActions.length - 1} style={{ opacity: index === content.quickActions.length - 1 ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Move down">
                    <SymbolView name={{ ios: "chevron.down", android: "arrow_downward", web: "arrow_downward" }} size={18} tintColor={colors.forestInk} />
                  </Pressable>
                  <AdminButton label="Remove" variant="danger" onPress={() => update({ quickActions: content.quickActions.filter((_, i) => i !== index) })} />
                </View>
              </View>
              <AdminField label="Title" value={action.title} onChangeText={(title) => updateQuickAction(index, { title })} maxLength={40} />
              <AdminField label="Subtitle" value={action.subtitle} onChangeText={(subtitle) => updateQuickAction(index, { subtitle })} maxLength={40} />
              <ChoiceChips label="Icon" options={iconOptions} value={action.icon} onChange={(icon) => updateQuickAction(index, { icon })} />
              <ChoiceChips label="Opens" options={destinationOptions} value={action.destination} onChange={(destination) => updateQuickAction(index, { destination })} />
            </View>
          ))}

          <Text className="setup__section">Popular meals</Text>
          <Text className="admin__hint">Shown in this order. Tap a meal on the menu below to add or remove it (up to {MAX_POPULAR}).</Text>
          {content.popularMealIds.map((mealId, index) => {
            const meal = mealById.get(mealId);
            return (
              <View key={mealId} className="admin__row flex-row items-center gap-3">
                <Image source={resolveImage(meal?.imageUrl)} contentFit="cover" style={{ width: 44, height: 44, borderRadius: 10 }} />
                <View className="flex-1">
                  <Text className="card__title" numberOfLines={1}>
                    {meal?.name ?? mealId}
                  </Text>
                  <Text className="card__subtitle">{meal ? `${meal.calories} kcal` : "Not on the menu"}</Text>
                </View>
                <Pressable onPress={() => movePopular(index, -1)} hitSlop={6} disabled={index === 0} style={{ opacity: index === 0 ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Move up">
                  <SymbolView name={{ ios: "chevron.up", android: "arrow_upward", web: "arrow_upward" }} size={18} tintColor={colors.forestInk} />
                </Pressable>
                <Pressable onPress={() => movePopular(index, 1)} hitSlop={6} disabled={index === content.popularMealIds.length - 1} style={{ opacity: index === content.popularMealIds.length - 1 ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Move down">
                  <SymbolView name={{ ios: "chevron.down", android: "arrow_downward", web: "arrow_downward" }} size={18} tintColor={colors.forestInk} />
                </Pressable>
                <AdminButton label="Remove" variant="danger" onPress={() => togglePopular(mealId)} />
              </View>
            );
          })}

          <Text className="setup__section">Menu</Text>
          <View className="gap-2">
            {meals.map((meal) => {
              const listed = content.popularMealIds.includes(meal.id);
              return (
                <Pressable key={meal.id} onPress={() => togglePopular(meal.id)} className={listed ? "setup__card setup__card--selected flex-row items-center gap-3" : "setup__card flex-row items-center gap-3"} accessibilityRole="checkbox" accessibilityState={{ checked: listed }}>
                  <Image source={resolveImage(meal.imageUrl)} contentFit="cover" style={{ width: 40, height: 40, borderRadius: 10 }} />
                  <View className="flex-1">
                    <Text className="setup__card-title">{meal.name}</Text>
                    <Text className="setup__card-text">
                      {meal.calories} kcal · {Math.round(meal.proteinG)}g P · {Math.round(meal.carbsG)}g C · {Math.round(meal.fatG)}g F
                    </Text>
                  </View>
                  {listed && <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={20} tintColor={colors.forest} />}
                </Pressable>
              );
            })}
          </View>

          <View className="flex-row gap-2">
            <AdminButton label="Back" onPress={() => router.back()} />
            <AdminButton label={saving ? "Saving…" : "Save changes"} variant="primary" onPress={save} disabled={saving} />
          </View>
        </View>
      )}
    </AdminScreen>
  );
}
