import type { IssueCategory, IssueStatus } from "@/lib/issuesApi";

// Words for members' meal problems (Meal Operations phase 6)
export const ISSUE_CATEGORY_LABEL: Record<IssueCategory, string> = {
  cancellation: "Cancel my order", refund: "Refund", missing_meal: "Meal missing", wrong_meal: "Wrong meal", damaged_food: "Damaged or spilled",
  late_delivery: "Delivered late", failed_delivery: "Not delivered", subscription: "My meal plan", other: "Something else",
};
// What a member can pick on an order, and on a meal plan
export const ORDER_CATEGORIES: IssueCategory[] = ["missing_meal", "wrong_meal", "damaged_food", "late_delivery", "failed_delivery", "cancellation", "refund", "other"];
export const PLAN_CATEGORIES: IssueCategory[] = ["subscription", "refund", "other"];
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", rejected: "Closed" };
