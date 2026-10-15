import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { FormAlert } from "@/components/FormAlert";
import { clockTime, macro, slotInfo, sourceLabel, whole, type Meal } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type MealDetailSheetProps = {
  // The meal to show, or null when closed
  meal: Meal | null;
  onClose: () => void;
  // Called after the meal was removed on the server
  onDeleted: (meal: Meal) => void;
  // The heart: shown when the screen knows the favourite state
  favorited?: boolean;
  onToggleFavorite?: (meal: Meal) => void;
};

// A logged meal in full: when, how it was logged, its macros and every food in it, with a
// heart and a confirmed "Remove". The server decides who may remove it.
export function MealDetailSheet(props: MealDetailSheetProps) {
  // Keyed by meal, so every meal opens a fresh sheet (no leftover confirm step or error)
  return props.meal ? <MealSheetBody key={props.meal.id} {...props} meal={props.meal} /> : null;
}

function MealSheetBody({ meal, onClose, onDeleted, favorited, onToggleFavorite }: MealDetailSheetProps & { meal: Meal }) {
  const getToken = useSessionToken();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slot = slotInfo[meal.slot];

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);
    const result = await macro.deleteMeal(await getToken().catch(() => null), meal.id);
    setRemoving(false);
    if (!result.ok) {
      setError(`Could not remove that meal. ${result.status ? result.error : "Check your connection and try again."}`);
      return;
    }
    onDeleted(meal);
    onClose();
  };

  const macros = [
    { key: "proteinG", label: "Protein", color: colors.protein },
    { key: "carbsG", label: "Carbs", color: colors.carbs },
    { key: "fatG", label: "Fat", color: colors.fat },
  ] as const;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={removing ? undefined : onClose}>
      <Pressable className="verify__backdrop" onPress={removing ? undefined : onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet" style={{ maxHeight: "86%" }} onPress={() => {}} accessibilityViewIsModal>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
            <View className="flex-row items-start gap-3">
              <View className="macro__thumb" style={{ backgroundColor: `${slot.tint}1F` }}>
                <SymbolView name={slot.icon} size={22} tintColor={slot.tint} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="type-headline text-forest-ink">{meal.title}</Text>
                <Text className="post__time">
                  {slot.label} · {clockTime(meal.loggedAt)} · {sourceLabel[meal.source]}
                </Text>
              </View>
              {onToggleFavorite && (
                <Pressable onPress={() => onToggleFavorite(meal)} hitSlop={10} className="h-10 w-10 items-center justify-center" accessibilityRole="button" accessibilityState={{ selected: !!favorited }} accessibilityLabel={favorited ? "Remove from favourites" : "Save to favourites"}>
                  <SymbolView name={{ ios: favorited ? "heart.fill" : "heart", android: favorited ? "favorite" : "favorite_border", web: favorited ? "favorite" : "favorite_border" }} size={22} tintColor={favorited ? colors.danger : colors.muted} />
                </Pressable>
              )}
            </View>

            <View className="macro__panel flex-row">
              <View className="flex-1 items-center">
                <Text className="macro__stat-value">{whole(meal.totals.kcal)}</Text>
                <Text className="macro__stat-label">kcal</Text>
              </View>
              {macros.map((m) => (
                <View key={m.key} className="flex-1 items-center">
                  <Text className="macro__stat-value" style={{ color: m.color }}>{whole(meal.totals[m.key])}g</Text>
                  <Text className="macro__stat-label">{m.label}</Text>
                </View>
              ))}
            </View>

            <View>
              <View className="flex-row border-b border-cream-line pb-2">
                <Text className="macro__table-head flex-1">Food</Text>
                <Text className="macro__table-head w-24 text-right">Amount</Text>
                <Text className="macro__table-head w-20 text-right">Calories</Text>
              </View>
              {meal.items.map((item, index) => (
                <View key={`${item.name}-${index}`} className="flex-row border-b border-cream-line py-2.5">
                  <Text className="macro__table-cell flex-1" numberOfLines={2}>{item.name}</Text>
                  <Text className="macro__table-cell w-24 text-right">{item.quantity} {item.unit}</Text>
                  <Text className="macro__table-cell w-20 text-right">{whole(item.kcal)} kcal</Text>
                </View>
              ))}
            </View>

            {error && <FormAlert message={error} />}

            {confirming ? (
              <View className="gap-2">
                <Text className="setup__section text-center">Remove this meal?</Text>
                <Text className="home__note text-center">{meal.title} will be taken off your day.</Text>
                <Pressable onPress={remove} disabled={removing} className="btn-forest mt-2" style={{ backgroundColor: colors.danger, opacity: removing ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Remove">
                  {removing ? <ActivityIndicator color={colors.white} /> : null}
                  <Text className="btn-forest__label">{removing ? "Removing…" : "Remove"}</Text>
                </Pressable>
                <Pressable onPress={() => setConfirming(false)} disabled={removing} className="btn-outline" accessibilityRole="button" accessibilityLabel="Keep">
                  <Text className="btn-outline__label">Keep</Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-2">
                <Pressable onPress={() => setConfirming(true)} className="btn-outline" accessibilityRole="button" accessibilityLabel="Remove meal">
                  <Text className="btn-outline__label" style={{ color: colors.danger }}>Remove meal</Text>
                </Pressable>
                <Pressable onPress={onClose} className="btn-forest" accessibilityRole="button">
                  <Text className="btn-forest__label">Done</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
