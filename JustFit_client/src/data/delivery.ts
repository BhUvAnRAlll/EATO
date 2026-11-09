import type { IdStatus, Vehicle } from "@/lib/deliveryApi";
import type { DeliveryFailure, DeliveryStep } from "@/lib/mealsApi";

// Words for deliveries (Meal Operations phase 4)
export const VEHICLE_LABEL: Record<Vehicle, string> = { bike: "Bike", scooter: "Scooter", bicycle: "Bicycle", car: "Car", on_foot: "On foot" };
export const ID_STATUS_LABEL: Record<IdStatus, string> = { pending: "ID pending", verified: "ID verified", rejected: "ID rejected" };
export const DELIVERY_STEP_LABEL: Record<DeliveryStep, string> = {
  assigned: "Assigned", accepted: "Partner accepted", at_kitchen: "At the kitchen", picked_up: "Picked up",
  out_for_delivery: "Out for delivery", at_customer: "At the customer", delivered: "Delivered", failed: "Failed",
};
// The admin's button for each step (none once delivered or failed)
export const NEXT_DELIVERY_LABEL: Partial<Record<DeliveryStep, string>> = {
  assigned: "Partner accepted", accepted: "At the kitchen", at_kitchen: "Picked up", picked_up: "Out for delivery",
  out_for_delivery: "At the customer", at_customer: "Delivered",
};
export const FAILURE_LABEL: Record<DeliveryFailure, string> = {
  customer_unavailable: "Customer unavailable", wrong_address: "Incorrect address", customer_rejected: "Customer rejected the order",
  partner_issue: "Delivery partner issue", other: "Other reason",
};
