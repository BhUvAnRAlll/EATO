import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Macro balance: calories, protein, carbs and fats against the targets (the Nutrition feature)
export default function Macro() {
  return (
    <PlaceholderScreen
      showBack={false}
      title="Macro Balance"
      subtitle="Protein · Carbs · Fats · Calories"
      icon={{ ios: "scalemass", android: "balance", web: "balance" }}
    />
  );
}
