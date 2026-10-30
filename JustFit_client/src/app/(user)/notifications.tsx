import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function Notifications() {
  return (
    <PlaceholderScreen
      title="Notifications"
      subtitle="Delivery updates, reminders and offers will be listed here."
      icon={{ ios: "bell", android: "notifications", web: "notifications" }}
    />
  );
}
