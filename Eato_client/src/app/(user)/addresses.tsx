import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function Addresses() {
  return (
    <PlaceholderScreen
      title="Delivery address"
      subtitle="Save your addresses and check whether EATO delivers to your pincode."
      icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
    />
  );
}
