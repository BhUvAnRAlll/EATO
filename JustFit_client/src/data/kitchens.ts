import type { KitchenStatus, StaffRole } from "@/lib/kitchensApi";

// Words for kitchens (Super Admin › Kitchens, Meal Operations phase 1)
export const KITCHEN_STATUS_LABEL: Record<KitchenStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  temporarily_closed: "Temporarily closed",
  maintenance: "Under maintenance",
};
export const KITCHEN_STATUSES: KitchenStatus[] = ["active", "temporarily_closed", "maintenance", "inactive"];
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = { manager: "Kitchen manager", chef: "Chef", prep: "Preparation staff" };
export const STAFF_ROLES: StaffRole[] = ["manager", "chef", "prep"];
// Reasons offered when a kitchen stops taking orders (any other can be typed)
export const STATUS_REASONS: Record<Exclude<KitchenStatus, "active">, string[]> = {
  temporarily_closed: ["Festival holiday", "Staff shortage today", "Power or gas outage"],
  maintenance: ["Equipment repair", "Deep cleaning", "Pest control"],
  inactive: ["Moved to a new kitchen", "Closed for good"],
};
// The status pill's classes, written out whole so NativeWind finds them
export const KITCHEN_PILL: Record<KitchenStatus, { box: string; label: string }> = {
  active: { box: "kitchen-pill kitchen-pill--active", label: "kitchen-pill__label kitchen-pill__label--active" },
  temporarily_closed: { box: "kitchen-pill kitchen-pill--temporarily_closed", label: "kitchen-pill__label kitchen-pill__label--temporarily_closed" },
  maintenance: { box: "kitchen-pill kitchen-pill--maintenance", label: "kitchen-pill__label kitchen-pill__label--maintenance" },
  inactive: { box: "kitchen-pill kitchen-pill--inactive", label: "kitchen-pill__label kitchen-pill__label--inactive" },
};
