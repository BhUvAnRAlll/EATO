import { View } from "react-native";
import { router } from "expo-router";

import { MealRow } from "@/components/meals/MealRow";
import type { MenuMeal } from "@/lib/mealsApi";
import { useCartStore } from "@/store/cart";

type RecommendedMealsProps = {
  // Each meal with why it suits the member ("38 g of the 64 g protein you still need")
  items: { meal: MenuMeal; note: string }[];
};

// Menu meals recommended to the member (Home's Picked for you, the Meal Plan's Order from justFit):
// a row each with the reason, and Add or − n + straight into the cart; the photo or name opens the meal
export function RecommendedMeals({ items }: RecommendedMealsProps) {
  const cart = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);
  return (
    <View style={{ gap: 10 }}>
      {items.map(({ meal, note }) => (
        <MealRow
          key={meal.id}
          meal={meal}
          note={note}
          quantity={cart[meal.id] ?? 0}
          onOpen={() => router.push({ pathname: "/meals/[id]", params: { id: meal.id } })}
          onAdd={() => add(meal.id)}
          onQuantity={(q) => setQuantity(meal.id, q)}
        />
      ))}
    </View>
  );
}
