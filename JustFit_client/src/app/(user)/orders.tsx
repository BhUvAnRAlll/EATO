import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Order history and live tracking (built in the Food feature)
export default function Orders() {
  return (
    <PlaceholderScreen
      title="Orders"
      subtitle="Your deliveries, past orders and live tracking will appear here."
      icon={{ ios: "shippingbox", android: "inventory_2", web: "inventory_2" }}
    />
  );
}
