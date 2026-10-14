import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Menu and meal search (built in the Food feature)
export default function Meals() {
  return (
    <PlaceholderScreen
      showBack={false}
      title="Meals"
      subtitle="Browse the full menu, filter by diet and macros, and add meals to your cart."
      icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }}
    />
  );
}
