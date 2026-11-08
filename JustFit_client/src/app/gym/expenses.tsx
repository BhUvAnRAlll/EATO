import { useLocalSearchParams } from "expo-router";

import { ExpenseList } from "@/components/gym/ExpenseList";
import { GymSectionScreen } from "@/components/gym/GymSectionScreen";

// Gym admin › Expenses (the ☰ menu; Home's + › Add Expense opens it with its sheet up, ?add=1)
export default function GymExpenses() {
  const params = useLocalSearchParams<{ add?: string }>();
  return (
    <GymSectionScreen title="Expenses" area="expenses">
      <ExpenseList addOnOpen={params.add === "1"} />
    </GymSectionScreen>
  );
}
