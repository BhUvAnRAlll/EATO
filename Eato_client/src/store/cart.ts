import { create } from "zustand";

// Meals added from the home screen. Checkout isn't built yet, so this lives only in
// memory for the session; the count on each meal card is the confirmation.
type CartState = {
  // meal id → quantity
  items: Record<string, number>;
  add: (mealId: string) => void;
  remove: (mealId: string) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>((set) => ({
  items: {},
  add: (mealId) => set((state) => ({ items: { ...state.items, [mealId]: (state.items[mealId] ?? 0) + 1 } })),
  remove: (mealId) =>
    set((state) => {
      const quantity = (state.items[mealId] ?? 0) - 1;
      const items = { ...state.items };
      if (quantity > 0) items[mealId] = quantity;
      else delete items[mealId];
      return { items };
    }),
  clear: () => set({ items: {} }),
}));

// Total number of meals in the cart
export const cartCount = (items: Record<string, number>) => Object.values(items).reduce((sum, quantity) => sum + quantity, 0);
