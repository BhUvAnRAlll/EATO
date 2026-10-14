import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Meal plans and subscriptions (built in the Subscribe feature)
export default function Plans() {
  return (
    <PlaceholderScreen
      title="Plans"
      subtitle="Weekly meal plans built around your goal, with skip days and wallet credit."
      icon={{ ios: "calendar", android: "calendar_today", web: "calendar_today" }}
    />
  );
}
