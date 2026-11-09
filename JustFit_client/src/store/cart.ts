import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";

// The meal cart (Home's popular meals, the Meals tab, a meal's page). It lives only in memory for
// the session: the cart screen reads each meal's price from the menu, and the server prices the
// order again when it is placed.
export const MAX_PER_MEAL = 3; // the server's limit for one meal in one order

type CartState = {
  // meal id → quantity
  items: Record<string, number>;
  add: (mealId: string) => void;
  remove: (mealId: string) => void;
  setQuantity: (mealId: string, quantity: number) => void;
  // A coupon the member applied (the server checks it on the cart's quote and again on Pay)
  couponCode: string | null;
  setCoupon: (code: string | null) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>((set) => ({
  items: {},
  add: (mealId) => set((state) => ({ items: { ...state.items, [mealId]: Math.min(MAX_PER_MEAL, (state.items[mealId] ?? 0) + 1) } })),
  remove: (mealId) =>
    set((state) => {
      const quantity = (state.items[mealId] ?? 0) - 1;
      const items = { ...state.items };
      if (quantity > 0) items[mealId] = quantity;
      else delete items[mealId];
      return { items };
    }),
  setQuantity: (mealId, quantity) =>
    set((state) => {
      const items = { ...state.items };
      if (quantity > 0) items[mealId] = Math.min(MAX_PER_MEAL, Math.round(quantity));
      else delete items[mealId];
      return { items };
    }),
  couponCode: null,
  setCoupon: (couponCode) => set({ couponCode }),
  clear: () => set({ items: {}, couponCode: null }),
}));

// Another account never inherits the cart
onAccountCleared(() => useCartStore.getState().clear());

// Total number of meals in the cart
export const cartCount = (items: Record<string, number>) => Object.values(items).reduce((sum, quantity) => sum + quantity, 0);
